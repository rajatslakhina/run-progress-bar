// Pure: ETA arithmetic. Honest by construction: no samples → null, never a guess.

export type EtaRange = { lowMs: number; highMs: number; samples: number; unestimated: number }

/** Linear-interpolated quantile of `values` (q in 0..1); NaN when empty. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return NaN
  const s = [...values].sort((a, b) => a - b)
  const pos = (s.length - 1) * Math.min(1, Math.max(0, q))
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const a = s[lo] ?? 0
  const b = s[hi] ?? a
  return a + (b - a) * (pos - lo)
}

export const medianOf = (values: readonly number[]): number => quantile(values, 0.5)

export type PhaseInput = {
  /** Durations (ms) of agents that completed in the current phase. */
  samples: readonly number[]
  /** Elapsed (ms) of each agent still running in the current phase. */
  runningElapsed: readonly number[]
  /** Greatest number of agents seen running at once in this run. */
  parallelism: number
}

/**
 * Remaining time of the current phase as a p25–p75 range; null without samples.
 * Each running agent needs max(0, q − elapsed); agents that fit in one
 * parallel wave finish together (max), more than that are summed and divided
 * by the parallelism. One sample collapses the range to one value.
 */
export function phaseRemaining({ samples, runningElapsed, parallelism }: PhaseInput): { lowMs: number; highMs: number } | null {
  if (samples.length === 0) return null
  const par = Math.max(1, Math.floor(parallelism))
  const q25 = quantile(samples, 0.25)
  const q75 = quantile(samples, 0.75)
  const left = (q: number): number => {
    const rem = runningElapsed.map(e => Math.max(0, q - e))
    if (rem.length === 0) return 0
    if (rem.length <= par) return Math.max(...rem)
    return rem.reduce((a, b) => a + b, 0) / par
  }
  return { lowMs: left(q25), highMs: left(q75) }
}

export type EtaInput = PhaseInput & {
  /** Estimated duration (ms) of each later phase, null where nothing is known. */
  laterPhases: ReadonlyArray<number | null>
}

/** Whole-run ETA range, or null while the current phase has no completed sample. */
export function computeEta(input: EtaInput): EtaRange | null {
  const cur = phaseRemaining(input)
  if (cur === null) return null
  let later = 0
  let unestimated = 0
  for (const p of input.laterPhases) {
    if (p === null || !Number.isFinite(p)) unestimated += 1
    else later += Math.max(0, p)
  }
  return {
    lowMs: cur.lowMs + later,
    highMs: cur.highMs + later,
    samples: input.samples.length,
    unestimated,
  }
}

export type HistoryRow = {
  name: string | null
  phase: string
  phaseMs: number
  agentMedianMs: number
  agents: number
  at: number
}

/** Median past duration of a phase, by workflow name when the rows have one; null without rows. */
export function historyEstimate(rows: readonly HistoryRow[], name: string | null, phase: string): number | null {
  const same = rows.filter(r => r.phase === phase && r.name === name).map(r => r.phaseMs)
  const vals = same.length > 0 ? same : rows.filter(r => r.phase === phase).map(r => r.phaseMs)
  return vals.length === 0 ? null : medianOf(vals)
}

/** Reads history rows out of whatever the store holds; anything malformed is dropped. */
export function historyRows(raw: unknown): HistoryRow[] {
  if (!Array.isArray(raw)) return []
  const rows: HistoryRow[] = []
  for (const r of raw) {
    if (r === null || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    if (typeof o.phase !== 'string' || typeof o.phaseMs !== 'number' || !Number.isFinite(o.phaseMs)) continue
    rows.push({
      name: typeof o.name === 'string' ? o.name : null,
      phase: o.phase,
      phaseMs: o.phaseMs,
      agentMedianMs: typeof o.agentMedianMs === 'number' ? o.agentMedianMs : 0,
      agents: typeof o.agents === 'number' ? o.agents : 0,
      at: typeof o.at === 'number' ? o.at : 0,
    })
  }
  return rows
}
