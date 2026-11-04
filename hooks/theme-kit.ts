// Pure: what every theme's drawing shares. Colour arithmetic, arcs, the
// SVG envelope, and the small marks (face, sweat drop, sparkle) the softer
// themes reuse. No `$` here.
import type { AvatarState } from './roles'

/** One soft ease for every breathing motion. */
export const EASE = 'calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1"'
export const SAD_OUTLINE = '#E06C75'
export const DROP = '#8FC7F2'
export const SVG_CLOSE = '</svg>'

export const f1 = (n: number): string => (Math.round(n * 10) / 10).toString()

export const svgOpen = (size: number, view = 24): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view} ${view}" width="${size}" height="${size}">`

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(ch => ch + ch).join('') : h
  const n = Number.parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toHex = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase()

/** The colour `t` of the way from `hex` toward `toward`. */
export function mix(hex: string, toward: string, t: number): string {
  const a = hexToRgb(hex)
  const b = hexToRgb(toward)
  const k = Math.max(0, Math.min(1, t))
  return `#${toHex(a[0] + (b[0] - a[0]) * k)}${toHex(a[1] + (b[1] - a[1]) * k)}${toHex(a[2] + (b[2] - a[2]) * k)}`
}
export const shade = (hex: string, t: number): string => mix(hex, '#000000', t)
export const tint = (hex: string, t: number): string => mix(hex, '#FFFFFF', t)

/** A point on a circle; 0° is the top, degrees run clockwise. */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

/** An arc from `fromDeg` clockwise to `toDeg` (at most a near-full turn), as a path `d`. */
export function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const sweep = Math.max(0, Math.min(359.9, toDeg - fromDeg))
  const [x0, y0] = polar(cx, cy, r, fromDeg)
  const [x1, y1] = polar(cx, cy, r, fromDeg + sweep)
  return `M${f1(x0)} ${f1(y0)}A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${f1(x1)} ${f1(y1)}`
}

/** A sweat drop beside the brow: still, or sliding down while animated. */
export function dropMark(x: number, y: number, color: string, animated: boolean): string {
  const slide = animated ? '<animateTransform attributeName="transform" type="translate" values="0 0;0 1.6;0 0" dur="2.2s" repeatCount="indefinite"/>' : ''
  return `<g transform="translate(${f1(x)} ${f1(y)})"><path d="M0 0q-1.5 2.4 0 3.3q1.5 -0.9 0 -3.3Z" fill="${color}" opacity="0.9">${slide}</path></g>`
}

/** A small four-point sparkle centred on (x, y). */
export const sparkle = (x: number, y: number, color: string): string =>
  `<path d="M${f1(x)} ${f1(y - 2.3)}l0.7 1.6l1.6 0.7l-1.6 0.7l-0.7 1.6l-0.7 -1.6l-1.6 -0.7l1.6 -0.7Z" fill="${color}" opacity="0.9"/>`

/**
 * The eyes and mouth of one state, drawn in `ink` around (fx, fy): closed
 * and resting when idle, open (with a blink while animated) and smiling when
 * running, happy arcs when done, small eyes and a frown when failed, a flat
 * mouth when stalled. `cheek` adds two faint blushes.
 */
export function faceMarks(state: AvatarState, fx: number, fy: number, animated: boolean, ink: string, cheek?: string): string {
  const lx = f1(fx - 2.4)
  const rx = f1(fx + 2.4)
  const ey = f1(fy - 0.8)
  const p: string[] = [`<g fill="${ink}" stroke="${ink}" opacity="0.88" stroke-width="1.1" stroke-linecap="round">`]
  if (state === 'idle') {
    p.push(`<path d="M${f1(fx - 3.4)} ${ey}h2M${f1(fx + 1.4)} ${ey}h2" fill="none"/>`)
    p.push(`<path d="M${f1(fx - 1.2)} ${f1(fy + 2)}h2.4" fill="none"/>`)
  } else if (state === 'done') {
    p.push(`<path d="M${f1(fx - 3.6)} ${f1(fy - 0.2)}q1.2 -1.9 2.4 0M${f1(fx + 1.2)} ${f1(fy - 0.2)}q1.2 -1.9 2.4 0" fill="none"/>`)
    p.push(`<path d="M${f1(fx - 2)} ${f1(fy + 1.8)}q2 2.2 4 0" fill="none"/>`)
  } else if (state === 'failed') {
    p.push(`<circle cx="${lx}" cy="${ey}" r="1" stroke="none"/><circle cx="${rx}" cy="${ey}" r="1" stroke="none"/>`)
    p.push(`<path d="M${f1(fx - 1.8)} ${f1(fy + 2.8)}q1.8 -1.6 3.6 0" fill="none"/>`)
  } else {
    const blink = animated ? '<animate attributeName="ry" values="1.3;1.3;0.15;1.3;1.3" keyTimes="0;0.9;0.93;0.96;1" dur="4.2s" repeatCount="indefinite"/>' : ''
    p.push(`<ellipse cx="${lx}" cy="${ey}" rx="1.1" ry="1.3" stroke="none">${blink}</ellipse><ellipse cx="${rx}" cy="${ey}" rx="1.1" ry="1.3" stroke="none">${blink}</ellipse>`)
    p.push(state === 'stalled' ? `<path d="M${f1(fx - 1.4)} ${f1(fy + 2.2)}h2.8" fill="none"/>` : `<path d="M${f1(fx - 1.6)} ${f1(fy + 1.8)}q1.6 1.4 3.2 0" fill="none"/>`)
  }
  p.push('</g>')
  if (cheek !== undefined && state !== 'failed') {
    p.push(`<circle cx="${f1(fx - 3.9)}" cy="${f1(fy + 1.3)}" r="1" fill="${cheek}" opacity="0.35"/><circle cx="${f1(fx + 3.9)}" cy="${f1(fy + 1.3)}" r="1" fill="${cheek}" opacity="0.35"/>`)
  }
  return p.join('')
}
