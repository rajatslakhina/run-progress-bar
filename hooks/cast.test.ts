import { expect, test } from 'claude-code/testing'

import type { AgentTokens, AgentView, Flag, TokensState } from '../types'
import { ANIMATION_CAP, AVATAR_MAX, MAIN_AGENT_ID, TOKENS_MAX, avatarAlt, avatarSvg, buildCast, castRowSegs, chipSegs, foldUsage, indicatorAlt, indicatorSvg, powerBar, powerLevel } from './cast'
import type { Avatar } from './cast'
import { joinSegs } from './view'

const agent = (id: string, label: string, startedAt: number, status: AgentView['status'] = 'running', endedAt: number | null = null): AgentView => ({
  agentId: id,
  label,
  phase: 'p',
  startedAt,
  endedAt,
  status,
  lastWriteAt: null,
  size: null,
})

const tokens = (input: number, output: number, cacheRead: number, cacheCreate: number): AgentTokens => ({
  input,
  output,
  cacheRead,
  cacheCreate,
  turns: 1,
  model: 'm',
  updatedAt: 1,
})

const avatar = (over: Partial<Avatar>): Avatar => ({ id: 'a', role: 'fighter', label: 'write:x', state: 'running', power: null, isAnimated: false, startedAt: 0, ...over })

test('power level: new tokens over the window, cache reads left out, clamped at 1, null when unknown', () => {
  expect(powerLevel(tokens(10_000, 5_000, 900_000, 35_000), 200_000)).toBe(0.25)
  expect(powerLevel(tokens(150_000, 100_000, 0, 0), 200_000)).toBe(1)
  expect(powerLevel(tokens(0, 0, 0, 0), 200_000)).toBe(0)
  expect(powerLevel(undefined, 200_000)).toBeNull()
  expect(powerLevel(tokens(1, 1, 1, 1), null)).toBeNull()
  expect(powerLevel(tokens(1, 1, 1, 1), 0)).toBeNull()
  expect(powerLevel(tokens(Number.NaN, -5, 1, 0), 100)).toBe(0)
  expect(powerLevel(tokens(Number.NaN, -5, 1, 1), 100)).toBe(0.01)
  expect(powerBar(0)).toBe('▱▱▱▱▱')
  expect(powerBar(0.4)).toBe('▰▰▱▱▱')
  expect(powerBar(0.5)).toBe('▰▰▰▱▱')
  expect(powerBar(1)).toBe('▰▰▰▰▰')
})

test('fold usage: sums per agent, the main session without an agentId, keeps the model, prunes the oldest', () => {
  const empty: TokensState = { window: null, byAgent: {} }
  let s = foldUsage(empty, undefined, { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 7, model: 'claude-x' }, 10)
  s = foldUsage(s, undefined, { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }, 20)
  expect(s.byAgent[MAIN_AGENT_ID]).toEqual({ input: 101, output: 22, cacheRead: 8, cacheCreate: 11, turns: 2, model: 'claude-x', updatedAt: 20 })
  s = foldUsage(s, 'a1', { input_tokens: 'bad', output_tokens: -3 }, 30)
  expect(s.byAgent.a1).toMatchObject({ input: 0, output: 0, turns: 1, model: null })
  for (let i = 0; i < TOKENS_MAX + 5; i += 1) s = foldUsage(s, `b${i}`, { input_tokens: 1 }, 100 + i)
  const ids = Object.keys(s.byAgent)
  expect(ids).toHaveLength(TOKENS_MAX + 1)
  expect(ids).toContain(MAIN_AGENT_ID)
  expect(ids).not.toContain('a1')
  expect(ids).toContain(`b${TOKENS_MAX + 4}`)
})

test('cast: mentor first, roles from labels, states from status and stalled flags, power from the map', () => {
  const flags: Flag[] = [{ kind: 'stalled', id: 'stalled:r1', text: 'x', at: 1 }]
  const cast = buildCast({
    agents: [agent('w1', 'write:draft', 100), agent('r1', 'review:bugs', 200), agent('d1', 'judge:final', 50, 'done', 300), agent('f1', 'fix:lint', 60, 'failed', 90)],
    flags,
    tokens: { main: tokens(50_000, 0, 0, 0), w1: tokens(20_000, 0, 1_000_000, 0) },
    window: 200_000,
    isWorking: true,
    motion: true,
  })
  expect(cast.hidden).toBe(0)
  expect(cast.avatars.map(a => `${a.id}:${a.role}:${a.state}`)).toEqual(['main:mentor:running', 'w1:fighter:running', 'r1:rival:stalled', 'd1:sage:done', 'f1:engineer:failed'])
  expect(cast.avatars[0]?.power).toBe(0.25)
  expect(cast.avatars[1]?.power).toBe(0.1)
  expect(cast.avatars[2]?.power).toBeNull()
  expect(cast.avatars.map(a => a.isAnimated)).toEqual([true, true, true, false, false])
  const idle = buildCast({ agents: [], flags: [], tokens: {}, window: null, isWorking: false, motion: true })
  expect(idle.avatars).toHaveLength(1)
  expect(idle.avatars[0]).toMatchObject({ state: 'idle', isAnimated: false, power: null })
})

test('cast: at most six avatars animate, the earliest-started moving ones; motion off animates none; the row is capped', () => {
  const agents = Array.from({ length: 20 }, (_, i) => agent(`a${i}`, `write:${i}`, 1000 - i * 10))
  const cast = buildCast({ agents, flags: [], tokens: {}, window: null, isWorking: true, motion: true })
  const animated = cast.avatars.filter(a => a.isAnimated)
  expect(animated).toHaveLength(ANIMATION_CAP)
  // the mentor (started first) and the five earliest-started agents
  expect(animated.map(a => a.id)).toEqual(['main', 'a19', 'a18', 'a17', 'a16', 'a15'])
  expect(cast.avatars).toHaveLength(AVATAR_MAX)
  expect(cast.hidden).toBe(21 - AVATAR_MAX)
  const still = buildCast({ agents, flags: [], tokens: {}, window: null, isWorking: true, motion: false })
  expect(still.avatars.some(a => a.isAnimated)).toBe(false)
  // a mentor that idles does not take a seat of the six
  const noMentor = buildCast({ agents: agents.slice(0, 8), flags: [], tokens: {}, window: null, isWorking: false, motion: true })
  expect(noMentor.avatars.filter(a => a.isAnimated).map(a => a.id)).toEqual(['a7', 'a6', 'a5', 'a4', 'a3', 'a2'])
})

test('svg: a face per state, SMIL only when animated, a power ring, the rival badge; alt is role, label, state', () => {
  const pulse = avatarSvg(avatar({ state: 'running', isAnimated: true, power: 0.5 }))
  expect(pulse).toContain('<animate attributeName="opacity" values="0.14;0.34;0.14"')
  expect(pulse).toContain('attributeName="ry"')
  expect(pulse).toContain('stroke-dasharray="33 66"')
  expect(pulse).toContain('width="24" height="24"')
  expect(pulse.length).toBeLessThan(2600)
  const stillPulse = avatarSvg(avatar({ state: 'running', isAnimated: false }))
  expect(stillPulse).not.toContain('<animate')
  expect(stillPulse).toContain('r="8.8"')
  expect(stillPulse).not.toContain('r="10.5"')
  const flicker = avatarSvg(avatar({ state: 'stalled', isAnimated: true }))
  expect(flicker).toContain('values="1;0.72;1"')
  expect(flicker).toContain('<animateTransform')
  const stillFlicker = avatarSvg(avatar({ state: 'stalled', isAnimated: false }))
  expect(stillFlicker).toContain('fill="#8FC7F2"')
  expect(stillFlicker).not.toContain('<animate')
  const done = avatarSvg(avatar({ state: 'done' }))
  expect(done).toContain('M18.6 3.2')
  expect(done).toContain('q1.2 -1.9 2.4 0')
  expect(done).not.toContain('<animate')
  const failed = avatarSvg(avatar({ state: 'failed' }))
  expect(failed).toContain('stroke="#E06C75" stroke-width="1.8"')
  expect(failed).toContain('fill="#8FC7F2"')
  expect(failed).not.toContain('L21 19')
  expect(avatarSvg(avatar({ state: 'idle' }))).toContain('<g opacity="0.45">')
  const rival = avatarSvg(avatar({ role: 'rival', label: 'verify:x' }))
  expect(rival).toContain('>V</text>')
  expect(avatarSvg(avatar({ role: 'rival', label: '<b>:x' }))).toContain('>·</text>')
  expect(pulse).not.toContain('<text')
  expect(avatarAlt(avatar({ role: 'scout', label: 'research:auth', state: 'done' }))).toBe('cyan scout, research:auth, done')
  for (const svg of [pulse, flicker, done, failed, rival]) {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).not.toMatch(/<script|on[a-z]+=/)
  }
  for (const role of ['mentor', 'fighter', 'rival', 'sage', 'scout', 'engineer', 'guard', 'unknown'] as const) {
    expect(avatarSvg(avatar({ role }))).toContain('<ellipse')
  }
  expect(avatarSvg(avatar({}), 20)).toContain('width="20" height="20"')
})

test('indicators: a breathing dot for the current step while animated, a still one otherwise; a check; a ring', () => {
  expect(indicatorSvg('current', true)).toContain('<animate attributeName="r"')
  expect(indicatorSvg('current', false)).not.toContain('<animate')
  expect(indicatorSvg('done', true)).toContain('M3.6 6.2L5.3 7.8L8.5 4.4')
  expect(indicatorSvg('done', true)).not.toContain('<animate')
  expect(indicatorSvg('pending', true)).toContain('fill="none"')
  for (const k of ['current', 'done', 'pending'] as const) expect(indicatorSvg(k, false)).toContain('width="12" height="12"')
  expect(indicatorAlt('current')).toBe('current step')
  expect(indicatorAlt('done')).toBe('done')
  expect(indicatorAlt('pending')).toBe('pending')
})

test('terminal row: one glyph per shape, the rival badge, state glyph and power bar; hidden count at the end', () => {
  const chip = joinSegs(chipSegs(avatar({ role: 'rival', label: 'review:bugs', state: 'stalled', power: 0.6 })))
  expect(chip).toBe('◆R review:bugs ⚠ ▰▰▰▱▱')
  expect(joinSegs(chipSegs(avatar({ role: 'mentor', label: 'session', state: 'idle' })))).toBe('● session ·')
  expect(joinSegs(chipSegs(avatar({ role: 'guard', label: 'qa:a very long label indeed', state: 'done', power: 1 })))).toBe('⬟ qa:a very long la… ✓ ▰▰▰▰▰')
  const cast = buildCast({
    agents: Array.from({ length: 18 }, (_, i) => agent(`a${i}`, `test:${i}`, i)),
    flags: [],
    tokens: {},
    window: null,
    isWorking: true,
    motion: true,
  })
  const row = joinSegs(castRowSegs(cast))
  expect(row.startsWith('   Cast: ● session › · ⬟ test:0 ›')).toBe(true)
  expect(row.endsWith(' +3 more')).toBe(true)
  const glyphs = new Set(
    (['mentor', 'fighter', 'rival', 'sage', 'scout', 'engineer', 'guard', 'unknown'] as const).map(role => chipSegs(avatar({ role }))[0]?.text),
  )
  expect(glyphs.size).toBe(8)
})
