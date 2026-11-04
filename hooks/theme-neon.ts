// Pure: the neon theme. A dark glass round, the body an outline that glows
// in the role hue (a wide soft stroke under a crisp one), a face of light,
// and a dotted ring for power. The glow breathes while running; idle dims.
import type { Avatar } from './cast'
import { faceAt, shapePath } from './cast'
import { ROLE_SPECS, badgeLetter } from './roles'
import { EASE, SAD_OUTLINE, SVG_CLOSE, arcPath, dropMark, faceMarks, sparkle, svgOpen } from './theme-kit'
import type { Indicator } from './view'

const GLASS = '#0E1016'
const RING_R = 10.5
const DOTS = 'stroke-dasharray="1.1 2.2"'

export function avatarSvg(av: Avatar, size: number): string {
  const spec = ROLE_SPECS[av.role]
  const c = spec.color
  const [fx, fy] = faceAt(spec.shape)
  const body = shapePath(spec.shape)
  const idle = av.state === 'idle'
  const glow = av.state === 'failed' ? SAD_OUTLINE : c
  const p: string[] = [svgOpen(size)]
  p.push(`<circle cx="12" cy="12" r="9.6" fill="${GLASS}" opacity="0.85"/>`)
  if (av.power !== null) {
    p.push(`<circle cx="12" cy="12" r="${RING_R}" fill="none" stroke="${c}" stroke-width="1.4" ${DOTS} opacity="0.22"/>`)
    if (av.power > 0) p.push(`<path d="${arcPath(12, 12, RING_R, 0, 360 * av.power)}" fill="none" stroke="${c}" stroke-width="1.4" ${DOTS} opacity="0.95"/>`)
  }
  const bloom = av.state === 'running' ? '0.38' : idle ? '0.08' : '0.25'
  const breathe = av.isAnimated && av.state === 'running' ? `<animate attributeName="opacity" values="0.2;0.5;0.2" dur="2.6s" repeatCount="indefinite" ${EASE}/>` : ''
  p.push(`<path d="${body}" fill="none" stroke="${glow}" stroke-width="3.6" stroke-linejoin="round" opacity="${bloom}">${breathe}</path>`)
  const fade = av.isAnimated && av.state === 'stalled' ? `<animate attributeName="opacity" values="1;0.55;1" dur="1.8s" repeatCount="indefinite" ${EASE}/>` : ''
  p.push(`<g opacity="${idle ? '0.5' : '1'}">`)
  p.push(`<path d="${body}" fill="${c}" fill-opacity="${idle ? '0.05' : '0.12'}" stroke="${glow}" stroke-width="1.4" stroke-linejoin="round">${fade}</path>`)
  p.push(faceMarks(av.state, fx, fy, av.isAnimated, glow))
  p.push('</g>')
  if (av.state === 'stalled' || av.state === 'failed') p.push(dropMark(fx + 5.6, fy - 4.2, glow, av.state === 'stalled' && av.isAnimated))
  if (av.state === 'done') p.push(sparkle(18.6, 5.5, '#FFFFFF'))
  if (spec.hasBadge) {
    p.push(`<circle cx="18.8" cy="5.4" r="3.4" fill="${GLASS}" stroke="${c}" stroke-width="1"/><text x="18.8" y="7.1" font-size="4.8" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="${c}">${badgeLetter(av.label)}</text>`)
  }
  p.push(SVG_CLOSE)
  return p.join('')
}

export function indicatorSvg(kind: Indicator, animated: boolean): string {
  const open = svgOpen(12, 12)
  if (kind === 'done') return `${open}<circle cx="6" cy="6" r="5" fill="#7CCB9A" opacity="0.3"/><path d="M3.6 6.2L5.3 7.8L8.5 4.4" fill="none" stroke="#7CCB9A" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>${SVG_CLOSE}`
  if (kind === 'pending') return `${open}<circle cx="6" cy="6" r="3.4" fill="none" stroke="#8A90A0" stroke-width="1.2" ${DOTS} opacity="0.8"/>${SVG_CLOSE}`
  const halo = animated
    ? `<circle cx="6" cy="6" r="5" fill="#E4A24B" opacity="0.3"><animate attributeName="r" values="3.6;5.6;3.6" dur="2.6s" repeatCount="indefinite" ${EASE}/><animate attributeName="opacity" values="0.4;0.1;0.4" dur="2.6s" repeatCount="indefinite" ${EASE}/></circle>`
    : `<circle cx="6" cy="6" r="5" fill="#E4A24B" opacity="0.25"/>`
  return `${open}${halo}<circle cx="6" cy="6" r="2.4" fill="#E4A24B"/>${SVG_CLOSE}`
}
