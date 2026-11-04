// The band drawn through the engine, state seeded: the saiyan theme's cast on
// the desktop (an Svg per avatar, small Svg marks for the steps) and the
// terminal (text chips), the desktop's sectioned layout, and classic untouched.
// Each tree passes the surface's own element validation.
import { expect, test } from 'claude-code/testing'

import type { AgentView, RunState, TaskState, TokensState } from '../types'

const NOW = 1_700_000_000_000
const SHAPE = 'v1'

const BAND = {
  plugin: 'run-progress-bar',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: true, maxRows: 24, bodyColumns: 140, scroll: { offset: 0, bodyRows: 24 }, view: {} },
} as const

const agent = (agentId: string, label: string, startedAt: number, status: AgentView['status'] = 'running'): AgentView => ({
  agentId,
  label,
  phase: 'Review',
  startedAt,
  endedAt: status === 'running' ? null : startedAt + 5000,
  status,
  lastWriteAt: null,
  size: null,
})

const AGENTS: AgentView[] = [
  agent('a1', 'review:bugs', NOW - 40_000),
  agent('a2', 'verify:src/eta.ts', NOW - 39_000),
  agent('a3', 'research:auth', NOW - 38_000),
  agent('a4', 'write:draft', NOW - 37_000),
  agent('a5', 'fix:lint', NOW - 36_000),
  agent('a6', 'qa:smoke', NOW - 35_000),
  agent('a7', 'judge:final', NOW - 34_000),
  agent('a8', 'Explore the codebase', NOW - 33_000),
  agent('a9', 'synth:report', NOW - 45_000, 'done'),
  agent('a10', 'test:e2e', NOW - 44_000, 'failed'),
]

const agents: Record<string, AgentView> = {}
for (const a of AGENTS) agents[a.agentId] = a

const task: TaskState = {
  steps: [
    { content: 'Build the theme', status: 'in_progress' },
    { content: 'Verify', status: 'pending' },
  ],
  currentIndex: 0,
  startedAt: NOW - 60_000,
  finishedAt: null,
  updatedAt: NOW - 2000,
}

const run: RunState = {
  runId: 'wf_12345678-abc',
  dir: '/tmp/wf',
  name: 'review-changes',
  phases: ['Review'],
  seenPhases: ['Review'],
  startedAt: NOW - 50_000,
  agents,
  startedLabels: AGENTS.map(a => a.label),
  maxParallel: 8,
  journalOffset: 0,
  journalSize: 0,
  mode: 'full',
  corruptLines: 0,
  lastActivityAt: NOW - 1000,
  isDone: false,
  recordedPhases: [],
}

const tokens: TokensState = {
  window: 200_000,
  byAgent: {
    main: { input: 50_000, output: 0, cacheRead: 0, cacheCreate: 0, turns: 1, model: 'm', updatedAt: NOW },
    a1: { input: 10_000, output: 10_000, cacheRead: 500_000, cacheCreate: 0, turns: 1, model: 'm', updatedAt: NOW },
  },
}

const SEED: Record<string, unknown> = {
  task,
  run,
  tokens,
  flags: [{ kind: 'stalled', id: 'stalled:a2', text: 'verify:src/eta.ts stalled', at: NOW }],
  bg: [],
  cost: 1.5,
  eta: null,
  ui: { isExpanded: true, dismissedAt: null },
  now: NOW,
  paths: { sessionDir: null, runHint: null },
  error: null,
}

/** What `$.state.get` answers for a key: the seeded value under the mod's shape tag, or nothing written. */
const seeded = (key: string, over: Record<string, unknown> = {}) => {
  const v = key in over ? over[key] : SEED[key]
  if (v === undefined) return { value: { value: undefined, version: 0 } }
  return { value: { value: { shape: SHAPE, value: v }, version: 1 } }
}

const ALTS = [
  'gold mentor, session, running',
  'blue rival, review:bugs, running',
  'blue rival, verify:src/eta.ts, stalled',
  'cyan scout, research:auth, running',
  'orange fighter, write:draft, running',
  'purple engineer, fix:lint, running',
  'red guard, qa:smoke, running',
  'green sage, judge:final, running',
  'grey chip, Explore the codebase, running',
  'red guard, test:e2e, failed',
  'green sage, synth:report, done',
]

const AVATAR_PX = 24
const LINE_PX = 20
const MARK_PX = 12

test('saiyan on the desktop: the session on the line, an avatar per agent with alt "role, label, state", six animated at most, power rings, small marks for the steps', { options: { theme: 'saiyan' } }, async ($, on) => {
  on('state.get', (_, e) => seeded(e.key))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svgs = await ui.findAll({ type: 'Svg' })
  const line = svgs.filter(s => s.props.width === LINE_PX)
  const avatars = svgs.filter(s => s.props.width === AVATAR_PX)
  const marks = svgs.filter(s => s.props.width === MARK_PX)
  expect(line.map(s => s.props.alt)).toEqual([ALTS[0]])
  expect(avatars.map(s => s.props.alt)).toEqual(ALTS.slice(1))
  // the step list's marks: the current step and the pending one
  expect(marks.map(s => s.props.alt)).toEqual(['current step', 'pending'])
  expect(marks[0]?.props.isInteractive).toBe(true)
  expect(marks[1]?.props.isInteractive).toBeUndefined()
  const faces = [...line, ...avatars]
  expect(faces.filter(s => s.props.isInteractive === true).map(s => s.props.alt)).toEqual(ALTS.slice(0, 6))
  for (const s of faces) expect(String(s.props.source).includes('<animate')).toBe(s.props.isInteractive === true)
  // power rings: 50k of 200k is a quarter turn; a1's cache reads do not count; a3 has no count and no ring
  expect(String(line[0]?.props.source)).toContain('stroke-dasharray="16.5 66"')
  expect(String(avatars[0]?.props.source)).toContain('stroke-dasharray="6.6 66"')
  expect(String(avatars[2]?.props.source)).not.toContain('r="10.5"')
  // a label beside each avatar, section titles, no repeated prefixes, and the step text without space padding
  expect(await ui.find({ type: 'Text', text: /^review:bugs$/ })).toBeDefined()
  for (const title of ['Cast', 'Steps', 'Workflow', 'Flags']) expect(await ui.find({ type: 'Text', text: new RegExp(`^${title}$`) })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^review-changes$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Workflow / })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^running$/ })).toBeDefined()
  // the line's title and the step's text, both without the space padding the terminal uses
  const titles = (await ui.findAll({ type: 'Text', text: /Build the theme/ })).map(t => t.text)
  expect(titles).toEqual(['Build the theme', 'Build the theme'])
  await ui.unmount()
})

test('saiyan with motion off: every avatar and mark draws, none is interactive, no SMIL in any source', { options: { theme: 'saiyan', motion: 'off' } }, async ($, on) => {
  on('state.get', (_, e) => seeded(e.key))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.filter(s => s.props.width === LINE_PX)).toHaveLength(1)
  expect(svgs.filter(s => s.props.width === AVATAR_PX)).toHaveLength(ALTS.length - 1)
  expect(svgs.some(s => s.props.isInteractive !== undefined)).toBe(false)
  expect(svgs.some(s => String(s.props.source).includes('<animate'))).toBe(false)
  await ui.unmount()
})

test('saiyan collapsed: the one-line band carries only the session avatar as its mark, no sections', { options: { theme: 'saiyan' } }, async ($, on) => {
  on('state.get', (_, e) => seeded(e.key, { ui: { isExpanded: false, dismissedAt: null }, flags: [] }))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.map(s => [s.props.alt, s.props.width])).toEqual([['gold mentor, session, running', LINE_PX]])
  expect(await ui.find({ type: 'Text', text: /^Cast$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Steps$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'expand' })).toBeDefined()
  await ui.unmount()
})

test('saiyan with no workflow agents: no Cast section; the session sits on the line, asleep while no turn runs', { options: { theme: 'saiyan' } }, async ($, on) => {
  on('state.get', (_, e) => seeded(e.key, { run: { ...run, agents: {}, startedLabels: [] }, flags: [] }))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, isWorking: false } })
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.filter(s => s.props.width === AVATAR_PX)).toHaveLength(0)
  const mentor = svgs.find(s => s.props.width === LINE_PX)
  expect(mentor?.props.alt).toBe('gold mentor, session, idle')
  expect(mentor?.props.isInteractive).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Cast$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Steps$/ })).toBeDefined()
  await ui.unmount()
})

test('saiyan on the terminal: the cast as text chips, one glyph per shape, state glyph and power bar; no sections, padded columns', { options: { theme: 'saiyan' } }, async ($, on) => {
  on('state.get', (_, e) => seeded(e.key))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: /Cast: / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Cast$/ })).toBeUndefined()
  const row = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
  expect(row).toContain('● session › ▰▱▱▱▱')
  expect(row).toContain('◆R review:bugs › ▰▱▱▱▱')
  expect(row).toContain('◆V verify:src/eta.ts ⚠')
  expect(row).toContain('❯ research:auth ›')
  expect(row).toContain('▲ write:draft ›')
  expect(row).toContain('⬣ fix:lint ›')
  expect(row).toContain('⬟ qa:smoke ›')
  expect(row).toContain('⬢ judge:final ›')
  expect(row).toContain('■ Explore the codeb… ›')
  expect(row).toContain('⬟ test:e2e ✗')
  expect(row).toContain('⬢ synth:report ✓')
  // the terminal keeps its monospaced columns: the step text is padded to its column
  const titles = (await ui.findAll({ type: 'Text', text: /Build the theme/ })).map(t => t.text)
  expect(titles.some(t => /Build the theme\s{2,}$/.test(t))).toBe(true)
  await ui.unmount()
})

for (const theme of ['pixel', 'ink', 'mecha', 'neon'] as const) {
  test(`${theme} on the desktop: the same cast, marks and sizes as saiyan, each drawing accepted by the surface`, { options: { theme } }, async ($, on) => {
    on('state.get', (_, e) => seeded(e.key))
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const svgs = await ui.findAll({ type: 'Svg' })
    expect(svgs.filter(s => s.props.width === LINE_PX).map(s => s.props.alt)).toEqual([ALTS[0]])
    expect(svgs.filter(s => s.props.width === AVATAR_PX).map(s => s.props.alt)).toEqual(ALTS.slice(1))
    expect(svgs.filter(s => s.props.width === MARK_PX).map(s => s.props.alt)).toEqual(['current step', 'pending'])
    // six animated faces (the cap) and the current step's mark
    expect(svgs.filter(s => s.props.isInteractive === true)).toHaveLength(7)
    await ui.unmount()
  })
}

test('classic (the default): no cast, no Svg on either surface; the desktop still gets sections and unpadded text', async ($, on) => {
  on('state.get', (_, e) => seeded(e.key))
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
    expect(await ui.find({ type: 'Text', text: /Cast/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /review:bugs/ })).toBeDefined()
    const titles = (await ui.findAll({ type: 'Text', text: /Build the theme/ })).map(t => t.text)
    if (surface === 'desktop') {
      expect(titles).toEqual(['Build the theme', 'Build the theme'])
      expect(await ui.find({ type: 'Text', text: /^Steps$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^›$/ })).toBeDefined()
    } else {
      expect(titles.some(t => /\s{2,}$/.test(t))).toBe(true)
      expect(await ui.find({ type: 'Text', text: /^Steps$/ })).toBeUndefined()
    }
    await ui.unmount()
  }
})
