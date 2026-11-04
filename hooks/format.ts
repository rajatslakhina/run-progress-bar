// Pure: text formatting for the band.
import type { EtaView } from '../types'

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h${String(m % 60).padStart(2, '0')}m`
}

export const fmtAgo = (ms: number): string => `${fmtDuration(ms)} ago`

export function fmtMoney(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return '$—'
  if (usd < 10) return `$${usd.toFixed(2)}`
  if (usd < 100) return `$${usd.toFixed(1)}`
  return `$${Math.round(usd)}`
}

/** Coarse duration for estimates: 5-minute steps from 10 minutes up, whole minutes below, "<1m" under a minute. */
export function fmtCoarse(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 60_000) return '<1m'
  const step = ms >= 10 * 60_000 ? 5 * 60_000 : 60_000
  return fmtDuration(Math.round(ms / step) * step)
}

export function fmtEta(eta: EtaView): string {
  if (eta === null) return 'ETA: unknown'
  const lo = fmtCoarse(eta.lowMs)
  const hi = fmtCoarse(eta.highMs)
  const range = lo === hi ? `~${hi}` : `~${lo}–${hi}`
  const notes: string[] = []
  if (eta.samples === 1) notes.push('1 sample')
  if (eta.unestimated > 0) notes.push(`+${eta.unestimated} phase${eta.unestimated === 1 ? '' : 's'} unestimated`)
  return `${range} left (est${notes.length > 0 ? `, ${notes.join(', ')}` : ''})`
}

export function truncate(s: string, n: number): string {
  const max = Math.max(1, Math.floor(n))
  if (s.length <= max) return s
  return `${s.slice(0, Math.max(0, max - 1))}…`
}
