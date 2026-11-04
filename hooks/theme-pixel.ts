// Pure: the pixel theme. Each avatar is a 10×10 sprite of 2 px cells, lit
// from the top-left, with a face of single pixels; motion is stepped, two
// frames at a time, as a sprite's is. Power is a chunky five-segment bar.
import type { Avatar } from './cast'
import { ROLE_SPECS, badgeLetter } from './roles'
import type { Shape } from './roles'
import { DROP, SAD_OUTLINE, SVG_CLOSE, shade, svgOpen, tint } from './theme-kit'
import type { Indicator } from './view'

const CELL = 2
const ORIGIN_X = 2
const ORIGIN_Y = 1
const INK = '#1E222B'

/** Ten rows of ten cells per body; `#` is filled. */
const BITMAPS: Readonly<Record<Shape, readonly string[]>> = {
  circle: ['...####...', '.########.', '.########.', '##########', '##########', '##########', '##########', '.########.', '.########.', '...####...'],
  triangle: ['....##....', '....##....', '...####...', '...####...', '..######..', '..######..', '.########.', '.########.', '##########', '##########'],
  diamond: ['....##....', '...####...', '..######..', '.########.', '##########', '##########', '.########.', '..######..', '...####...', '....##....'],
  hexagon: ['...####...', '..######..', '.########.', '##########', '##########', '##########', '##########', '.########.', '..######..', '...####...'],
  chevron: ['######....', '.######...', '..######..', '...######.', '....######', '....######', '...######.', '..######..', '.######...', '######....'],
  octagon: ['..######..', '.########.', '##########', '##########', '##########', '##########', '##########', '##########', '.########.', '..######..'],
  shield: ['##########', '##########', '##########', '##########', '##########', '.########.', '.########.', '..######..', '...####...', '....##....'],
  square: ['##########', '##########', '##########', '##########', '##########', '##########', '##########', '##########', '##########', '##########'],
}

/** Where the face moves on bodies whose mass is off-centre, in cells. */
const FACE_SHIFT: Readonly<Record<Shape, readonly [number, number]>> = {
  circle: [0, 0],
  triangle: [0, 2],
  diamond: [0, 0],
  hexagon: [0, 0],
  chevron: [1, 0],
  octagon: [0, 0],
  shield: [0, -1],
  square: [0, 0],
}

type Cell = readonly [number, number]

const key = (x: number, y: number): string => `${x},${y}`

function bodyCells(shape: Shape): Cell[] {
  const out: Cell[] = []
  BITMAPS[shape].forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) if (row.charAt(x) === '#') out.push([x, y])
  })
  return out
}

/** A path of 2 px squares, one per cell. */
const cellsPath = (cells: readonly Cell[]): string => cells.map(([x, y]) => `M${ORIGIN_X + x * CELL} ${ORIGIN_Y + y * CELL}h${CELL}v${CELL}h-${CELL}Z`).join('')

const layer = (cells: readonly Cell[], color: string, inner = ''): string => (cells.length === 0 ? '' : `<path d="${cellsPath(cells)}" fill="${color}">${inner}</path>`)

export function avatarSvg(av: Avatar, size: number): string {
  const spec = ROLE_SPECS[av.role]
  const c = spec.color
  const cells = bodyCells(spec.shape)
  const filled = new Set(cells.map(([x, y]) => key(x, y)))
  const has = (x: number, y: number): boolean => filled.has(key(x, y))
  const light: Cell[] = []
  const dark: Cell[] = []
  const base: Cell[] = []
  const edge: Cell[] = []
  for (const [x, y] of cells) {
    const top = !has(x, y - 1)
    const bottom = !has(x, y + 1)
    const right = !has(x + 1, y)
    const left = !has(x - 1, y)
    if (top || bottom || right || left) edge.push([x, y])
    if (bottom || right) dark.push([x, y])
    else if (top || left) light.push([x, y])
    else base.push([x, y])
  }
  const [dx, dy] = FACE_SHIFT[spec.shape]
  const at = (list: ReadonlyArray<Cell>): Cell[] => list.map(([x, y]) => [x + dx, y + dy])
  const eyesOpen = at([[3, 4], [6, 4]])
  const eyesClosed = at([[2, 4], [3, 4], [6, 4], [7, 4]])
  const eyesHappy = at([[2, 4], [3, 3], [4, 4], [5, 4], [6, 3], [7, 4]])
  const smile = at([[3, 6], [4, 7], [5, 7], [6, 6]])
  const flat = at([[4, 7], [5, 7]])
  const frown = at([[3, 7], [4, 6], [5, 6], [6, 7]])
  const eyes = av.state === 'idle' ? eyesClosed : av.state === 'done' ? eyesHappy : eyesOpen
  const mouth = av.state === 'idle' || av.state === 'stalled' ? flat : av.state === 'failed' ? frown : smile
  const moving = av.isAnimated && (av.state === 'running' || av.state === 'stalled')
  const blink = moving ? '<animate attributeName="opacity" values="1;1;0;1" keyTimes="0;0.9;0.95;1" calcMode="discrete" dur="4s" repeatCount="indefinite"/>' : ''
  let motion = ''
  if (av.isAnimated && av.state === 'running') motion = '<animateTransform attributeName="transform" type="translate" values="0 0;0 -1;0 0" keyTimes="0;0.5;1" calcMode="discrete" dur="1s" repeatCount="indefinite"/>'
  if (av.isAnimated && av.state === 'stalled') motion = '<animate attributeName="opacity" values="1;0.7;1" keyTimes="0;0.5;1" calcMode="discrete" dur="1s" repeatCount="indefinite"/>'

  const p: string[] = [svgOpen(size)]
  p.push(`<g opacity="${av.state === 'idle' ? '0.45' : '1'}">${motion}`)
  p.push(layer(base, c), layer(light, tint(c, 0.35)), layer(dark, shade(c, 0.3)))
  if (av.state === 'failed') p.push(layer(edge, SAD_OUTLINE))
  p.push(layer(eyes, INK, blink), layer(mouth, INK))
  p.push('</g>')
  if (av.state === 'stalled' || av.state === 'failed') {
    const slide = av.isAnimated && av.state === 'stalled' ? '<animateTransform attributeName="transform" type="translate" values="0 0;0 2;0 4" keyTimes="0;0.5;1" calcMode="discrete" dur="1.2s" repeatCount="indefinite"/>' : ''
    const x = ORIGIN_X + (9 + dx) * CELL + 2
    const y = ORIGIN_Y + (2 + dy) * CELL
    p.push(`<path d="M${x} ${y}h2v4h-2Z" fill="${DROP}">${slide}</path>`)
  }
  if (av.state === 'done') p.push(`<path d="M4 1h2v2h-2ZM2 3h2v2h-2ZM6 3h2v2h-2ZM4 5h2v2h-2Z" fill="${tint(c, 0.6)}"/>`)
  if (av.power !== null) {
    const lit = Math.round(av.power * 5)
    for (let i = 0; i < 5; i += 1) p.push(`<rect x="${2 + i * 4}" y="22" width="3" height="2" fill="${c}" opacity="${i < lit ? '1' : '0.2'}"/>`)
  }
  if (spec.hasBadge) {
    p.push(`<rect x="16" y="1" width="6" height="6" fill="#FFFFFF"/><text x="19" y="6" font-size="5" font-family="monospace" font-weight="700" text-anchor="middle" fill="${c}">${badgeLetter(av.label)}</text>`)
  }
  p.push(SVG_CLOSE)
  return p.join('')
}

export function indicatorSvg(kind: Indicator, animated: boolean): string {
  const open = svgOpen(12, 12)
  if (kind === 'done') return `${open}<rect x="2" y="2" width="8" height="8" fill="#7CCB9A"/><path d="M3 6h2v2h-2ZM5 7h2v2h-2ZM7 5h2v2h-2Z" fill="#FFFFFF"/>${SVG_CLOSE}`
  if (kind === 'pending') return `${open}<path d="M2 2h8v8h-8ZM4 4h4v4h-4Z" fill="#8A90A0" fill-rule="evenodd" opacity="0.7"/>${SVG_CLOSE}`
  const pulse = animated ? '<animate attributeName="opacity" values="0.6;0.15;0.6" keyTimes="0;0.5;1" calcMode="discrete" dur="1s" repeatCount="indefinite"/>' : ''
  return `${open}<rect x="4" y="4" width="4" height="4" fill="#E4A24B"/><path d="M2 2h8v8h-8ZM4 4h4v4h-4Z" fill="#E4A24B" fill-rule="evenodd" opacity="0.35">${pulse}</path>${SVG_CLOSE}`
}
