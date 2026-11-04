// Pure: the mecha theme. Angular plates in the role hue, a visor slit for a
// face whose light says the state, a thruster glow while running, and an
// eight-segment gauge for power. Edges stay sharp; motion is a slow scan.
import type { Avatar } from './cast'
import { faceAt, shapePath } from './cast'
import { ROLE_SPECS, badgeLetter } from './roles'
import type { AvatarState } from './roles'
import { EASE, SAD_OUTLINE, SVG_CLOSE, arcPath, f1, shade, svgOpen } from './theme-kit'
import type { Indicator } from './view'

const DARK = '#141820'
const VISOR: Readonly<Record<AvatarState, string>> = { idle: '#6B7280', running: '#7DE3FF', done: '#8BE3A9', failed: '#FF8A8A', stalled: '#FFD27A' }
const SEGMENTS = 8

/** A small warning diamond at the lower left, for a failed or stalled unit. */
const plate = (fill: string, mark: string, markColor: string): string =>
  `<path d="M5.6 15.2L8.8 18.4L5.6 21.6L2.4 18.4Z" fill="${fill}"/><path d="${mark}" stroke="${markColor}" stroke-width="1" stroke-linecap="round" fill="none"/>`

export function avatarSvg(av: Avatar, size: number): string {
  const spec = ROLE_SPECS[av.role]
  const c = spec.color
  const [fx, fy] = faceAt(spec.shape)
  const body = shapePath(spec.shape)
  const idle = av.state === 'idle'
  const p: string[] = [svgOpen(size)]
  if (av.power !== null) {
    const lit = Math.round(av.power * SEGMENTS)
    for (let i = 0; i < SEGMENTS; i += 1) {
      const from = i * (360 / SEGMENTS) + 3
      p.push(`<path d="${arcPath(12, 12, 10.5, from, from + 360 / SEGMENTS - 6)}" fill="none" stroke="${c}" stroke-width="1.8" opacity="${i < lit ? '0.95' : '0.15'}"/>`)
    }
  }
  if (av.state === 'running') {
    const burn = av.isAnimated
      ? `<animate attributeName="ry" values="1;1.9;1" dur="1.4s" repeatCount="indefinite" ${EASE}/><animate attributeName="opacity" values="0.25;0.5;0.25" dur="1.4s" repeatCount="indefinite" ${EASE}/>`
      : ''
    p.push(`<ellipse cx="12" cy="20.4" rx="4.6" ry="1.3" fill="${c}" opacity="0.35">${burn}</ellipse>`)
  }
  p.push(`<g opacity="${idle ? '0.5' : '1'}">`)
  const outline = av.state === 'failed' ? SAD_OUTLINE : shade(c, 0.5)
  p.push(`<path d="${body}" fill="${shade(c, 0.3)}" stroke="${outline}" stroke-width="${av.state === 'failed' ? '1.8' : '1.2'}" stroke-linejoin="miter"/>`)
  p.push(`<path d="${body}" fill="${c}" transform="translate(12 12) scale(0.66) translate(-12 -12)"/>`)
  p.push(`<rect x="${f1(fx - 4.4)}" y="${f1(fy - 2.2)}" width="8.8" height="3.2" rx="0.9" fill="${DARK}"/>`)
  const scan =
    av.isAnimated && av.state === 'running'
      ? `<animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite" ${EASE}/>`
      : av.isAnimated && av.state === 'stalled'
        ? `<animate attributeName="opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite" ${EASE}/>`
        : ''
  p.push(`<path d="M${f1(fx - 3.2)} ${f1(fy - 0.6)}H${f1(fx + 3.2)}" stroke="${VISOR[av.state]}" stroke-width="1.2" stroke-linecap="round" opacity="${idle ? '0.6' : '1'}">${scan}</path>`)
  p.push('</g>')
  if (av.state === 'done') {
    p.push(`<circle cx="5.6" cy="18.4" r="3" fill="${DARK}" stroke="#8BE3A9" stroke-width="1"/><path d="M4.1 18.5L5.2 19.6L7.2 17.4" fill="none" stroke="#8BE3A9" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>`)
  }
  if (av.state === 'failed') p.push(plate(SAD_OUTLINE, 'M5.6 17v2', '#FFFFFF'))
  if (av.state === 'stalled') p.push(plate('#FFD27A', 'M5.6 16.8v1.8M5.6 20v0.2', DARK))
  if (spec.hasBadge) {
    p.push(`<path d="M18.8 2.2L21.6 3.8V7L18.8 8.6L16 7V3.8Z" fill="${DARK}" stroke="${c}" stroke-width="0.9"/><text x="18.8" y="7" font-size="4.6" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="${c}">${badgeLetter(av.label)}</text>`)
  }
  p.push(SVG_CLOSE)
  return p.join('')
}

const HEX = 'M6 1.2L10.2 3.6V8.4L6 10.8L1.8 8.4V3.6Z'

export function indicatorSvg(kind: Indicator, animated: boolean): string {
  const open = svgOpen(12, 12)
  if (kind === 'done') return `${open}<path d="${HEX}" fill="#7CCB9A"/><path d="M3.6 6.2L5.3 7.8L8.5 4.4" fill="none" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>${SVG_CLOSE}`
  if (kind === 'pending') return `${open}<path d="${HEX}" fill="none" stroke="#8A90A0" stroke-width="1.2" opacity="0.7"/>${SVG_CLOSE}`
  const core = animated
    ? `<path d="${HEX}" fill="#E4A24B" transform="translate(6 6) scale(0.5) translate(-6 -6)"><animate attributeName="opacity" values="1;0.45;1" dur="2s" repeatCount="indefinite" ${EASE}/></path>`
    : `<path d="${HEX}" fill="#E4A24B" transform="translate(6 6) scale(0.5) translate(-6 -6)"/>`
  return `${open}<path d="${HEX}" fill="#E4A24B" opacity="0.3"/>${core}${SVG_CLOSE}`
}
