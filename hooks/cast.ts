// Pure: the saiyan theme's cast. Builds the cast from the run's agents, the
// per-agent token map and the flags; draws each avatar as a small SVG for the
// desktop (a friendly shape with a face, SMIL animation inside the markup, no
// script) and as a text chip for the terminal. Nothing here touches `$`.
import type { AgentTokens, AgentView, Flag, TokensState } from '../types'
import { truncate } from './format'
import { ROLE_SPECS, badgeLetter, isMovingState, mentorState, roleOfLabel, stateOfAgent } from './roles'
import type { AvatarState, Role, Shape } from './roles'
import type { Indicator, Seg } from './view'

/** At most this many avatars animate at once: the earliest-started moving ones. */
export const ANIMATION_CAP = 6
/** At most this many avatars draw; the rest are counted. */
export const AVATAR_MAX = 16
/** The main session's key in the token map. */
export const MAIN_AGENT_ID = 'main'
/** Agents the token map keeps; the oldest-updated go first. */
export const TOKENS_MAX = 64
/** CSS pixels of one avatar: small enough to sit in a text row. */
export const AVATAR_SIZE = 24
/** CSS pixels of the session's avatar at the head of the collapsed line. */
export const LINE_AVATAR_SIZE = 20
/** CSS pixels of a step indicator. */
export const INDICATOR_SIZE = 12

export type Avatar = {
  id: string
  role: Role
  label: string
  state: AvatarState
  /** Tokens so far over the context window, 0..1; null when unknown. */
  power: number | null
  /** Whether this avatar's SVG animates: a moving state, within the cap, motion on. */
  isAnimated: boolean
  startedAt: number
}

export type CastInput = {
  agents: readonly AgentView[]
  flags: readonly Flag[]
  tokens: Readonly<Record<string, AgentTokens>>
  window: number | null
  /** Whether a model turn runs on the main session. */
  isWorking: boolean
  /** The `motion` option: off disables every animation. */
  motion: boolean
}

export type Cast = { avatars: Avatar[]; hidden: number }

const n0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

/**
 * Tokens that entered an agent's context so far over the window: uncached
 * input, cache writes and output. Cache reads re-read the prefix every call
 * and are left out, else a tool loop would count its context once per round.
 */
export function powerLevel(t: AgentTokens | undefined, window: number | null): number | null {
  if (t === undefined || window === null || !Number.isFinite(window) || window <= 0) return null
  const used = n0(t.input) + n0(t.cacheCreate) + n0(t.output)
  return Math.min(1, used / window)
}

export type UsageLike = {
  input_tokens?: unknown
  output_tokens?: unknown
  cache_read_input_tokens?: unknown
  cache_creation_input_tokens?: unknown
  model?: unknown
}

/** Adds one turn's usage to its agent (the main session when `agentId` is absent) and prunes the map. */
export function foldUsage(prev: TokensState, agentId: string | undefined, usage: UsageLike, at: number): TokensState {
  const id = agentId === undefined || agentId === '' ? MAIN_AGENT_ID : agentId
  const old = prev.byAgent[id]
  const next: AgentTokens = {
    input: (old?.input ?? 0) + n0(usage.input_tokens),
    output: (old?.output ?? 0) + n0(usage.output_tokens),
    cacheRead: (old?.cacheRead ?? 0) + n0(usage.cache_read_input_tokens),
    cacheCreate: (old?.cacheCreate ?? 0) + n0(usage.cache_creation_input_tokens),
    turns: (old?.turns ?? 0) + 1,
    model: typeof usage.model === 'string' && usage.model !== '' ? usage.model : (old?.model ?? null),
    updatedAt: at,
  }
  const byAgent: Record<string, AgentTokens> = { ...prev.byAgent, [id]: next }
  const ids = Object.keys(byAgent).filter(k => k !== MAIN_AGENT_ID)
  if (ids.length > TOKENS_MAX) {
    ids.sort((a, b) => (byAgent[a]?.updatedAt ?? 0) - (byAgent[b]?.updatedAt ?? 0))
    const dropped = new Set(ids.slice(0, ids.length - TOKENS_MAX))
    const kept: Record<string, AgentTokens> = {}
    for (const [k, v] of Object.entries(byAgent)) if (!dropped.has(k)) kept[k] = v
    return { ...prev, byAgent: kept }
  }
  return { ...prev, byAgent }
}

/**
 * The cast: the mentor first, then moving agents by start, then ended agents
 * newest first. The first `ANIMATION_CAP` moving avatars animate when motion is on.
 */
export function buildCast(input: CastInput): Cast {
  const stalledIds = new Set(input.flags.filter(f => f.kind === 'stalled').map(f => f.id.replace(/^stalled:/, '')))
  const mentor: Avatar = {
    id: MAIN_AGENT_ID,
    role: 'mentor',
    label: 'session',
    state: mentorState(input.isWorking),
    power: powerLevel(input.tokens[MAIN_AGENT_ID], input.window),
    isAnimated: false,
    startedAt: 0,
  }
  const moving: Avatar[] = []
  const ended: Array<{ av: Avatar; endedAt: number }> = []
  for (const a of input.agents) {
    const av: Avatar = {
      id: a.agentId,
      role: roleOfLabel(a.label),
      label: a.label,
      state: stateOfAgent(a, stalledIds.has(a.agentId)),
      power: powerLevel(input.tokens[a.agentId], input.window),
      isAnimated: false,
      startedAt: a.startedAt,
    }
    if (isMovingState(av.state)) moving.push(av)
    else ended.push({ av, endedAt: a.endedAt ?? a.startedAt })
  }
  moving.sort((x, y) => x.startedAt - y.startedAt)
  ended.sort((x, y) => y.endedAt - x.endedAt)
  const all: Avatar[] = [mentor, ...moving, ...ended.map(e => e.av)]
  if (input.motion) {
    let animated = 0
    for (const av of all) {
      if (!isMovingState(av.state)) continue
      if (animated >= ANIMATION_CAP) break
      av.isAnimated = true
      animated += 1
    }
  }
  const avatars = all.slice(0, AVATAR_MAX)
  return { avatars, hidden: all.length - avatars.length }
}

// ---- SVG: a small friendly shape with a face, in a 24×24 box ----

const INK = '#232733'
const FACE_INK_OPACITY = '0.82'
const CHEEK = '#F08A8A'
const DROP = '#8FC7F2'
const SAD_OUTLINE = '#E06C75'
/** One soft ease for every breathing motion. */
const EASE = 'calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1"'
const RING_R = 10.5
const RING_LEN = 2 * Math.PI * RING_R

/** Each body fits a circle of about 7.2 around (12, 12); corners are rounded by the stroke. */
const BODY_PATHS: Readonly<Record<Shape, string>> = {
  circle: 'M12 4.8a7.2 7.2 0 1 0 0 14.4a7.2 7.2 0 1 0 0-14.4Z',
  triangle: 'M12 5.2L19 18.4H5Z',
  diamond: 'M12 4.6L19.4 12L12 19.4L4.6 12Z',
  hexagon: 'M12 4.6L18.4 8.3V15.7L12 19.4L5.6 15.7V8.3Z',
  chevron: 'M6 5H13L19 12L13 19H6L11 12Z',
  octagon: 'M9 4.8H15L19.2 9V15L15 19.2H9L4.8 15V9Z',
  shield: 'M12 4.6L19 7.2L18.3 13.6Q17 17.8 12 19.6Q7 17.8 5.7 13.6L5 7.2Z',
  square: 'M8.5 5H15.5A3.5 3.5 0 0 1 19 8.5V15.5A3.5 3.5 0 0 1 15.5 19H8.5A3.5 3.5 0 0 1 5 15.5V8.5A3.5 3.5 0 0 1 8.5 5Z',
}

/** Where the face sits: centred, except on bodies whose mass is off-centre. */
const FACE_AT: Readonly<Record<Shape, readonly [number, number]>> = {
  circle: [12, 12.4],
  triangle: [12, 14],
  diamond: [12, 12.4],
  hexagon: [12, 12.4],
  chevron: [13.2, 12.4],
  octagon: [12, 12.4],
  shield: [12, 12],
  square: [12, 12.4],
}

export const shapePath = (shape: Shape): string => BODY_PATHS[shape]
export const faceAt = (shape: Shape): readonly [number, number] => FACE_AT[shape]

const f1 = (n: number): string => (Math.round(n * 10) / 10).toString()

/** "role, label, state", for a reader that cannot see the drawing. */
export function avatarAlt(av: Avatar): string {
  return `${ROLE_SPECS[av.role].name}, ${av.label}, ${av.state}`
}

/** The eyes, mouth and small marks of one state; the face ink is one group. */
function face(state: AvatarState, fx: number, fy: number, animated: boolean): string {
  const lx = f1(fx - 2.4)
  const rx = f1(fx + 2.4)
  const ey = f1(fy - 0.8)
  const p: string[] = [`<g fill="${INK}" stroke="${INK}" opacity="${FACE_INK_OPACITY}" stroke-width="1.1" stroke-linecap="round" fill-rule="evenodd">`]
  if (state === 'idle') {
    // closed, resting eyes
    p.push(`<path d="M${f1(fx - 3.4)} ${ey}h2M${f1(fx + 1.4)} ${ey}h2" fill="none"/>`)
    p.push(`<path d="M${f1(fx - 1.2)} ${f1(fy + 2)}h2.4" fill="none"/>`)
  } else if (state === 'done') {
    // happy arcs and a smile
    p.push(`<path d="M${f1(fx - 3.6)} ${f1(fy - 0.2)}q1.2 -1.9 2.4 0M${f1(fx + 1.2)} ${f1(fy - 0.2)}q1.2 -1.9 2.4 0" fill="none"/>`)
    p.push(`<path d="M${f1(fx - 2)} ${f1(fy + 1.8)}q2 2.2 4 0" fill="none"/>`)
  } else if (state === 'failed') {
    // small eyes, a frown
    p.push(`<circle cx="${lx}" cy="${ey}" r="1" stroke="none"/><circle cx="${rx}" cy="${ey}" r="1" stroke="none"/>`)
    p.push(`<path d="M${f1(fx - 1.8)} ${f1(fy + 2.8)}q1.8 -1.6 3.6 0" fill="none"/>`)
  } else {
    // open eyes (a blink while animated) and a small smile or a flat mouth
    const blink = animated ? '<animate attributeName="ry" values="1.3;1.3;0.15;1.3;1.3" keyTimes="0;0.9;0.93;0.96;1" dur="4.2s" repeatCount="indefinite"/>' : ''
    p.push(`<ellipse cx="${lx}" cy="${ey}" rx="1.1" ry="1.3" stroke="none">${blink}</ellipse><ellipse cx="${rx}" cy="${ey}" rx="1.1" ry="1.3" stroke="none">${blink}</ellipse>`)
    p.push(state === 'stalled' ? `<path d="M${f1(fx - 1.4)} ${f1(fy + 2.2)}h2.8" fill="none"/>` : `<path d="M${f1(fx - 1.6)} ${f1(fy + 1.8)}q1.6 1.4 3.2 0" fill="none"/>`)
  }
  p.push('</g>')
  if (state !== 'failed') p.push(`<circle cx="${f1(fx - 3.9)}" cy="${f1(fy + 1.3)}" r="1" fill="${CHEEK}" opacity="0.35"/><circle cx="${f1(fx + 3.9)}" cy="${f1(fy + 1.3)}" r="1" fill="${CHEEK}" opacity="0.35"/>`)
  return p.join('')
}

/** A sweat drop beside the brow: still, or sliding down while animated. */
function sweatDrop(fx: number, fy: number, animated: boolean): string {
  const slide = animated ? '<animateTransform attributeName="transform" type="translate" values="0 0;0 1.6;0 0" dur="2.2s" repeatCount="indefinite"/>' : ''
  return `<g transform="translate(${f1(fx + 5.6)} ${f1(fy - 4.2)})"><path d="M0 0q-1.5 2.4 0 3.3q1.5 -0.9 0 -3.3Z" fill="${DROP}" opacity="0.9">${slide}</path></g>`
}

/** The avatar's SVG document, drawn `size` pixels square. Animation is SMIL inside the markup, present only when `isAnimated`. */
export function avatarSvg(av: Avatar, size: number = AVATAR_SIZE): string {
  const spec = ROLE_SPECS[av.role]
  const c = spec.color
  const [fx, fy] = FACE_AT[spec.shape]
  const p: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">`]
  // power ring: a faint track and the level as an arc, clockwise from the top
  if (av.power !== null) {
    p.push(`<circle cx="12" cy="12" r="${RING_R}" fill="none" stroke="${c}" stroke-width="1.6" opacity="0.18"/>`)
    const len = Math.round(RING_LEN * av.power * 10) / 10
    if (len > 0) p.push(`<circle cx="12" cy="12" r="${RING_R}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="${len} ${f1(RING_LEN)}" transform="rotate(-90 12 12)"/>`)
  }
  // aura while running: a soft halo that breathes
  if (av.state === 'running') {
    p.push(`<circle cx="12" cy="12" r="8.8" fill="${c}" opacity="0.22">`)
    if (av.isAnimated) {
      p.push(`<animate attributeName="opacity" values="0.14;0.34;0.14" dur="2.6s" repeatCount="indefinite" ${EASE}/>`)
      p.push(`<animate attributeName="r" values="8.4;9.4;8.4" dur="2.6s" repeatCount="indefinite" ${EASE}/>`)
    }
    p.push('</circle>')
  }
  const outline = av.state === 'failed' ? `stroke="${SAD_OUTLINE}" stroke-width="1.8"` : `stroke="${c}" stroke-width="1.6"`
  p.push(`<g opacity="${av.state === 'idle' ? '0.45' : '1'}">`)
  p.push(`<path d="${BODY_PATHS[spec.shape]}" fill="${c}" ${outline} stroke-linejoin="round">`)
  if (av.state === 'stalled' && av.isAnimated) p.push(`<animate attributeName="opacity" values="1;0.72;1" dur="1.8s" repeatCount="indefinite" ${EASE}/>`)
  p.push('</path>')
  p.push(face(av.state, fx, fy, av.isAnimated))
  p.push('</g>')
  if (av.state === 'stalled' || av.state === 'failed') p.push(sweatDrop(fx, fy, av.state === 'stalled' && av.isAnimated))
  if (av.state === 'done') p.push('<path d="M18.6 3.2l0.7 1.7l1.7 0.7l-1.7 0.7l-0.7 1.7l-0.7 -1.7l-1.7 -0.7l1.7 -0.7Z" fill="#FFFFFF" opacity="0.9"/>')
  if (spec.hasBadge) {
    p.push(`<circle cx="18.8" cy="5.4" r="3.4" fill="#FFFFFF" stroke="${c}" stroke-width="1"/>`)
    p.push(`<text x="18.8" y="7.1" font-size="4.8" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="${c}">${badgeLetter(av.label)}</text>`)
  }
  p.push('</svg>')
  return p.join('')
}

// ---- step and line indicators (desktop, saiyan): the arrow's replacement ----

const IND_CURRENT = '#E4A24B'
const IND_DONE = '#7CCB9A'
const IND_PENDING = '#8A90A0'

/** A 12 px mark: a warm dot with a breathing halo for the current step, a mint check for a done one, a faint ring for a pending one. */
export function indicatorSvg(kind: Indicator, animated: boolean): string {
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="${INDICATOR_SIZE}" height="${INDICATOR_SIZE}">`
  if (kind === 'done') {
    return `${open}<circle cx="6" cy="6" r="5" fill="${IND_DONE}"/><path d="M3.6 6.2L5.3 7.8L8.5 4.4" fill="none" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  }
  if (kind === 'pending') {
    return `${open}<circle cx="6" cy="6" r="3.2" fill="none" stroke="${IND_PENDING}" stroke-width="1.3" opacity="0.7"/></svg>`
  }
  const halo = animated
    ? `<circle cx="6" cy="6" r="5" fill="${IND_CURRENT}" opacity="0.25"><animate attributeName="r" values="3.6;5.6;3.6" dur="2.6s" repeatCount="indefinite" ${EASE}/><animate attributeName="opacity" values="0.32;0.1;0.32" dur="2.6s" repeatCount="indefinite" ${EASE}/></circle>`
    : `<circle cx="6" cy="6" r="5" fill="${IND_CURRENT}" opacity="0.2"/>`
  return `${open}${halo}<circle cx="6" cy="6" r="2.6" fill="${IND_CURRENT}"/></svg>`
}

export const indicatorAlt = (kind: Indicator): string => (kind === 'current' ? 'current step' : kind === 'done' ? 'done' : 'pending')

// ---- terminal fallback ----

const STATE_GLYPH: Readonly<Record<AvatarState, string>> = { idle: '·', running: '›', done: '✓', failed: '✗', stalled: '⚠' }
const STATE_COLOR: Readonly<Record<AvatarState, string>> = { idle: 'inactive', running: 'claude', done: 'success', failed: 'error', stalled: 'warning' }
const BAR_CELLS = 5

/** Five cells of power: `▰▰▱▱▱`. */
export function powerBar(power: number): string {
  const filled = Math.max(0, Math.min(BAR_CELLS, Math.round(power * BAR_CELLS)))
  return '▰'.repeat(filled) + '▱'.repeat(BAR_CELLS - filled)
}

/** One avatar as text: glyph (badge letter for the rival), label, state glyph, power bar. */
export function chipSegs(av: Avatar): Seg[] {
  const spec = ROLE_SPECS[av.role]
  const idle = av.state === 'idle'
  const segs: Seg[] = [{ text: spec.glyph, color: spec.color, dim: idle }]
  if (spec.hasBadge) segs.push({ text: badgeLetter(av.label), color: spec.color, bold: true })
  segs.push({ text: ` ${truncate(av.label, 18)}`, dim: idle, bold: av.state === 'running' })
  segs.push({ text: ` ${STATE_GLYPH[av.state]}`, color: STATE_COLOR[av.state] })
  if (av.power !== null) segs.push({ text: ` ${powerBar(av.power)}`, color: spec.color })
  return segs
}

/** The whole row for the terminal: every avatar's chip, then `+n more` when some are hidden. */
export function castRowSegs(cast: Cast): Seg[] {
  const segs: Seg[] = [{ text: '   Cast: ', color: 'subtle' }]
  cast.avatars.forEach((av, i) => {
    if (i > 0) segs.push({ text: ' · ', color: 'inactive', kind: 'sep' })
    segs.push(...chipSegs(av))
  })
  if (cast.hidden > 0) segs.push({ text: ` +${cast.hidden} more`, dim: true })
  return segs
}
