// Pure: workflow journal parsing and folding. No `$` here, so it is testable
// without the engine. The journal carries no timestamps: callers stamp events
// with the time they observed them.
import type { AgentView, RunState } from '../types'

export type JournalEvent =
  | { type: 'launched' }
  | { type: 'started'; key: string; agentId: string; label: string; phase: string }
  | { type: 'result'; key: string; agentId: string }
  | { type: 'failed'; key: string; agentId: string }

export type ParsedJournal = {
  events: JournalEvent[]
  /** Offset just past the last complete line; a trailing partial line waits. */
  offset: number
  /** Lines that were not JSON objects with the fields their kind needs. */
  corrupt: number
  /** Lines of a kind this version does not know. */
  skipped: number
}

const isStr = (v: unknown): v is string => typeof v === 'string'

/** One line → event; null for a line that is not usable; 'skip' for an unknown kind. */
export function parseLine(line: string): JournalEvent | 'skip' | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  switch (r.type) {
    case 'launched':
      return { type: 'launched' }
    case 'started':
      if (!isStr(r.agentId) || !isStr(r.label)) return null
      return {
        type: 'started',
        key: isStr(r.key) ? r.key : '',
        agentId: r.agentId,
        label: r.label,
        phase: isStr(r.phase) ? r.phase : '',
      }
    case 'result':
    case 'failed':
      if (!isStr(r.agentId)) return null
      return { type: r.type, key: isStr(r.key) ? r.key : '', agentId: r.agentId }
    default:
      return 'skip'
  }
}

/** Parses every whole line from `offset`; the trailing partial line is left for the next read. */
export function parseJournal(text: string, offset = 0): ParsedJournal {
  const events: JournalEvent[] = []
  let corrupt = 0
  let skipped = 0
  let pos = Math.max(0, Math.min(offset, text.length))
  for (;;) {
    const nl = text.indexOf('\n', pos)
    if (nl < 0) break
    const line = text.slice(pos, nl).trim()
    pos = nl + 1
    if (line === '') continue
    const ev = parseLine(line)
    if (ev === null) corrupt += 1
    else if (ev === 'skip') skipped += 1
    else events.push(ev)
  }
  return { events, offset: pos, corrupt, skipped }
}

export function newRun(runId: string, dir: string, startedAt: number): RunState {
  return {
    runId,
    dir,
    name: null,
    phases: [],
    seenPhases: [],
    startedAt,
    agents: {},
    startedLabels: [],
    maxParallel: 1,
    journalOffset: 0,
    journalSize: 0,
    mode: 'full',
    corruptLines: 0,
    lastActivityAt: startedAt,
    isDone: false,
    recordedPhases: [],
  }
}

export function runningCount(agents: Readonly<Record<string, AgentView>>): number {
  let n = 0
  for (const a of Object.values(agents)) if (a.status === 'running') n += 1
  return n
}

/** Folds events into the run. `observedAt` stamps starts and ends. Pure. */
export function foldEvents(run: RunState, events: readonly JournalEvent[], observedAt: number): RunState {
  if (events.length === 0) return run
  const agents: Record<string, AgentView> = { ...run.agents }
  const startedLabels = run.startedLabels.slice()
  const seenPhases = run.seenPhases.slice()
  let maxParallel = run.maxParallel
  let running = runningCount(agents)
  for (const ev of events) {
    if (ev.type === 'launched') continue
    if (ev.type === 'started') {
      startedLabels.push(ev.label)
      if (ev.phase !== '' && !seenPhases.includes(ev.phase)) seenPhases.push(ev.phase)
      if (agents[ev.agentId] === undefined) {
        agents[ev.agentId] = {
          agentId: ev.agentId,
          label: ev.label,
          phase: ev.phase,
          startedAt: observedAt,
          endedAt: null,
          status: 'running',
          lastWriteAt: null,
          size: null,
        }
        running += 1
        if (running > maxParallel) maxParallel = running
      }
      continue
    }
    const status = ev.type === 'result' ? 'done' : 'failed'
    const prev = agents[ev.agentId]
    if (prev !== undefined) {
      if (prev.status === 'running') running -= 1
      agents[ev.agentId] = { ...prev, status, endedAt: prev.endedAt ?? observedAt }
    } else {
      // A result whose start was never seen (journal read mid-way): count it, duration unknown.
      agents[ev.agentId] = {
        agentId: ev.agentId,
        label: ev.agentId,
        phase: '',
        startedAt: observedAt,
        endedAt: observedAt,
        status,
        lastWriteAt: null,
        size: null,
      }
    }
  }
  return {
    ...run,
    agents,
    startedLabels,
    seenPhases,
    maxParallel: Math.max(1, maxParallel),
    lastActivityAt: Math.max(run.lastActivityAt, observedAt),
  }
}

function metaBlock(script: string): string {
  const m = script.match(/export\s+const\s+meta\s*=\s*\{([\s\S]*?)\n\}/)
  return m?.[1] ?? script
}

function unescapeLiteral(s: string): string {
  return s.replace(/\\(['"`\\])/g, '$1')
}

/** Phase titles from a workflow script's `meta.phases` literal, in order; [] when none. */
export function parsePhases(script: string): string[] {
  const block = metaBlock(script)
  const m = block.match(/phases\s*:\s*\[([\s\S]*?)\]/)
  const body = m?.[1]
  if (body === undefined) return []
  const titles: string[] = []
  const re = /title\s*:\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g
  let t: RegExpExecArray | null
  while ((t = re.exec(body)) !== null) {
    const title = t[2]
    if (title !== undefined) titles.push(unescapeLiteral(title))
  }
  return titles
}

/** The `name` of a workflow script's `meta` literal; null when none. */
export function parseMetaName(script: string): string | null {
  const m = metaBlock(script).match(/\bname\s*:\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/)
  const name = m?.[2]
  return name === undefined ? null : unescapeLiteral(name)
}

/** The phase being worked on: the latest-seen phase with running agents, else the latest seen. */
export function currentPhase(run: RunState): string | null {
  for (let i = run.seenPhases.length - 1; i >= 0; i -= 1) {
    const phase = run.seenPhases[i]
    if (phase === undefined) continue
    for (const a of Object.values(run.agents)) if (a.phase === phase && a.status === 'running') return phase
  }
  return run.seenPhases[run.seenPhases.length - 1] ?? null
}

export type PhaseCount = { phase: string; done: number; failed: number; running: number; total: number }

/** Counts per phase, in meta order first, then phases only the journal named. */
export function phaseCounts(run: RunState): PhaseCount[] {
  const order = [...run.phases]
  for (const p of run.seenPhases) if (!order.includes(p)) order.push(p)
  return order.map(phase => {
    const c: PhaseCount = { phase, done: 0, failed: 0, running: 0, total: 0 }
    for (const a of Object.values(run.agents)) {
      if (a.phase !== phase) continue
      c.total += 1
      if (a.status === 'done') c.done += 1
      else if (a.status === 'failed') c.failed += 1
      else c.running += 1
    }
    return c
  })
}
