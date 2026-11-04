// Pure: turns state into the band's rows. The render hook only maps these
// segments to elements, so what the band says is testable without a surface.
import type { BgTask, EtaView, Flag, RunState, TaskState } from '../types'
import { fmtAgo, fmtDuration, fmtEta, fmtMoney, truncate } from './format'
import { currentPhase, phaseCounts, runningCount } from './journal'

/** A step's or the line's mark: drawn as a glyph on the terminal, as a small SVG by the saiyan theme. */
export type Indicator = 'current' | 'done' | 'pending'

export type Seg = {
  text: string
  color?: string
  dim?: boolean
  bold?: boolean
  /** `sep` splits a row into chips on a proportional surface; `indicator` is a mark the theme may redraw. */
  kind?: 'sep' | 'indicator'
  indicator?: Indicator
  size?: 'caption' | 'footnote' | 'body'
  weight?: 'regular' | 'medium' | 'semibold'
}

export type RowKind = 'steps' | 'workflow' | 'running' | 'eta' | 'background' | 'activity' | 'flag'

export type Row = { kind: RowKind; segs: Seg[] }

export type BandModel = {
  mode: 'running' | 'finished'
  /** The collapsed line. */
  line: Seg[]
  /** The expanded rows, the collapsed line excluded. */
  rows: Row[]
  /** Plain-text label of the collapsed line (screen readers, status line). */
  label: string
}

export type ViewInput = {
  task: TaskState | null
  run: RunState | null
  flags: readonly Flag[]
  bg: readonly BgTask[]
  cost: number | null
  eta: EtaView
  now: number
  columns: number
  isExpanded: boolean
  dismissedAt: number | null
  /** Whether a model turn is running (`e.props.isWorking`). */
  isWorking: boolean
  /** A proportional font (desktop): no space padding, one column, chips spaced by the layout. */
  isProportional: boolean
}

export const SEP: Seg = { text: ' · ', color: 'inactive', kind: 'sep' }
const FINISHED_FOR_MS = 60_000
const RUN_QUIET_MS = 10 * 60_000
const BG_MAX_AGE_MS = 4 * 60 * 60_000
const BG_SHOW_ENDED_MS = 30 * 60_000

const TERMINAL = new Set(['completed', 'failed', 'killed', 'done', 'ended'])

export const isTerminalStatus = (s: string): boolean => TERMINAL.has(s)

export function isBgActive(b: BgTask, now: number): boolean {
  return !isTerminalStatus(b.status) && b.endedAt === null && now - b.startedAt < BG_MAX_AGE_MS
}

/** A run counts as active while agents run, or for a quiet spell between phases. */
export function isRunActive(run: RunState, now: number): boolean {
  if (run.isDone) return false
  return runningCount(run.agents) > 0 || now - run.lastActivityAt < RUN_QUIET_MS
}

export function isTaskActive(task: TaskState): boolean {
  return task.finishedAt === null && task.currentIndex >= 0
}

const flagWord = (f: Flag): string =>
  f.kind === 'stalled' ? 'Stalled' : f.kind === 'retry' ? 'Retry' : f.kind === 'growth' ? 'Output growth' : f.kind === 'process-gone' ? 'Process gone' : 'Cost'

export function joinSegs(segs: readonly Seg[]): string {
  return segs.map(s => s.text).join('')
}

const INDICATOR_SEG: Readonly<Record<Indicator, Seg>> = {
  done: { text: '✓ ', color: 'success', kind: 'indicator', indicator: 'done' },
  current: { text: '› ', color: 'claude', kind: 'indicator', indicator: 'current' },
  pending: { text: '○ ', color: 'inactive', kind: 'indicator', indicator: 'pending' },
}

function stepRows(task: TaskState, now: number, columns: number, isProportional: boolean): Row[] {
  const twoCols = !isProportional && columns >= 100
  const half = Math.ceil(task.steps.length / 2)
  const colWidth = Math.max(16, twoCols ? Math.floor((columns - 6) / 2) : columns - 4)
  const stepSeg = (i: number): Seg[] => {
    const s = task.steps[i]
    if (s === undefined) return [{ text: ''.padEnd(colWidth) }]
    const isCur = i === task.currentIndex
    const mark = INDICATOR_SEG[s.status === 'completed' ? 'done' : isCur || s.status === 'in_progress' ? 'current' : 'pending']
    const since = fmtDuration(now - task.updatedAt)
    if (isProportional) {
      const text: Seg = { text: truncate(s.content, 80) }
      if (isCur) text.weight = 'semibold'
      else text.dim = true
      const segs: Seg[] = [mark, text]
      if (isCur) segs.push({ text: ` ${since}`, color: 'subtle', size: 'footnote' })
      return segs
    }
    const tail = isCur ? `  ← current, ${since}` : ''
    const room = Math.max(8, colWidth - 2 - tail.length)
    return [mark, { text: truncate(s.content, room).padEnd(room), bold: isCur, dim: s.status === 'pending' && !isCur }, { text: tail, color: 'subtle' }]
  }
  const rows: Row[] = []
  if (twoCols) {
    for (let i = 0; i < half; i += 1) rows.push({ kind: 'steps', segs: [{ text: ' ' }, ...stepSeg(i), { text: '  ' }, ...stepSeg(i + half)] })
  } else {
    for (let i = 0; i < task.steps.length; i += 1) rows.push({ kind: 'steps', segs: [{ text: ' ' }, ...stepSeg(i)] })
  }
  return rows
}

function runRows(run: RunState, isActive: boolean, flags: readonly Flag[], eta: EtaView, now: number, isProportional: boolean): Row[] {
  const rows: Row[] = []
  const counts = phaseCounts(run)
  const phase = currentPhase(run)
  const total = run.phases.length > 0 ? run.phases.length : counts.length
  const index = phase === null ? 0 : counts.findIndex(c => c.phase === phase) + 1
  // Under the desktop's "Workflow" title the word itself is not repeated.
  const head: Seg[] = [
    ...(isProportional ? [] : [{ text: '   Workflow ', color: 'subtle' } satisfies Seg]),
    { text: run.name ?? run.runId, bold: true },
    SEP,
    { text: total > 0 ? `phase ${index} of ${total}` : 'phases unknown' },
    SEP,
    { text: `started ${fmtAgo(now - run.startedAt)}`, dim: true },
  ]
  if (run.isDone) head.push(SEP, { text: 'finished', color: 'success' })
  if (run.mode === 'list-only') head.push(SEP, { text: 'journal too large, counts from meta files', color: 'warning' })
  if (run.corruptLines > 0) head.push(SEP, { text: `${run.corruptLines} bad journal lines skipped`, color: 'warning' })
  rows.push({ kind: 'workflow', segs: head })

  if (counts.length > 0) {
    const chips: Seg[] = [{ text: '   ' }]
    counts.forEach((c, i) => {
      if (i > 0) chips.push(SEP)
      const isCur = c.phase === phase && isActive
      const state: Seg =
        c.total > 0 && c.running === 0 && !isCur
          ? { text: '✓', color: c.failed > 0 ? 'warning' : 'success' }
          : isCur
            ? { text: '›', color: 'claude' }
            : { text: '○', color: 'inactive' }
      chips.push({ text: `${truncate(c.phase, 18)} ` }, state, {
        text: c.total > 0 ? ` ${c.done + c.failed}/${c.total}${isCur ? '+' : ''}` : '',
      })
      if (isCur && c.running > 0) chips.push({ text: ` (${c.running} running, max ${run.maxParallel} parallel)`, dim: true, size: 'footnote' })
    })
    rows.push({ kind: 'workflow', segs: chips })
  }

  const running = Object.values(run.agents)
    .filter(a => a.status === 'running')
    .sort((a, b) => a.startedAt - b.startedAt)
  if (running.length > 0) {
    const segs: Seg[] = isProportional ? [{ text: 'running', color: 'subtle', size: 'footnote' }, SEP] : [{ text: '   running: ', color: 'subtle' }]
    running.slice(0, 8).forEach((a, i) => {
      if (i > 0) segs.push(SEP)
      const stalled = flags.some(f => f.id === `stalled:${a.agentId}`)
      segs.push({ text: truncate(a.label, 28) }, { text: ` ${fmtDuration(now - a.startedAt)}${stalled ? ' ⚠' : ''}`, color: stalled ? 'warning' : 'subtle', size: 'footnote' })
    })
    if (running.length > 8) segs.push({ text: ` +${running.length - 8} more`, dim: true })
    rows.push({ kind: 'running', segs })
  }

  if (eta !== null && isActive) {
    const later = run.phases.length > 0 && phase !== null && run.phases.includes(phase) ? run.phases.length - run.phases.indexOf(phase) - 1 : 0
    const fromHistory = later - eta.unestimated
    let basis = `p25–p75 of ${eta.samples} sample${eta.samples === 1 ? '' : 's'} in ${phase ?? 'this phase'} ÷ ${run.maxParallel} parallel`
    if (fromHistory > 0) basis += `, +${fromHistory} later phase${fromHistory === 1 ? '' : 's'} from history`
    if (eta.unestimated > 0) basis += `, ${eta.unestimated} unestimated`
    rows.push({
      kind: 'eta',
      segs: isProportional
        ? [{ text: 'ETA basis', color: 'subtle', size: 'footnote' }, SEP, { text: `${basis} (est)`, dim: true, size: 'footnote' }]
        : [{ text: '   ETA basis: ', color: 'subtle' }, { text: `${basis} (est)`, dim: true, size: 'footnote' }],
    })
  }
  return rows
}

function bgRow(bg: readonly BgTask[], now: number, isProportional: boolean): Row | null {
  const shown = bg.filter(b => isBgActive(b, now) || (b.endedAt !== null && now - b.endedAt < BG_SHOW_ENDED_MS)).slice(-6)
  if (shown.length === 0) return null
  // Under the desktop's "Background" title the word itself is not repeated.
  const segs: Seg[] = isProportional ? [] : [{ text: '   Background: ', color: 'subtle' }]
  shown.forEach((b, i) => {
    if (i > 0) segs.push(SEP)
    const active = isBgActive(b, now)
    const word = active ? (b.status === 'started' ? `started ${fmtAgo(now - b.startedAt)}, no report yet` : `${b.status} ${fmtDuration(now - b.startedAt)}`) : b.status
    segs.push({ text: `${b.kind} ` }, { text: truncate(b.description, 30), bold: active }, {
      text: ` ${word}`,
      color: b.status === 'failed' || b.status === 'killed' ? 'error' : active ? 'subtle' : 'success',
      size: 'footnote',
    })
  })
  return { kind: 'background', segs }
}

export function buildBand(input: ViewInput): BandModel | null {
  const { task, run, flags, bg, cost, eta, now, columns } = input
  const activeTask: TaskState | null = task !== null && isTaskActive(task) ? task : null
  const activeRun: RunState | null = run !== null && isRunActive(run, now) ? run : null
  const activeBg = bg.filter(b => isBgActive(b, now))
  const finishedTask: TaskState | null =
    task !== null && task.finishedAt !== null && now - task.finishedAt < FINISHED_FOR_MS && activeRun === null && activeBg.length === 0 ? task : null

  if (finishedTask !== null && finishedTask.finishedAt !== null) {
    if (input.dismissedAt !== null && input.dismissedAt >= finishedTask.finishedAt) return null
    const line: Seg[] = [
      { text: '✓ done', color: 'success', bold: true, kind: 'indicator', indicator: 'done' },
      SEP,
      { text: `${finishedTask.steps.filter(s => s.status === 'completed').length}/${finishedTask.steps.length} steps` },
      SEP,
      { text: fmtDuration(finishedTask.finishedAt - finishedTask.startedAt) },
      SEP,
      { text: fmtMoney(cost) },
    ]
    return { mode: 'finished', line, rows: [], label: joinSegs(line) }
  }
  if (activeTask === null && activeRun === null && activeBg.length === 0) return null
  // A task list with no model turn running is a session waiting on the person, not work in flight.
  if (!input.isWorking && activeRun === null && activeBg.length === 0) return null

  // ---- collapsed line ----
  const line: Seg[] = []
  const firstFlag = flags[0]
  if (firstFlag !== undefined) {
    line.push({ text: flags.length === 1 ? `⚠ ${flagWord(firstFlag)}` : `⚠ ${flags.length} flags`, color: 'warning', bold: true }, SEP)
  } else {
    line.push({ text: '›', color: 'claude', bold: true, kind: 'indicator', indicator: 'current' })
  }
  const currentStep = activeTask !== null ? activeTask.steps[activeTask.currentIndex] : undefined
  const title =
    currentStep !== undefined
      ? currentStep.content
      : activeRun !== null
        ? `Workflow ${activeRun.name ?? activeRun.runId}`
        : (activeBg[0]?.description ?? 'Background work')
  // The desktop wraps and spaces chips itself, so its title keeps more of its words.
  const titleRoom = input.isProportional ? 64 : Math.max(12, Math.min(48, Math.floor(columns * 0.3)))
  line.push({ text: ` ${truncate(title, titleRoom)}`, weight: 'medium' })
  if (activeTask !== null) line.push(SEP, { text: `step ${activeTask.currentIndex + 1}/${activeTask.steps.length}` })
  if (activeRun !== null) {
    const phase = currentPhase(activeRun)
    if (phase !== null) {
      const c = phaseCounts(activeRun).find(p => p.phase === phase)
      const done = c === undefined ? 0 : c.done + c.failed
      const total = c === undefined ? 0 : c.total
      line.push(SEP, { text: `${truncate(phase, 16)} ${done}/${total}+` })
    } else if (activeRun.mode === 'list-only') {
      line.push(SEP, { text: `${Object.keys(activeRun.agents).length} agents` })
    }
  } else if (run !== null && activeTask !== null) {
    line.push(SEP, { text: '—', color: 'inactive' })
  }
  const startedAt = activeTask !== null ? activeTask.startedAt : activeRun !== null ? activeRun.startedAt : (activeBg[0]?.startedAt ?? now)
  line.push(SEP, { text: fmtDuration(now - startedAt) })
  line.push(SEP, { text: fmtEta(activeRun !== null ? eta : null), dim: activeRun === null || eta === null })
  line.push(SEP, { text: fmtMoney(cost), dim: cost === null })

  if (!input.isExpanded) return { mode: 'running', line, rows: [], label: joinSegs(line) }

  // ---- expanded rows ----
  const rows: Row[] = []
  if (task !== null) rows.push(...stepRows(task, now, columns, input.isProportional))
  if (run !== null && (activeRun !== null || run.isDone)) rows.push(...runRows(run, activeRun !== null, flags, eta, now, input.isProportional))
  const bgLine = bgRow(bg, now, input.isProportional)
  if (bgLine !== null) rows.push(bgLine)

  const lastActivity = Math.max(run !== null ? run.lastActivityAt : 0, task !== null ? task.updatedAt : 0)
  const tail: Seg[] = [{ text: '   Last activity ', color: 'subtle', size: 'footnote' }, { text: lastActivity > 0 ? fmtAgo(now - lastActivity) : '—', size: 'footnote' }]
  if (flags.length === 0) tail.push(SEP, { text: 'flags: none', dim: true, size: 'footnote' })
  rows.push({ kind: 'activity', segs: tail })
  for (const f of flags) rows.push({ kind: 'flag', segs: [{ text: '   ⚠ ', color: 'warning' }, { text: f.text, color: 'warning' }, { text: `  (${fmtAgo(now - f.at)})`, dim: true, size: 'footnote' }] })

  return { mode: 'running', line, rows, label: joinSegs(line) }
}
