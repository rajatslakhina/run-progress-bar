// Pure: anomaly rules. Each returns the flags that hold right now; the caller
// merges them with the previous set so a flag keeps its first-seen time.
import type { Flag } from '../types'

const minutes = (ms: number): number => Math.round(ms / 60_000)

export type StallAgent = {
  agentId: string
  label: string
  status: string
  startedAt: number
  lastWriteAt: number | null
}

/** Running agents whose newest write (or start) is older than `thresholdMs`. */
export function detectStalled(agents: readonly StallAgent[], now: number, thresholdMs: number): Flag[] {
  const flags: Flag[] = []
  for (const a of agents) {
    if (a.status !== 'running') continue
    const last = Math.max(a.startedAt, a.lastWriteAt ?? 0)
    const idle = now - last
    if (idle > thresholdMs) {
      flags.push({
        kind: 'stalled',
        id: `stalled:${a.agentId}`,
        text: `Stalled: ${a.label} — no file write for ${minutes(idle)}m (threshold ${minutes(thresholdMs)}m)`,
        at: now,
      })
    }
  }
  return flags
}

/** Labels that started more than once in one run. */
export function detectRetries(startedLabels: readonly string[], now: number): Flag[] {
  const counts = new Map<string, number>()
  for (const label of startedLabels) counts.set(label, (counts.get(label) ?? 0) + 1)
  const flags: Flag[] = []
  for (const [label, n] of counts) {
    if (n >= 2) flags.push({ kind: 'retry', id: `retry:${label}`, text: `Retry: ${label} started ${n} times in this run`, at: now })
  }
  return flags
}

export type SizeSample = { t: number; size: number }

/** Keeps the samples inside the window, newest last; appends `next` unless it repeats the last one. */
export function pushSample(samples: readonly SizeSample[], next: SizeSample, windowMs: number): SizeSample[] {
  const kept = samples.filter(s => next.t - s.t <= windowMs)
  const last = kept[kept.length - 1]
  if (last !== undefined && last.size === next.size && last.t === next.t) return kept
  kept.push(next)
  return kept
}

/** Files whose size grew more than `pct` percent between the oldest and newest sample in the window. */
export function detectGrowth(
  samples: Readonly<Record<string, readonly SizeSample[]>>,
  now: number,
  windowMs: number,
  pct: number,
): Flag[] {
  const flags: Flag[] = []
  for (const [file, list] of Object.entries(samples)) {
    const within = list.filter(s => now - s.t <= windowMs)
    const first = within[0]
    const last = within[within.length - 1]
    if (first === undefined || last === undefined || within.length < 2 || first.size <= 0) continue
    const growth = ((last.size - first.size) / first.size) * 100
    if (growth > pct) {
      const base = file.slice(file.lastIndexOf('/') + 1)
      flags.push({
        kind: 'growth',
        id: `growth:${file}`,
        text: `Output growth: ${base} +${Math.round(growth)}% in ${minutes(last.t - first.t)}m`,
        at: now,
      })
    }
  }
  return flags
}

export type GoneItem = { id: string; label: string; status: string }

/** Tasks or agents that ended without a result: failed or stopped. */
export function detectProcessGone(items: readonly GoneItem[], now: number): Flag[] {
  const flags: Flag[] = []
  for (const it of items) {
    if (it.status === 'failed' || it.status === 'killed') {
      flags.push({ kind: 'process-gone', id: `gone:${it.id}`, text: `Process gone: ${it.label} ${it.status}`, at: now })
    }
  }
  return flags
}

/** One cost flag once `usd` reaches the threshold, re-raised at every `stepUsd` above it. */
export function detectCost(usd: number | null, thresholdUsd: number, stepUsd: number, now: number): Flag[] {
  if (usd === null || !Number.isFinite(usd) || thresholdUsd <= 0 || usd < thresholdUsd) return []
  const step = stepUsd > 0 ? stepUsd : thresholdUsd
  const level = thresholdUsd + Math.floor((usd - thresholdUsd) / step) * step
  return [{ kind: 'cost', id: `cost:${level}`, text: `Cost $${usd.toFixed(0)} crossed $${level}`, at: now }]
}

/** The flags that hold now, each keeping its first-seen time; `added` are the new ones. */
export function mergeFlags(prev: readonly Flag[], next: readonly Flag[]): { flags: Flag[]; added: Flag[] } {
  const seen = new Map(prev.map(f => [f.id, f] as const))
  const flags: Flag[] = []
  const added: Flag[] = []
  const used = new Set<string>()
  for (const f of next) {
    if (used.has(f.id)) continue
    used.add(f.id)
    const old = seen.get(f.id)
    if (old === undefined) {
      flags.push(f)
      added.push(f)
    } else {
      flags.push({ ...f, at: old.at })
    }
  }
  return { flags, added }
}
