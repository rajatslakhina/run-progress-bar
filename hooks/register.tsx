// run-progress-bar: a band above the prompt showing live progress of long
// agent work. Read-only: it hooks tool calls to learn the task list, lists
// and tails workflow journals on a timer, and draws from `$.state` atoms.
import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'

import type { AgentView, BgTask, EtaView, Flag, Paths, RunState, TaskState, TaskStep, TokensState, UiState } from '../types'
import { detectCost, detectGrowth, detectProcessGone, detectRetries, detectStalled, mergeFlags, pushSample } from './anomalies'
import type { GoneItem, SizeSample } from './anomalies'
import { AVATAR_SIZE, INDICATOR_SIZE, LINE_AVATAR_SIZE, MAIN_AGENT_ID, avatarAlt, buildCast, castRowSegs, foldUsage, indicatorAlt } from './cast'
import type { Avatar, Cast } from './cast'
import { parseTheme, themeDraw } from './themes'
import type { ThemeDraw, ThemeName } from './themes'
import { computeEta, historyEstimate, historyRows, medianOf } from './eta'
import type { HistoryRow } from './eta'
import { fmtMoney, truncate } from './format'
import { applyPlanInput, asLoose, finishTask, parseTags, textOfMessage } from './task'
import type { Loose } from './task'
import { currentPhase, foldEvents, newRun, parseJournal, parseMetaName, parsePhases } from './journal'
import { buildBand, isRunActive, isTerminalStatus } from './view'
import type { BandModel, Row, Seg } from './view'

const P = 'run-progress-bar'
// Change the tag when a value's fields change: what an earlier version stored
// outlives a reload and is then read as the initial instead.
const SHAPE = 'v1'
const MAX_READ = 4 * 1024 * 1024 - 1
const GROWTH_WINDOW_MS = 30 * 60_000
const AGENT_LOG_GROWTH_FLOOR = 20 * 1024 * 1024
const HISTORY_KEY = 'history'
const HISTORY_MAX = 200
const COST_STEP_USD = 50

const taskA = atom({ plugin: 'run-progress-bar', key: 'task' } as const, null as TaskState | null, { shape: SHAPE })
const runA = atom({ plugin: 'run-progress-bar', key: 'run' } as const, null as RunState | null, { shape: SHAPE })
const flagsA = atom({ plugin: 'run-progress-bar', key: 'flags' } as const, [] as Flag[], { shape: SHAPE })
const bgA = atom({ plugin: 'run-progress-bar', key: 'bg' } as const, [] as BgTask[], { shape: SHAPE })
const costA = atom({ plugin: 'run-progress-bar', key: 'cost' } as const, null as number | null, { shape: SHAPE })
const etaA = atom({ plugin: 'run-progress-bar', key: 'eta' } as const, null as EtaView, { shape: SHAPE })
const uiA = atom({ plugin: 'run-progress-bar', key: 'ui' } as const, { isExpanded: false, dismissedAt: null } as UiState, { shape: SHAPE })
const nowA = atom({ plugin: 'run-progress-bar', key: 'now' } as const, 0, { shape: SHAPE })
const pathsA = atom({ plugin: 'run-progress-bar', key: 'paths' } as const, { sessionDir: null, runHint: null } as Paths, { shape: SHAPE })
const errorA = atom({ plugin: 'run-progress-bar', key: 'error' } as const, null as string | null, { shape: SHAPE })
const tokensA = atom({ plugin: 'run-progress-bar', key: 'tokens' } as const, { window: null, byAgent: {} } as TokensState, { shape: SHAPE })

// ---- configuration and working memory (module scope: a reload starts them over) ----

type Config = {
  pollMs: number
  stallMs: number
  growthPct: number
  costThreshold: number
  watchFiles: string[]
  showWhenIdle: boolean
  debug: boolean
  theme: ThemeName
  /** The `motion` option: false disables every animation of a drawn theme. */
  motion: boolean
}

let cfg: Config = { pollMs: 3000, stallMs: 10 * 60_000, growthPct: 50, costThreshold: 100, watchFiles: [], showWhenIdle: true, debug: false, theme: 'classic', motion: true }
const sizeSamples = new Map<string, SizeSample[]>()
let history: { rows: HistoryRow[]; at: number } | null = null
let isTicking = false
// Diagnostics (debug option): counted here, written to the store each tick.
let ticks = 0
let renders = 0
let loadedAt = 0
let lastRender: Record<string, unknown> | null = null

// ---- pure helpers ----

function growthSamples(): Record<string, SizeSample[]> {
  const out: Record<string, SizeSample[]> = {}
  for (const [path, samples] of sizeSamples) {
    const last = samples[samples.length - 1]
    if (last === undefined) continue
    const isAgentLog = /\/agent-[0-9a-f]+\.jsonl$/.test(path)
    if (isAgentLog && last.size < AGENT_LOG_GROWTH_FLOOR) continue
    out[path] = samples
  }
  return out
}

function detectAll(run: RunState | null, bg: readonly BgTask[], cost: number | null, now: number): Flag[] {
  const flags: Flag[] = []
  if (run !== null && !run.isDone) {
    const agents = Object.values(run.agents)
    if (run.mode === 'full') flags.push(...detectStalled(agents, now, cfg.stallMs))
    flags.push(...detectRetries(run.startedLabels, now))
    const gone: GoneItem[] = agents.filter(a => a.status === 'failed').map(a => ({ id: a.agentId, label: a.label, status: 'failed' }))
    flags.push(...detectProcessGone(gone, now))
  }
  flags.push(...detectProcessGone(bg.map(b => ({ id: b.id, label: b.description, status: b.status })), now))
  flags.push(...detectGrowth(growthSamples(), now, GROWTH_WINDOW_MS, cfg.growthPct))
  flags.push(...detectCost(cost, cfg.costThreshold, COST_STEP_USD, now))
  return flags
}

// ---- helpers on the engine (top-level, as the validator requires) ----

async function setError($: EngineInterface, err: unknown): Promise<void> {
  const text = err instanceof Error ? err.message : String(err)
  await update($, errorA, () => truncate(text, 120))
}

async function deriveSessionDir($: EngineInterface): Promise<string | null> {
  const [id, root, configDir, home] = await Promise.all([$.session.id(), $.session.root(), $.env.get('CLAUDE_CONFIG_DIR'), $.env.get('HOME')])
  const base = configDir !== undefined && configDir !== '' ? configDir : home !== undefined && home !== '' ? `${home}/.claude` : null
  if (base === null || id === '') return null
  const encodings = [root.replace(/[^A-Za-z0-9]/g, '-'), root.replace(/[^A-Za-z0-9~]/g, '-')]
  for (const enc of encodings) {
    const dir = `${base}/projects/${enc}/${id}`
    if (await $.fs.exists(dir)) return dir
  }
  return null
}

async function replayTask($: EngineInterface): Promise<void> {
  const messages = await $.session.messages()
  if (!Array.isArray(messages)) return
  const startedAt = (await $.session.usage()).startedAt
  let task: TaskState | null = null
  for (const m of messages) {
    for (const u of m.toolUses) {
      const cur = task
      if (u.tool === 'mcp__ccd_turn__update_plan') task = applyPlanInput(cur, asLoose(u.input), startedAt)
      else if (u.tool === 'mcp__ccd_turn__wrap_up' && cur !== null) task = finishTask(cur, 1)
    }
  }
  const found = task
  if (found !== null) await update($, taskA, prev => prev ?? found)
}

async function bootstrap($: EngineInterface): Promise<void> {
  const paths = await read($, pathsA)
  if (paths.sessionDir === null) {
    const dir = await deriveSessionDir($)
    if (dir !== null) await update($, pathsA, p => ({ ...p, sessionDir: dir }))
  }
  if ((await read($, taskA)) === null) await replayTask($)
}

async function loadHistory($: EngineInterface, now: number): Promise<HistoryRow[]> {
  if (history !== null && now - history.at < 60_000) return history.rows
  const rows = historyRows(await $.store.get(HISTORY_KEY))
  history = { rows, at: now }
  return rows
}

async function initRun($: EngineInterface, sessionDir: string, runId: string, dir: string, dirMtime: number): Promise<RunState> {
  let run = newRun(runId, dir, dirMtime)
  try {
    const metaPath = `${sessionDir}/workflows/${runId}.json`
    if (await $.fs.exists(metaPath)) {
      const stat = await $.fs.stat(metaPath)
      if (stat.size <= MAX_READ) {
        const parsed = asLoose(JSON.parse(await $.fs.read(metaPath)))
        const ts = typeof parsed.timestamp === 'string' ? Date.parse(parsed.timestamp) : NaN
        const script = typeof parsed.script === 'string' ? parsed.script : ''
        run = { ...newRun(runId, dir, Number.isFinite(ts) ? ts : dirMtime), name: parseMetaName(script), phases: parsePhases(script) }
      }
    }
  } catch {
    // The run's script file is optional: the journal still gives counts.
  }
  return run
}

/** Folds the run dir's listing into the agents: start backfill, last write, size, growth samples. */
async function foldFiles(
  $: EngineInterface,
  run: RunState,
  files: ReadonlyArray<{ name: string; size: number; mtimeMs: number }>,
  now: number,
): Promise<RunState> {
  let agents = run.agents
  let seenPhases = run.seenPhases
  let startedLabels = run.startedLabels
  let changed = false
  let lastWrite = run.lastActivityAt
  const setAgent = (id: string, a: AgentView): void => {
    if (agents === run.agents) agents = { ...agents }
    agents[id] = a
    changed = true
  }
  for (const f of files) {
    const meta = /^agent-([0-9a-f]+)\.meta\.json$/.exec(f.name)
    if (meta !== null) {
      const id = meta[1] ?? ''
      const a = agents[id]
      if (a === undefined) {
        if (run.mode === 'list-only' && f.size <= 65_536) {
          try {
            const m = asLoose(JSON.parse(await $.fs.read(`${run.dir}/${f.name}`)))
            const label = typeof m.description === 'string' ? m.description : id
            const phase = typeof m.workflowPhase === 'string' ? m.workflowPhase : ''
            setAgent(id, { agentId: id, label, phase, startedAt: f.mtimeMs, endedAt: null, status: 'running', lastWriteAt: null, size: null })
            if (phase !== '' && !seenPhases.includes(phase)) seenPhases = [...seenPhases, phase]
            startedLabels = [...startedLabels, label]
          } catch {
            // unreadable meta: the agent shows up once the journal names it
          }
        }
      } else if (f.mtimeMs > 0 && f.mtimeMs < a.startedAt) {
        setAgent(id, { ...a, startedAt: f.mtimeMs })
      }
      continue
    }
    const log = /^agent-([0-9a-f]+)\.jsonl$/.exec(f.name)
    if (log === null) continue
    const id = log[1] ?? ''
    if (f.mtimeMs > lastWrite) lastWrite = f.mtimeMs
    const path = `${run.dir}/${f.name}`
    sizeSamples.set(path, pushSample(sizeSamples.get(path) ?? [], { t: now, size: f.size }, GROWTH_WINDOW_MS))
    const a = agents[id]
    if (a === undefined) continue
    let endedAt = a.endedAt
    if (a.status !== 'running' && endedAt !== null && f.mtimeMs > a.startedAt && f.mtimeMs < endedAt) endedAt = f.mtimeMs
    if (a.lastWriteAt !== f.mtimeMs || a.size !== f.size || endedAt !== a.endedAt) setAgent(id, { ...a, lastWriteAt: f.mtimeMs, size: f.size, endedAt })
  }
  if (changed) return { ...run, agents, seenPhases, startedLabels, lastActivityAt: Math.max(run.lastActivityAt, lastWrite) }
  return lastWrite > run.lastActivityAt ? { ...run, lastActivityAt: lastWrite } : run
}

/** Writes a phase's duration to the history store once every agent of it has ended and the run moved on. */
async function recordHistory($: EngineInterface, run: RunState, now: number): Promise<RunState> {
  const phase = currentPhase(run)
  const toRecord: string[] = []
  for (const p of run.seenPhases) {
    if (run.recordedPhases.includes(p) || (p === phase && !run.isDone)) continue
    const list = Object.values(run.agents).filter(a => a.phase === p)
    if (list.length === 0 || list.some(a => a.status === 'running')) continue
    toRecord.push(p)
  }
  if (toRecord.length === 0) return run
  const rows = (await loadHistory($, now)).slice()
  for (const p of toRecord) {
    const list = Object.values(run.agents).filter(a => a.phase === p)
    const start = Math.min(...list.map(a => a.startedAt))
    const end = Math.max(...list.map(a => a.endedAt ?? a.startedAt))
    const durations = list.map(a => (a.endedAt ?? a.startedAt) - a.startedAt).filter(d => d >= 1000)
    rows.push({
      name: run.name,
      phase: p,
      phaseMs: Math.max(0, end - start),
      agentMedianMs: durations.length > 0 ? medianOf(durations) : 0,
      agents: list.length,
      at: now,
    })
  }
  const kept = rows.slice(-HISTORY_MAX)
  await $.store.set(HISTORY_KEY, kept)
  history = { rows: kept, at: now }
  return { ...run, recordedPhases: [...run.recordedPhases, ...toRecord] }
}

async function pollRun($: EngineInterface, paths: Paths, prev: RunState | null, now: number): Promise<RunState | null> {
  const sessionDir = paths.sessionDir
  if (sessionDir === null) return prev
  const root = `${sessionDir}/subagents/workflows`
  if (!(await $.fs.exists(root))) return prev
  const dirs = (await $.fs.list(root)).filter(d => d.kind === 'dir')
  const first = dirs[0]
  if (first === undefined) return prev
  let newest = first
  for (const d of dirs) if (d.mtimeMs > newest.mtimeMs) newest = d
  let chosen = newest
  if (prev !== null && !prev.isDone) {
    const own = dirs.find(d => d.name === prev.runId)
    if (own !== undefined && (newest.name === prev.runId || newest.mtimeMs <= prev.startedAt)) chosen = own
  }
  if (paths.runHint !== null) {
    const hinted = dirs.find(d => d.name === paths.runHint)
    if (hinted !== undefined && hinted.mtimeMs >= chosen.mtimeMs) chosen = hinted
  }
  const dir = `${root}/${chosen.name}`
  let run = prev !== null && prev.runId === chosen.name ? prev : await initRun($, sessionDir, chosen.name, dir, chosen.mtimeMs)
  const files = await $.fs.list(dir)
  const journal = files.find(f => f.name === 'journal.jsonl')
  if (journal !== undefined && journal.size !== run.journalSize) {
    if (journal.size < run.journalSize) run = await initRun($, sessionDir, chosen.name, dir, chosen.mtimeMs)
    if (journal.size <= MAX_READ) {
      const text = await $.fs.read(`${dir}/journal.jsonl`)
      const parsed = parseJournal(text, run.journalOffset)
      run = foldEvents(run, parsed.events, now)
      run = { ...run, journalOffset: parsed.offset, journalSize: journal.size, corruptLines: run.corruptLines + parsed.corrupt, mode: 'full' }
    } else {
      run = { ...run, journalSize: journal.size, mode: 'list-only' }
    }
  }
  run = await foldFiles($, run, files, now)
  const journalWrite = journal?.mtimeMs ?? 0
  if (journalWrite > run.lastActivityAt) run = { ...run, lastActivityAt: journalWrite }
  return recordHistory($, run, now)
}

async function pollBg($: EngineInterface, now: number): Promise<BgTask[]> {
  const prev = await read($, bgA)
  let list: BgTask[] = prev
  try {
    const infos = await $.agent.list()
    const byId = new Map(prev.map(b => [b.id, b] as const))
    const seen = new Set<string>()
    const fromAgents: BgTask[] = infos.map(info => {
      seen.add(info.id)
      const old = byId.get(info.id)
      const terminal = isTerminalStatus(info.status)
      return {
        id: info.id,
        kind: 'subagent',
        description: info.description !== '' ? info.description : (info.name ?? info.type),
        status: info.status,
        startedAt: old?.startedAt ?? now,
        endedAt: terminal ? (old?.endedAt ?? now) : null,
        runId: null,
      }
    })
    const others = prev
      .filter(b => !seen.has(b.id))
      .map(b => (b.kind === 'subagent' && b.endedAt === null ? { ...b, status: 'ended', endedAt: now } : b))
    list = [...others, ...fromAgents]
  } catch {
    // keep what we had
  }
  const pruned = list.filter(b => (b.endedAt === null ? now - b.startedAt < 24 * 60 * 60_000 : now - b.endedAt < 30 * 60_000)).slice(-50)
  if (JSON.stringify(pruned) !== JSON.stringify(prev)) await update($, bgA, () => pruned)
  return pruned
}

async function watchExtraFiles($: EngineInterface, now: number): Promise<void> {
  for (const path of cfg.watchFiles) {
    try {
      const stat = await $.fs.stat(path)
      sizeSamples.set(path, pushSample(sizeSamples.get(path) ?? [], { t: now, size: stat.size }, GROWTH_WINDOW_MS))
    } catch {
      // a file not there yet is not an anomaly
    }
  }
}

async function computeRunEta($: EngineInterface, run: RunState, now: number): Promise<EtaView> {
  const phase = currentPhase(run)
  if (phase === null) return null
  const inPhase = Object.values(run.agents).filter(a => a.phase === phase)
  const floor = Math.max(1000, cfg.pollMs)
  const samples: number[] = []
  for (const a of inPhase) if (a.status === 'done' && a.endedAt !== null && a.endedAt - a.startedAt >= floor) samples.push(a.endedAt - a.startedAt)
  const runningElapsed = inPhase.filter(a => a.status === 'running').map(a => now - a.startedAt)
  const rows = await loadHistory($, now)
  const idx = run.phases.indexOf(phase)
  const laterPhases = idx >= 0 ? run.phases.slice(idx + 1).map(p => historyEstimate(rows, run.name, p)) : []
  return computeEta({ samples, runningElapsed, parallelism: run.maxParallel, laterPhases })
}

/** Keeps the session model's context window in the token map (the power bars' cap). No breakdown is asked, so the call is free. */
async function refreshWindow($: EngineInterface): Promise<void> {
  try {
    const window = (await $.session.usage()).context.window
    if (!Number.isFinite(window) || window <= 0) return
    await update($, tokensA, t => (t.window === window ? t : { ...t, window }))
  } catch {
    // a host without the figure leaves the bars unknown
  }
}

async function tick($: EngineInterface): Promise<void> {
  if (isTicking) return
  isTicking = true
  let failed = false
  try {
    const now = await $.clock.now()
    let paths = await read($, pathsA)
    if (paths.sessionDir === null) {
      const dir = await deriveSessionDir($)
      if (dir !== null) {
        paths = { ...paths, sessionDir: dir }
        await update($, pathsA, () => paths)
      }
    }
    const prevRun = await read($, runA)
    let run = prevRun
    try {
      run = await pollRun($, paths, prevRun, now)
    } catch (err) {
      failed = true
      await setError($, err)
    }
    if (run !== prevRun) await update($, runA, () => run)
    const bg = await pollBg($, now)
    await watchExtraFiles($, now)
    const cost = await read($, costA)
    if (cfg.theme !== 'classic') await refreshWindow($)
    const eta = run !== null && isRunActive(run, now) ? await computeRunEta($, run, now) : null
    const prevEta = await read($, etaA)
    if (JSON.stringify(eta) !== JSON.stringify(prevEta)) await update($, etaA, () => eta)
    const prevFlags = await read($, flagsA)
    const { flags, added } = mergeFlags(prevFlags, detectAll(run, bg, cost, now))
    if (JSON.stringify(flags) !== JSON.stringify(prevFlags)) await update($, flagsA, () => flags)
    for (const f of added) $.ui.toast(`⚠ ${f.text}`, { timeoutMs: 8000 })
    await update($, nowA, () => now)
    if (!failed && (await read($, errorA)) !== null) await update($, errorA, () => null)
    ticks += 1
    if (cfg.debug) await writeDebug($, now)
  } catch (err) {
    await setError($, err)
  } finally {
    isTicking = false
  }
}

/** A small snapshot of what the mod sees, for reading off disk while debugging. */
async function writeDebug($: EngineInterface, now: number): Promise<void> {
  const [task, run, flags, bg, cost, eta, paths, error, tokens] = await Promise.all([
    read($, taskA),
    read($, runA),
    read($, flagsA),
    read($, bgA),
    read($, costA),
    read($, etaA),
    read($, pathsA),
    read($, errorA),
    read($, tokensA),
  ])
  await $.store.set('debug', {
    at: new Date(now).toISOString(),
    loadedAt: loadedAt > 0 ? new Date(loadedAt).toISOString() : null,
    ticks,
    renders,
    lastRender,
    theme: cfg.theme,
    motion: cfg.motion,
    tokens: { window: tokens.window, agents: Object.keys(tokens.byAgent).length, main: tokens.byAgent.main ?? null },
    paths,
    task: task === null ? null : { steps: task.steps.length, currentIndex: task.currentIndex, startedAt: task.startedAt, finishedAt: task.finishedAt },
    run: run === null ? null : { runId: run.runId, agents: Object.keys(run.agents).length, phases: run.phases, mode: run.mode, isDone: run.isDone },
    bg: bg.map(b => `${b.kind}:${b.status}`),
    flags: flags.map(f => f.id),
    cost,
    eta,
    error,
    surfaces: await $.session.surfaces(),
  })
}

async function applyNotification($: EngineInterface, text: string): Promise<void> {
  const tags = parseTags(text)
  const status = tags.status
  if (status === undefined || status === '') return
  const id = tags['task-id'] ?? tags.task_id ?? tags.id ?? null
  const toolUseId = tags['tool-use-id'] ?? tags.tool_use_id ?? null
  const runId = text.match(/wf_[0-9a-f]{8}-[0-9a-f]{3}/)?.[0] ?? null
  const now = await $.clock.now()
  const terminal = isTerminalStatus(status)
  let endedRun: string | null = null
  await update($, bgA, list =>
    list.map(b => {
      const hit = (id !== null && b.id === id) || (toolUseId !== null && b.id === toolUseId) || (runId !== null && b.runId === runId)
      if (!hit) return b
      if (b.kind === 'workflow' && terminal) endedRun = b.runId ?? runId
      return { ...b, status, endedAt: terminal ? (b.endedAt ?? now) : b.endedAt }
    }),
  )
  const done: string | null = endedRun ?? (terminal ? runId : null)
  if (done !== null) await update($, runA, run => (run !== null && run.runId === done && !run.isDone ? { ...run, isDone: true } : run))
}

async function noteBackgroundStart($: EngineInterface, e: Loose, toolUseId: string, isWorkflow: boolean, result: unknown): Promise<void> {
  const now = await $.clock.now()
  const resultText = JSON.stringify(result) ?? ''
  const runId = resultText.match(/wf_[0-9a-f]{8}-[0-9a-f]{3}/)?.[0] ?? null
  const script = typeof e.script === 'string' ? e.script : ''
  const description = isWorkflow
    ? (parseMetaName(script) ?? (typeof e.name === 'string' ? e.name : null) ?? runId ?? 'workflow')
    : truncate(String(e.description ?? e.command ?? 'shell'), 40)
  const task: BgTask = { id: toolUseId, kind: isWorkflow ? 'workflow' : 'shell', description, status: 'started', startedAt: now, endedAt: null, runId }
  await update($, bgA, list => [...list.filter(b => b.id !== task.id), task].slice(-50))
  if (isWorkflow && runId !== null) await update($, pathsA, p => ({ ...p, runHint: runId }))
}

// ---- drawing helpers ----

type TextCtor = Elements['terminal']['Text']
/** The tables with `Svg`: every surface but the terminal. */
type Table = Elements['desktop'] | Elements['vscode'] | Elements['mobile']
/** How to draw: the theme's drawing functions (null for classic, which keeps the glyphs) and whether motion is on. */
type DrawOpts = { theme: ThemeName; motion: boolean; draw: ThemeDraw | null }
type SvgAttrs = { source: string; alt: string; width: number; height: number; isInteractive?: boolean }

/** One segment as a Text, with only the props it sets: no prop reaches the surface as `undefined`. */
function segEl(Text: TextCtor, s: Seg) {
  const props: { color?: string; dimColor?: boolean; weight?: 'regular' | 'medium' | 'semibold'; size?: 'caption' | 'footnote' | 'body' } = {}
  if (s.color !== undefined) props.color = s.color
  if (s.dim === true) props.dimColor = true
  if (s.weight !== undefined) props.weight = s.weight
  else if (s.bold === true) props.weight = 'semibold'
  if (s.size !== undefined) props.size = s.size
  return <Text {...props}>{s.text}</Text>
}

/** Splits a row on its separators into chips, the row's leading indent dropped; the layout spaces the chips. */
function chipGroups(segs: readonly Seg[]): Seg[][] {
  const groups: Seg[][] = []
  let current: Seg[] = []
  let isChipStart = true
  for (const s of segs) {
    if (s.kind === 'sep') {
      if (current.length > 0) groups.push(current)
      current = []
      isChipStart = true
      continue
    }
    // A chip's first segment carries no indent or lead space: the layout spaces the chips.
    const text = isChipStart ? s.text.replace(/^\s+/, '') : s.text
    if (text === '') continue
    isChipStart = false
    current.push({ ...s, text })
  }
  if (current.length > 0) groups.push(current)
  return groups
}

/** A mark at the head of a row: a status glyph, or a tagged indicator. */
const isMark = (s: Seg): boolean => s.kind === 'indicator' || /^[⚠✓›○]\s*$/.test(s.text)

/** The mark column, two cells wide so every row's text starts at the same place: the theme's small SVG, or the glyph. */
function markCell(t: Table, s: Seg, o: DrawOpts) {
  const { Box, Text, Svg } = t
  if (o.draw !== null && s.indicator !== undefined) {
    const isLive = o.motion && s.indicator === 'current'
    const svg: SvgAttrs = { source: o.draw.indicatorSvg(s.indicator, isLive), alt: indicatorAlt(s.indicator), width: INDICATOR_SIZE, height: INDICATOR_SIZE }
    if (isLive) svg.isInteractive = true
    return (
      <Box width={2} flexShrink={0} alignItems="center">
        <Svg {...svg} />
      </Box>
    )
  }
  return (
    <Box width={2} flexShrink={0}>
      {segEl(Text, { ...s, text: s.text.trim().charAt(0) })}
    </Box>
  )
}

/**
 * One row: a fixed mark column (the row's own mark, a `lead` given by the
 * caller, or an empty column when `align`), then its chips, which wrap inside
 * the room left so a long row never pushes the column out of line.
 */
function rowEl(t: Table, segs: readonly Seg[], o: DrawOpts, align: boolean, lead?: RenderElement) {
  const { Box, Text } = t
  const groups = chipGroups(segs)
  const first = groups[0]
  const head = first?.[0]
  let mark: RenderElement | null = lead ?? null
  if (first !== undefined && head !== undefined && isMark(head)) {
    if (mark === null) mark = markCell(t, head, o)
    const rest = head.text.trim().slice(1).trim()
    const after = first.slice(1).map((s, i) => (i === 0 ? { ...s, text: s.text.replace(/^\s+/, '') } : s))
    groups[0] = rest !== '' ? [{ ...head, text: rest }, ...after] : after
  }
  if (mark === null && align) {
    mark = (
      <Box width={2} flexShrink={0}>
        <Text> </Text>
      </Box>
    )
  }
  const chips = groups
    .filter(g => g.length > 0)
    .map(g => (
      <Box flexDirection="row" flexWrap="wrap" alignItems="center">
        {g.map(s => segEl(Text, s))}
      </Box>
    ))
  const body = (
    <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap="sm" flexGrow={1} flexShrink={1} minWidth={0}>
      {chips}
    </Box>
  )
  if (mark === null) return body
  return (
    <Box flexDirection="row" alignItems="center" gap="sm">
      {mark}
      {body}
    </Box>
  )
}

const SECTION_TITLE: Readonly<Record<Row['kind'], string | null>> = {
  steps: 'Steps',
  workflow: 'Workflow',
  running: 'Workflow',
  eta: 'Workflow',
  background: 'Background',
  activity: null,
  flag: 'Flags',
}

/** The expanded rows grouped under small section titles, with room between sections. */
function sectionsEl(t: Table, rows: readonly Row[], o: DrawOpts): RenderElement[] {
  const { Box, Text } = t
  const groups: Array<{ title: string | null; rows: Row[] }> = []
  for (const r of rows) {
    const title = SECTION_TITLE[r.kind]
    const last = groups[groups.length - 1]
    if (last !== undefined && last.title === title) last.rows.push(r)
    else groups.push({ title, rows: [r] })
  }
  return groups.map(g => (
    <Box flexDirection="column" gap="xs">
      {g.title === null ? [] : [<Text size="footnote" weight="semibold" color="subtle">{g.title}</Text>]}
      {g.rows.map(r => rowEl(t, r.segs, o, true))}
    </Box>
  ))
}

/** The saiyan theme's cast: the workflow's agents (the session itself sits on the line), an avatar with its label each, wrapping in the text column. */
function castSection(t: Table, members: readonly Avatar[], hidden: number, draw: ThemeDraw) {
  const { Box, Text, Svg } = t
  const cells: RenderElement[] = members.map(av => {
    const svg: SvgAttrs = { source: draw.avatarSvg(av, AVATAR_SIZE), alt: avatarAlt(av), width: AVATAR_SIZE, height: AVATAR_SIZE }
    if (av.isAnimated) svg.isInteractive = true
    const label: Seg = { text: truncate(av.label, 18), size: 'footnote' }
    if (av.state === 'idle') label.dim = true
    if (av.state === 'running') label.weight = 'medium'
    return (
      <Box flexDirection="row" alignItems="center" gap="xs">
        <Svg {...svg} />
        {segEl(Text, label)}
      </Box>
    )
  })
  if (hidden > 0) cells.push(segEl(Text, { text: `+${hidden} more`, dim: true, size: 'footnote' }))
  return (
    <Box flexDirection="column" gap="xs">
      <Text size="footnote" weight="semibold" color="subtle">
        Cast
      </Text>
      <Box flexDirection="row" alignItems="center" gap="sm">
        <Box width={2} flexShrink={0}>
          <Text> </Text>
        </Box>
        <Box flexDirection="row" alignItems="center" flexWrap="wrap" gap="md" flexGrow={1} flexShrink={1} minWidth={0}>
          {cells}
        </Box>
      </Box>
    </Box>
  )
}

/** The session's avatar as the line's mark: asleep while the person has the turn, awake while the model works. */
function mentorCell(t: Table, mentor: Avatar, draw: ThemeDraw) {
  const { Box, Svg } = t
  const svg: SvgAttrs = { source: draw.avatarSvg(mentor, LINE_AVATAR_SIZE), alt: avatarAlt(mentor), width: LINE_AVATAR_SIZE, height: LINE_AVATAR_SIZE }
  if (mentor.isAnimated) svg.isInteractive = true
  return (
    <Box width={2} flexShrink={0} alignItems="center">
      <Svg {...svg} />
    </Box>
  )
}

/** The band on a proportional surface: the line as chips with the toggle at the right, then the cast (when the run has agents) and the sections. */
function drawBand(t: Table, model: BandModel, cast: Cast | null, toggle: RenderElement, error: string | null, o: DrawOpts) {
  const { Box, Text } = t
  const draw = o.draw
  const mentor = draw !== null ? cast?.avatars.find(a => a.id === MAIN_AGENT_ID) : undefined
  const line =
    draw !== null && mentor !== undefined && model.mode === 'running' ? rowEl(t, model.line, o, false, mentorCell(t, mentor, draw)) : rowEl(t, model.line, o, false)
  const body: RenderElement[] = []
  if (draw !== null && cast !== null && model.rows.length > 0) {
    const members = cast.avatars.filter(a => a.id !== MAIN_AGENT_ID)
    if (members.length > 0 || cast.hidden > 0) body.push(castSection(t, members, cast.hidden, draw))
  }
  body.push(...sectionsEl(t, model.rows, o))
  if (error !== null) {
    body.push(
      <Text color="warning" dimColor size="footnote">
        {`run-progress-bar: ${error}`}
      </Text>,
    )
  }
  return (
    <Box flexDirection="column" gap="sm">
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
        {line}
        {toggle}
      </Box>
      {body}
    </Box>
  )
}

// ---- registration ----

export const register: Register = (on, options) => {
  const num = (key: string, fallback: number): number => {
    const v = Number(options[key])
    return Number.isFinite(v) && v > 0 ? v : fallback
  }
  cfg = {
    pollMs: num('pollSeconds', 3) * 1000,
    stallMs: num('stallMinutes', 10) * 60_000,
    growthPct: num('growthPercent', 50),
    costThreshold: num('costThresholdUsd', 100),
    watchFiles: String(options.watchFiles ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0),
    showWhenIdle: options.showWhenIdle !== false,
    debug: options.debug === true,
    theme: parseTheme(options.theme),
    motion: options.motion !== 'off',
  }

  on('session.start', async ($, e, next) => {
    try {
      loadedAt = await $.clock.now()
      await bootstrap($)
    } catch (err) {
      await setError($, err)
    }
    if (cfg.debug) $.ui.toast('run-progress-bar loaded (debug on)', { timeoutMs: 6000 })
    $.clock.every(cfg.pollMs, () => tick($))
    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const tp = asLoose(e).transcript_path
    if (typeof tp === 'string' && tp.endsWith('.jsonl')) {
      const dir = tp.slice(0, -'.jsonl'.length)
      await update($, pathsA, p => (p.sessionDir === dir ? p : { ...p, sessionDir: dir }))
    }
    return next(e)
  }).catch((_$, e, next) => next(e))

  // One hook keyed on the tool's name: a matcher on an MCP tool name makes the
  // event's type union too deep for TypeScript once every MCP tool is declared.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const raw = asLoose(e)
    const isPlan = tool === 'mcp__ccd_turn__update_plan'
    const isWrap = tool === 'mcp__ccd_turn__wrap_up'
    const isWorkflow = tool === 'Workflow'
    const isBgShell = tool === 'Bash' && raw.run_in_background === true
    if (!isPlan && !isWrap && !isWorkflow && !isBgShell) return next(e)
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    try {
      if (isPlan) {
        const now = await $.clock.now()
        await update($, taskA, prev => applyPlanInput(prev, raw, now))
      } else if (isWrap) {
        const now = await $.clock.now()
        await update($, taskA, prev => (prev === null ? prev : finishTask(prev, now)))
        await update($, uiA, u => ({ ...u, isExpanded: false }))
      } else {
        await noteBackgroundStart($, raw, e.tool_use_id, isWorkflow, 'result' in ran ? ran.result : null)
      }
    } catch (err) {
      await setError($, err)
    }
    return ran
  }).catch((_$, e, next) => next(e))

  on('session.append', async ($, e, next) => {
    const ran = await next(e)
    try {
      const text = textOfMessage(e.message)
      if (text.includes('<task-notification>')) await applyNotification($, text)
    } catch (err) {
      await setError($, err)
    }
    return ran
  }).catch((_$, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const usd = e.cost?.usd
    if (typeof usd === 'number' && Number.isFinite(usd)) await update($, costA, () => usd)
    return next(e)
  })

  // Every turn's token counts, per agent (the main session without an agentId): the power bars' numerator.
  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    try {
      const usage = e.usage ?? ran.usage
      if (usage !== undefined) {
        const at = await $.clock.now()
        await update($, tokensA, t => foldUsage(t, e.agentId, usage, at))
      }
    } catch (err) {
      await setError($, err)
    }
    return ran
  }).catch((_$, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    renders += 1
    lastRender = { surface: e.surface, columns: e.props.bodyColumns, maxRows: e.props.maxRows, isWorking: e.props.isWorking, hasSurvey: e.props.hasSurvey }
    if (e.props.hasSurvey) return next(e)
    const [task, run, flags, bg, cost, eta, ui, tickedAt, error, paths, tokens] = await Promise.all([
      read($, taskA),
      read($, runA),
      read($, flagsA),
      read($, bgA),
      read($, costA),
      read($, etaA),
      read($, uiA),
      read($, nowA),
      read($, errorA),
      read($, pathsA),
      read($, tokensA),
    ])
    const now = tickedAt > 0 ? tickedAt : Date.now()
    const model = buildBand({
      task,
      run,
      flags,
      bg,
      cost,
      eta,
      now,
      columns: e.props.bodyColumns,
      isExpanded: ui.isExpanded,
      dismissedAt: ui.dismissedAt,
      isWorking: e.props.isWorking,
      isProportional: e.surface !== 'terminal',
    })
    const { Box, Text, Button } = $.ui.resolve(e)
    const seg = (s: Seg) => segEl(Text, s)
    if (model === null) {
      if (!cfg.showWhenIdle && !cfg.debug) return next(e)
      // A dim marker while nothing runs: the bar is installed, and this is what the session has cost.
      let idle = `○ idle · ${fmtMoney(cost)} this session`
      if (cfg.debug) idle += ` · ticks ${ticks} · renders ${renders} · dir ${paths.sessionDir === null ? 'unresolved' : 'ok'}`
      if (error !== null) idle += ` · ${error}`
      return <Box flexDirection="row">{seg({ text: idle, dim: true, size: 'footnote' })}</Box>
    }
    const row = (segs: Seg[]) => <Box flexDirection="row">{segs.map(seg)}</Box>
    const toggle =
      model.mode === 'finished' ? (
        <Button
          key="dismiss"
          label="Dismiss"
          hotkey="x"
          plain
          onPress={async () => {
            const at = await $.clock.now()
            await update($, uiA, u => ({ ...u, dismissedAt: at }))
          }}
        />
      ) : ui.isExpanded ? (
        <Button key="collapse" label="Collapse" hotkey="c" plain onPress={() => update($, uiA, u => ({ ...u, isExpanded: false }))} />
      ) : (
        <Button key="expand" label="Expand" hotkey="e" plain onPress={() => update($, uiA, u => ({ ...u, isExpanded: true }))} />
      )
    let cast: Cast | null = null
    if (cfg.theme !== 'classic' && model.mode === 'running') {
      // The same runs the workflow rows show: the live one, or one just finished. The session itself leads the cast.
      const agents = run !== null && (isRunActive(run, now) || run.isDone) ? Object.values(run.agents) : []
      cast = buildCast({ agents, flags, tokens: tokens.byAgent, window: tokens.window, isWorking: e.props.isWorking, motion: cfg.motion })
    }
    if (e.surface !== 'terminal') {
      return drawBand($.ui.resolve(e), model, cast, toggle, error, { theme: cfg.theme, motion: cfg.motion, draw: themeDraw(cfg.theme) })
    }
    // The terminal: monospaced rows, separators as text, the cast as chips.
    const rows = model.rows.map(r => row(r.segs))
    if (cast !== null && ui.isExpanded) rows.unshift(row(castRowSegs(cast)))
    if (error !== null) {
      rows.push(
        <Text color="warning" dimColor>
          {`run-progress-bar: ${error}`}
        </Text>,
      )
    }
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row">{model.line.map(seg)}</Box>
          {toggle}
        </Box>
        {rows}
      </Box>
    )
  })
}
