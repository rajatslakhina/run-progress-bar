// Pure: the theme registry. Every theme draws the same cast (roles, states,
// power, the animation cap) through two functions; `classic` draws none and
// keeps the glyphs. The `theme` option names one of these.
import type { Avatar } from './cast'
import { avatarSvg as saiyanAvatar, indicatorSvg as saiyanIndicator } from './cast'
import * as ink from './theme-ink'
import * as mecha from './theme-mecha'
import * as neon from './theme-neon'
import * as pixel from './theme-pixel'
import type { Indicator } from './view'

export const THEME_NAMES = ['classic', 'saiyan', 'pixel', 'ink', 'mecha', 'neon'] as const
export type ThemeName = (typeof THEME_NAMES)[number]
export type DrawnTheme = Exclude<ThemeName, 'classic'>

export type ThemeDraw = {
  name: DrawnTheme
  /** One avatar, `size` CSS pixels square; SMIL inside only while `av.isAnimated`. */
  avatarSvg: (av: Avatar, size: number) => string
  /** A 12 px step mark; animated only for the current step while asked. */
  indicatorSvg: (kind: Indicator, animated: boolean) => string
}

export const THEMES: Readonly<Record<DrawnTheme, ThemeDraw>> = {
  saiyan: { name: 'saiyan', avatarSvg: saiyanAvatar, indicatorSvg: saiyanIndicator },
  pixel: { name: 'pixel', avatarSvg: pixel.avatarSvg, indicatorSvg: pixel.indicatorSvg },
  ink: { name: 'ink', avatarSvg: ink.avatarSvg, indicatorSvg: ink.indicatorSvg },
  mecha: { name: 'mecha', avatarSvg: mecha.avatarSvg, indicatorSvg: mecha.indicatorSvg },
  neon: { name: 'neon', avatarSvg: neon.avatarSvg, indicatorSvg: neon.indicatorSvg },
}

/** The `theme` option as stored; anything else is `classic`. */
export function parseTheme(v: unknown): ThemeName {
  return typeof v === 'string' && (THEME_NAMES as readonly string[]).includes(v) ? (v as ThemeName) : 'classic'
}

export const themeDraw = (name: ThemeName): ThemeDraw | null => (name === 'classic' ? null : THEMES[name])
