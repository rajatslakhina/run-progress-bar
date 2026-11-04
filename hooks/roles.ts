// Pure: the saiyan theme's cast. A workflow agent's role comes from its label's
// prefix before ':' (`review:bugs` → rival); the main session is the mentor.
// Each role has a fixed color and its own shape and glyph, so color is never
// the only signal. Original archetypes only: no real characters, names or art.
import type { AgentView } from '../types'

export type Role = 'mentor' | 'fighter' | 'rival' | 'sage' | 'scout' | 'engineer' | 'guard' | 'unknown'
export type Shape = 'circle' | 'triangle' | 'diamond' | 'hexagon' | 'chevron' | 'octagon' | 'shield' | 'square'
export type AvatarState = 'idle' | 'running' | 'done' | 'failed' | 'stalled'

export type RoleSpec = {
  role: Role
  /** The archetype as the alt text names it. */
  name: string
  /** Fixed per role; the SVG fill and the terminal glyph's color. */
  color: string
  shape: Shape
  /** One glyph per shape, for the terminal row. */
  glyph: string
  /** The rival carries a seat badge: the first letter of its label prefix. */
  hasBadge: boolean
}

export const ROLE_SPECS: Readonly<Record<Role, RoleSpec>> = {
  // Soft, warm hues that stay apart from each other on a dark or a light surface.
  mentor: { role: 'mentor', name: 'gold mentor', color: '#E8C170', shape: 'circle', glyph: '●', hasBadge: false },
  fighter: { role: 'fighter', name: 'orange fighter', color: '#F0956A', shape: 'triangle', glyph: '▲', hasBadge: false },
  rival: { role: 'rival', name: 'blue rival', color: '#7FB2F0', shape: 'diamond', glyph: '◆', hasBadge: true },
  sage: { role: 'sage', name: 'green sage', color: '#7CCB9A', shape: 'hexagon', glyph: '⬢', hasBadge: false },
  scout: { role: 'scout', name: 'cyan scout', color: '#6FCBD6', shape: 'chevron', glyph: '❯', hasBadge: false },
  engineer: { role: 'engineer', name: 'purple engineer', color: '#B59AEB', shape: 'octagon', glyph: '⬣', hasBadge: false },
  guard: { role: 'guard', name: 'red guard', color: '#EC8E9A', shape: 'shield', glyph: '⬟', hasBadge: false },
  unknown: { role: 'unknown', name: 'grey chip', color: '#A9AFB8', shape: 'square', glyph: '■', hasBadge: false },
}

/** Label-prefix keywords, in match order; a prefix matches a keyword it starts with (`reviewer` → rival). */
const PREFIX_ROLES: ReadonlyArray<readonly [string, Role]> = [
  ['research', 'scout'],
  ['design', 'fighter'],
  ['write', 'fighter'],
  ['review', 'rival'],
  ['verify', 'rival'],
  ['skeptic', 'rival'],
  ['fix', 'engineer'],
  ['qa', 'guard'],
  ['test', 'guard'],
  ['judge', 'sage'],
  ['synth', 'sage'],
]

/** The part of a label before its first ':', trimmed and lowercased; the whole label when it has none. */
export function labelPrefix(label: string): string {
  const i = label.indexOf(':')
  return (i < 0 ? label : label.slice(0, i)).trim().toLowerCase()
}

export function roleOfLabel(label: string): Role {
  const prefix = labelPrefix(label)
  if (prefix === '') return 'unknown'
  for (const [word, role] of PREFIX_ROLES) if (prefix.startsWith(word)) return role
  return 'unknown'
}

/** The seat badge's letter: the prefix's first letter or digit, upper-cased; '·' when it has none (never raw markup). */
export function badgeLetter(label: string): string {
  const ch = labelPrefix(label).charAt(0).toUpperCase()
  return /^[A-Z0-9]$/.test(ch) ? ch : '·'
}

export function stateOfAgent(a: Pick<AgentView, 'status'>, isStalled: boolean): AvatarState {
  if (a.status === 'done') return 'done'
  if (a.status === 'failed') return 'failed'
  return isStalled ? 'stalled' : 'running'
}

export const mentorState = (isWorking: boolean): AvatarState => (isWorking ? 'running' : 'idle')

/** The states that move (aura pulse, flicker); the others draw still. */
export const isMovingState = (s: AvatarState): boolean => s === 'running' || s === 'stalled'
