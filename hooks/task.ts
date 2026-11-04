// Pure: the task list as the ccd `update_plan` / `wrap_up` tool calls shape it,
// and the small parsers the hooks need. No `$` here, so it is testable.
import type { TaskState, TaskStep } from '../types'

export type Loose = Record<string, unknown>

export const asLoose = (v: unknown): Loose => (v !== null && typeof v === 'object' ? (v as Loose) : {})

/**
 * Applies one update_plan input. `items` replaces the list; `advance`, `done`
 * and `start` move it. A move after wrap_up reopens the task (the app keeps
 * the same list across turns), keeping its original start.
 */
export function applyPlanInput(prev: TaskState | null, input: Loose, at: number): TaskState | null {
  if (Array.isArray(input.items)) {
    const steps: TaskStep[] = []
    for (const it of input.items) {
      const o = asLoose(it)
      const status = o.status === 'in_progress' || o.status === 'completed' ? o.status : 'pending'
      steps.push({ content: typeof o.content === 'string' ? o.content : '(step)', status })
    }
    const keepStart = prev !== null && prev.finishedAt === null && input.scope !== 'new_task'
    return {
      steps,
      currentIndex: steps.findIndex(s => s.status === 'in_progress'),
      startedAt: keepStart ? prev.startedAt : at,
      finishedAt: null,
      updatedAt: at,
    }
  }
  if (prev === null) return null
  const steps = prev.steps.slice()
  let currentIndex = prev.currentIndex
  let moved = false
  const complete = (i: number): void => {
    const s = steps[i]
    if (s === undefined) return
    steps[i] = { ...s, status: 'completed' }
    moved = true
  }
  const start = (i: number): void => {
    const s = steps[i]
    if (s === undefined) return
    const cur = steps[currentIndex]
    if (currentIndex >= 0 && currentIndex !== i && cur !== undefined && cur.status === 'in_progress') steps[currentIndex] = { ...cur, status: 'pending' }
    steps[i] = { ...s, status: 'in_progress' }
    currentIndex = i
    moved = true
  }
  if (input.advance === true) {
    if (currentIndex >= 0) complete(currentIndex)
    const nextIndex = steps.findIndex(s => s.status === 'pending')
    if (nextIndex >= 0) start(nextIndex)
    else currentIndex = -1
    moved = true
  }
  if (Array.isArray(input.done)) {
    for (const n of input.done) {
      const i = Number(n) - 1
      if (Number.isInteger(i)) complete(i)
    }
  }
  if (typeof input.start === 'number') start(input.start - 1)
  if (!moved) return prev
  return { ...prev, steps, currentIndex, finishedAt: null, updatedAt: at }
}

/** Stamps the end of the task (wrap_up); step statuses stay as the list left them. */
export function finishTask(task: TaskState, at: number): TaskState {
  return { ...task, finishedAt: at, updatedAt: Math.max(task.updatedAt, at) }
}

/** The text of a transcript row, whatever shape its content takes. */
export function textOfMessage(message: unknown): string {
  const content = asLoose(message).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const texts: string[] = []
  for (const block of content) {
    const text = asLoose(block).text
    if (typeof text === 'string' && text !== '') texts.push(text)
  }
  return texts.join('\n')
}

/** `<tag>value</tag>` pairs of a notification block, values without nested tags; the first of a name wins. */
export function parseTags(text: string): Record<string, string> {
  const tags: Record<string, string> = {}
  const re = /<([a-z][a-z0-9_-]*)>([^<]*)<\/\1>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const name = m[1]
    const value = m[2]
    if (name !== undefined && value !== undefined && tags[name] === undefined) tags[name] = value.trim()
  }
  return tags
}
