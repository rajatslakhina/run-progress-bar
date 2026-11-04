// Pure: the ink theme. One ink on a round of paper, the body a brush stroke
// with a thin echo, a single vermilion accent for the power arc, the seal
// badge and a failure. Only a wash breathes; nothing flashes.
import type { Avatar } from './cast'
import { faceAt, shapePath } from './cast'
import { ROLE_SPECS, badgeLetter } from './roles'
import { EASE, SVG_CLOSE, arcPath, dropMark, faceMarks, sparkle, svgOpen } from './theme-kit'
import type { Indicator } from './view'

const INK = '#2B2622'
const PAPER = '#F2EADB'
const ACCENT = '#C8412B'
const WASH = '#8A8178'
const RING_R = 10.8

export function avatarSvg(av: Avatar, size: number): string {
  const spec = ROLE_SPECS[av.role]
  const [fx, fy] = faceAt(spec.shape)
  const body = shapePath(spec.shape)
  const idle = av.state === 'idle'
  const p: string[] = [svgOpen(size)]
  if (av.power !== null) {
    p.push(`<circle cx="12" cy="12" r="${RING_R}" fill="none" stroke="${WASH}" stroke-width="1.2" opacity="0.35"/>`)
    if (av.power > 0) p.push(`<path d="${arcPath(12, 12, RING_R, 0, 360 * av.power)}" fill="none" stroke="${ACCENT}" stroke-width="1.4" stroke-linecap="round"/>`)
  }
  p.push(`<circle cx="12" cy="12" r="9.3" fill="${PAPER}" opacity="${idle ? '0.55' : '0.95'}"/>`)
  if (av.state === 'running') {
    const breathe = av.isAnimated
      ? `<animate attributeName="opacity" values="0.08;0.26;0.08" dur="2.8s" repeatCount="indefinite" ${EASE}/><animate attributeName="r" values="8;9;8" dur="2.8s" repeatCount="indefinite" ${EASE}/>`
      : ''
    p.push(`<circle cx="12" cy="12" r="8.4" fill="${WASH}" opacity="0.16">${breathe}</circle>`)
  }
  const stroke = av.state === 'failed' ? ACCENT : INK
  const fade = av.state === 'stalled' && av.isAnimated ? `<animate attributeName="opacity" values="1;0.6;1" dur="1.8s" repeatCount="indefinite" ${EASE}/>` : ''
  p.push(`<g${idle ? ' opacity="0.6"' : ''}>`)
  p.push(`<path d="${body}" fill="none" stroke="${stroke}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">${fade}</path>`)
  p.push(`<path d="${body}" fill="none" stroke="${stroke}" stroke-width="0.6" stroke-linejoin="round" opacity="0.45" transform="translate(0.4 0.4)"/>`)
  p.push(faceMarks(av.state, fx, fy, av.isAnimated, INK))
  p.push('</g>')
  if (av.state === 'stalled' || av.state === 'failed') p.push(dropMark(fx + 5.6, fy - 4.2, av.state === 'failed' ? ACCENT : INK, av.state === 'stalled' && av.isAnimated))
  if (av.state === 'done') p.push(sparkle(18.6, 5.5, ACCENT))
  if (spec.hasBadge) {
    p.push(`<rect x="15.8" y="2.6" width="6.2" height="6.2" rx="1" fill="${ACCENT}"/><text x="18.9" y="7.4" font-size="4.6" font-family="serif" font-weight="700" text-anchor="middle" fill="#FFFFFF">${badgeLetter(av.label)}</text>`)
  }
  p.push(SVG_CLOSE)
  return p.join('')
}

export function indicatorSvg(kind: Indicator, animated: boolean): string {
  const open = svgOpen(12, 12)
  if (kind === 'done') return `${open}<circle cx="6" cy="6" r="5" fill="${PAPER}"/><path d="M3.6 6.2L5.3 7.8L8.5 4.4" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>${SVG_CLOSE}`
  if (kind === 'pending') return `${open}<circle cx="6" cy="6" r="3.2" fill="none" stroke="${INK}" stroke-width="1.1" opacity="0.55"/>${SVG_CLOSE}`
  const wash = animated
    ? `<circle cx="6" cy="6" r="4.6" fill="${WASH}" opacity="0.25"><animate attributeName="r" values="3.6;5.4;3.6" dur="2.8s" repeatCount="indefinite" ${EASE}/><animate attributeName="opacity" values="0.3;0.1;0.3" dur="2.8s" repeatCount="indefinite" ${EASE}/></circle>`
    : `<circle cx="6" cy="6" r="4.6" fill="${WASH}" opacity="0.2"/>`
  return `${open}${wash}<circle cx="6" cy="6" r="2.6" fill="${ACCENT}"/>${SVG_CLOSE}`
}
