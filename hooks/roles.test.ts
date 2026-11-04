import { expect, test } from 'claude-code/testing'

import { ROLE_SPECS, badgeLetter, isMovingState, labelPrefix, mentorState, roleOfLabel, stateOfAgent } from './roles'
import type { Role } from './roles'

test('roles: the label prefix before ":" picks the role; case and spaces do not matter', () => {
  const cases: Array<[string, Role]> = [
    ['research:auth flow', 'scout'],
    ['design:settings page', 'fighter'],
    ['write:draft', 'fighter'],
    ['review:bugs', 'rival'],
    ['verify:src/eta.ts', 'rival'],
    ['skeptic:plan', 'rival'],
    ['fix:journal offset', 'engineer'],
    ['qa:smoke', 'guard'],
    ['test:unit', 'guard'],
    ['judge:final', 'sage'],
    ['synth:report', 'sage'],
    ['  Review : a', 'rival'],
    ['WRITE:X', 'fighter'],
  ]
  for (const [label, role] of cases) expect(roleOfLabel(label)).toBe(role)
})

test('roles: a prefix that starts with a keyword matches; the whole label is the prefix without ":"; else unknown', () => {
  expect(roleOfLabel('reviewer:perf')).toBe('rival')
  expect(roleOfLabel('researcher')).toBe('scout')
  expect(roleOfLabel('tests')).toBe('guard')
  expect(roleOfLabel('fixer:lint')).toBe('engineer')
  expect(roleOfLabel('review')).toBe('rival')
  expect(roleOfLabel('Explore the codebase')).toBe('unknown')
  expect(roleOfLabel('agent-4f3a')).toBe('unknown')
  expect(roleOfLabel('')).toBe('unknown')
  expect(roleOfLabel(':no prefix')).toBe('unknown')
  expect(labelPrefix('a:b:c')).toBe('a')
})

test('roles: every role has its own shape, glyph and color; only the rival carries a badge', () => {
  const specs = Object.values(ROLE_SPECS)
  expect(specs).toHaveLength(8)
  expect(new Set(specs.map(s => s.shape)).size).toBe(8)
  expect(new Set(specs.map(s => s.glyph)).size).toBe(8)
  expect(new Set(specs.map(s => s.color)).size).toBe(8)
  expect(specs.filter(s => s.hasBadge).map(s => s.role)).toEqual(['rival'])
  for (const s of specs) expect(s.color).toMatch(/^#[0-9A-F]{6}$/)
  expect(ROLE_SPECS.mentor.shape).toBe('circle')
  expect(ROLE_SPECS.rival.shape).toBe('diamond')
  expect(ROLE_SPECS.unknown.shape).toBe('square')
})

test('roles: badge letter is the prefix initial, never markup', () => {
  expect(badgeLetter('review:x')).toBe('R')
  expect(badgeLetter('verify:y')).toBe('V')
  expect(badgeLetter('7th:seat')).toBe('7')
  expect(badgeLetter('<script>:x')).toBe('·')
  expect(badgeLetter('')).toBe('·')
})

test('roles: agent status and the stalled flag give the state; the mentor idles while no turn runs', () => {
  expect(stateOfAgent({ status: 'running' }, false)).toBe('running')
  expect(stateOfAgent({ status: 'running' }, true)).toBe('stalled')
  expect(stateOfAgent({ status: 'done' }, true)).toBe('done')
  expect(stateOfAgent({ status: 'failed' }, false)).toBe('failed')
  expect(mentorState(true)).toBe('running')
  expect(mentorState(false)).toBe('idle')
  expect(['running', 'stalled'].every(s => isMovingState(s as 'running' | 'stalled'))).toBe(true)
  expect(['idle', 'done', 'failed'].some(s => isMovingState(s as 'idle' | 'done' | 'failed'))).toBe(false)
})
