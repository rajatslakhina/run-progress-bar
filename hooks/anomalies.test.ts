import { expect, test } from 'claude-code/testing'

import { detectCost, detectGrowth, detectProcessGone, detectRetries, detectStalled, mergeFlags, pushSample } from './anomalies'

const MIN = 60_000
const T = 10 * MIN

test('stall: a running agent with no write past the threshold is flagged, one just inside is not', () => {
  const now = 100 * MIN
  const agents = [
    { agentId: 'a', label: 'fix:§3', status: 'running', startedAt: 0, lastWriteAt: now - T - 1 },
    { agentId: 'b', label: 'fix:§4', status: 'running', startedAt: 0, lastWriteAt: now - T },
    { agentId: 'c', label: 'fix:§5', status: 'done', startedAt: 0, lastWriteAt: 0 },
  ]
  const flags = detectStalled(agents, now, T)
  expect(flags).toHaveLength(1)
  expect(flags[0]!.id).toBe('stalled:a')
  expect(flags[0]!.text).toContain('fix:§3')
})

test('stall: an agent never listed on disk is measured from its start', () => {
  const now = 100 * MIN
  expect(detectStalled([{ agentId: 'x', label: 'x', status: 'running', startedAt: now - T - 1, lastWriteAt: null }], now, T)).toHaveLength(1)
  expect(detectStalled([{ agentId: 'x', label: 'x', status: 'running', startedAt: now - 1, lastWriteAt: null }], now, T)).toHaveLength(0)
})

test('retry: the same label started twice is one flag', () => {
  const flags = detectRetries(['verify:a', 'verify:b', 'verify:a', 'verify:a'], 5)
  expect(flags).toHaveLength(1)
  expect(flags[0]!.id).toBe('retry:verify:a')
  expect(flags[0]!.text).toContain('3 times')
  expect(detectRetries(['x', 'y'], 5)).toHaveLength(0)
})

test('growth: over 50% within the window flags; outside the window or from zero it does not', () => {
  const now = 60 * MIN
  const samples = {
    '/a/out.log': [
      { t: now - 20 * MIN, size: 1000 },
      { t: now, size: 1600 },
    ],
    '/a/slow.log': [
      { t: now - 20 * MIN, size: 1000 },
      { t: now, size: 1400 },
    ],
    '/a/old.log': [
      { t: now - 40 * MIN, size: 1000 },
      { t: now, size: 9000 },
    ],
    '/a/new.log': [
      { t: now - 5 * MIN, size: 0 },
      { t: now, size: 9000 },
    ],
  }
  const flags = detectGrowth(samples, now, 30 * MIN, 50)
  expect(flags).toHaveLength(1)
  expect(flags[0]!.id).toBe('growth:/a/out.log')
  expect(flags[0]!.text).toContain('+60%')
})

test('growth: pushSample keeps the window and drops duplicates', () => {
  let s = pushSample([], { t: 0, size: 1 }, 1000)
  s = pushSample(s, { t: 0, size: 1 }, 1000)
  s = pushSample(s, { t: 500, size: 2 }, 1000)
  s = pushSample(s, { t: 1600, size: 3 }, 1000)
  expect(s.map(x => x.t)).toEqual([1600])
})

test('process gone: failed and killed flag, running does not', () => {
  const flags = detectProcessGone(
    [
      { id: '1', label: 'pytest', status: 'running' },
      { id: '2', label: 'web-fetch', status: 'killed' },
      { id: '3', label: 'verify:a', status: 'failed' },
    ],
    1,
  )
  expect(flags.map(f => f.id)).toEqual(['gone:2', 'gone:3'])
})

test('cost: raised at the threshold and re-raised every step above it', () => {
  expect(detectCost(null, 100, 50, 1)).toHaveLength(0)
  expect(detectCost(99.99, 100, 50, 1)).toHaveLength(0)
  expect(detectCost(100, 100, 50, 1)[0]!.id).toBe('cost:100')
  expect(detectCost(149, 100, 50, 1)[0]!.id).toBe('cost:100')
  expect(detectCost(150, 100, 50, 1)[0]!.id).toBe('cost:150')
})

test('merge: a flag keeps its first-seen time; new ones are reported; gone ones drop', () => {
  const prev = [{ kind: 'stalled' as const, id: 'stalled:a', text: 'old', at: 1 }]
  const next = [
    { kind: 'stalled' as const, id: 'stalled:a', text: 'new', at: 9 },
    { kind: 'retry' as const, id: 'retry:x', text: 'r', at: 9 },
  ]
  const { flags, added } = mergeFlags(prev, next)
  expect(flags.map(f => [f.id, f.at])).toEqual([
    ['stalled:a', 1],
    ['retry:x', 9],
  ])
  expect(added.map(f => f.id)).toEqual(['retry:x'])
  expect(mergeFlags(flags, []).flags).toHaveLength(0)
})
