import { expect, test } from 'claude-code/testing'

import type { Avatar } from './cast'
import { isMovingState } from './roles'
import type { AvatarState, Role } from './roles'
import { THEMES, parseTheme, themeDraw } from './themes'
import type { Indicator } from './view'

const ROLES: Role[] = ['mentor', 'fighter', 'rival', 'sage', 'scout', 'engineer', 'guard', 'unknown']
const STATES: AvatarState[] = ['idle', 'running', 'done', 'failed', 'stalled']
const KINDS: Indicator[] = ['current', 'done', 'pending']

const avatar = (over: Partial<Avatar>): Avatar => ({ id: 'a', role: 'fighter', label: 'write:x', state: 'running', power: null, isAnimated: false, startedAt: 0, ...over })

test('themes: the registry holds every drawn theme; the option parses to a name or classic', () => {
  expect(Object.keys(THEMES).sort()).toEqual(['ink', 'mecha', 'neon', 'pixel', 'saiyan'])
  for (const [name, t] of Object.entries(THEMES)) expect(t.name).toBe(name)
  expect(parseTheme('pixel')).toBe('pixel')
  expect(parseTheme('saiyan')).toBe('saiyan')
  expect(parseTheme('classic')).toBe('classic')
  expect(parseTheme('nope')).toBe('classic')
  expect(parseTheme(undefined)).toBe('classic')
  expect(parseTheme(3)).toBe('classic')
  expect(themeDraw('classic')).toBeNull()
  expect(themeDraw('ink')?.name).toBe('ink')
})

test('themes: every theme draws every role and state as a well-formed SVG, animating only a moving avatar that was asked to', () => {
  for (const theme of Object.values(THEMES)) {
    for (const role of ROLES) {
      for (const state of STATES) {
        for (const isAnimated of [true, false]) {
          const svg = theme.avatarSvg(avatar({ role, state, isAnimated, power: 0.5, label: role === 'rival' ? 'review:x' : 'write:x' }), 24)
          const where = `${theme.name} ${role} ${state} ${isAnimated ? 'animated' : 'still'}`
          expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), where).toBe(true)
          expect(svg.endsWith('</svg>'), where).toBe(true)
          expect(svg, where).toContain('width="24" height="24"')
          expect(svg, where).not.toMatch(/<script|<foreignObject|\son[a-z]+=|javascript:|<image/i)
          expect(svg.length, where).toBeLessThan(4500)
          expect(/<animate(Transform)?\b/.test(svg), where).toBe(isAnimated && isMovingState(state))
          if (role === 'rival') expect(svg, where).toContain('>R<')
          else expect(svg, where).not.toContain('<text')
        }
      }
    }
  }
})

test('themes: the power level shows only when known, grows with it, and the avatar takes the line size', () => {
  for (const theme of Object.values(THEMES)) {
    const none = theme.avatarSvg(avatar({ power: null }), 24)
    const half = theme.avatarSvg(avatar({ power: 0.5 }), 24)
    const full = theme.avatarSvg(avatar({ power: 1 }), 24)
    expect(half, theme.name).not.toBe(none)
    expect(full, theme.name).not.toBe(half)
    expect(half.length, theme.name).toBeGreaterThan(none.length)
    expect(theme.avatarSvg(avatar({}), 20), theme.name).toContain('width="20" height="20"')
    // the eight shapes stay apart: eight different drawings per theme
    const bodies = new Set(ROLES.map(role => theme.avatarSvg(avatar({ role, power: null }), 24)))
    expect(bodies.size, theme.name).toBe(ROLES.length)
    // the five states stay apart too
    const looks = new Set(STATES.map(state => theme.avatarSvg(avatar({ state, power: null }), 24)))
    expect(looks.size, theme.name).toBe(STATES.length)
  }
})

test('themes: three distinct step marks per theme, 12 px, the current one animated only when asked', () => {
  for (const theme of Object.values(THEMES)) {
    for (const kind of KINDS) {
      const still = theme.indicatorSvg(kind, false)
      const live = theme.indicatorSvg(kind, true)
      expect(still, `${theme.name} ${kind}`).toContain('width="12" height="12"')
      expect(still, `${theme.name} ${kind}`).not.toMatch(/<animate/)
      expect(/<animate/.test(live), `${theme.name} ${kind}`).toBe(kind === 'current')
      expect(live, `${theme.name} ${kind}`).not.toMatch(/<script|\son[a-z]+=/i)
    }
    expect(new Set(KINDS.map(k => theme.indicatorSvg(k, false))).size, theme.name).toBe(3)
  }
})
