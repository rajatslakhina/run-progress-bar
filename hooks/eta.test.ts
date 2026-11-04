import { expect, test } from 'claude-code/testing'

import { computeEta, historyEstimate, historyRows, phaseRemaining, quantile } from './eta'

const MIN = 60_000

test('eta: no completed sample means unknown, never a guess', () => {
  expect(phaseRemaining({ samples: [], runningElapsed: [3 * MIN], parallelism: 4 })).toBeNull()
  expect(computeEta({ samples: [], runningElapsed: [3 * MIN], parallelism: 4, laterPhases: [10 * MIN] })).toBeNull()
})

test('eta: one sample collapses the range to one value and says so', () => {
  const eta = computeEta({ samples: [10 * MIN], runningElapsed: [2 * MIN, 4 * MIN], parallelism: 4, laterPhases: [] })
  expect(eta).not.toBeNull()
  expect(eta!.lowMs).toBe(8 * MIN)
  expect(eta!.highMs).toBe(8 * MIN)
  expect(eta!.samples).toBe(1)
})

test('eta: many samples give a p25–p75 range over the slowest running agent', () => {
  const samples = [4, 6, 8, 10, 12].map(m => m * MIN) // p25 = 6m, p75 = 10m
  const eta = computeEta({ samples, runningElapsed: [1 * MIN, 3 * MIN], parallelism: 4, laterPhases: [] })
  expect(eta!.lowMs).toBe(5 * MIN)
  expect(eta!.highMs).toBe(9 * MIN)
  expect(eta!.samples).toBe(5)
})

test('eta: more running agents than parallelism are summed and divided', () => {
  const r = phaseRemaining({ samples: [10 * MIN], runningElapsed: [0, 0, 0, 0], parallelism: 2 })
  expect(r!.lowMs).toBe(20 * MIN)
})

test('eta: nothing running in the phase leaves only the later phases', () => {
  const eta = computeEta({ samples: [5 * MIN], runningElapsed: [], parallelism: 3, laterPhases: [15 * MIN, null] })
  expect(eta!.lowMs).toBe(15 * MIN)
  expect(eta!.highMs).toBe(15 * MIN)
  expect(eta!.unestimated).toBe(1)
})

test('eta: elapsed past the sample never goes negative', () => {
  const r = phaseRemaining({ samples: [5 * MIN], runningElapsed: [50 * MIN], parallelism: 1 })
  expect(r!.lowMs).toBe(0)
})

test('quantile: interpolates and clamps', () => {
  expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
  expect(quantile([7], 0.25)).toBe(7)
  expect(quantile([1, 2, 3], 2)).toBe(3)
  expect(Number.isNaN(quantile([], 0.5))).toBe(true)
})

test('history: prefers rows of the same workflow, falls back to any run of the phase', () => {
  const rows = historyRows([
    { name: 'a', phase: 'Verify', phaseMs: 10 * MIN, agentMedianMs: 1, agents: 3, at: 1 },
    { name: 'b', phase: 'Verify', phaseMs: 30 * MIN, agentMedianMs: 1, agents: 3, at: 1 },
    { phase: 'bad' }, // dropped: no phaseMs
    'garbage',
  ])
  expect(rows).toHaveLength(2)
  expect(historyEstimate(rows, 'a', 'Verify')).toBe(10 * MIN)
  expect(historyEstimate(rows, 'zzz', 'Verify')).toBe(20 * MIN)
  expect(historyEstimate(rows, 'a', 'Fix')).toBeNull()
})
