/**
 * THE ✨ BUTTON, HOUSE LAYOUT. Every look laid out the way the Michele sample looks were.
 *
 * Amaia Anderson asked for looks that format themselves; Karl, 2026-10-27: "we need to improve
 * this so the item placement is perfect every time including the brand text", and use the method
 * that styled the Michele sample looks because "they all looked good". Copying a past look
 * (styleFromTemplates.ts) gave a tiny Tory Burch bag, no label on the bag or the necklace, and a top
 * against the edge.
 *
 * The method is wsg-dashboard src/lib/proposalBuilder/layout.ts lookCanvas(): a set box on a 1080
 * board for each role (outer, top, bottom, shoe, two accessories) in four box sets, each piece fitted
 * to its box by its visible (non see-through) bounds and centred, and its brand in Amalfi Coast right
 * under it. The boxes below are that file's, number for number, except NO_OUTER's accessory column
 * (see there). What this adds for the builder:
 *   - the role comes from the piece's saved category (else its name);
 *   - 3 or more accessories share the accessory area in an even grid (no NO_OUTER: the shoe joins
 *     that grid, the area beside it is too narrow alone), so none shrinks badly;
 *   - a board that is not square scales the boxes to its size;
 *   - a board with no garment at all (only bags, say) is an even grid;
 *   - pressing again gives the mirror image, which passes the same checks.
 *
 * Nothing is deleted. A text that already says a piece's brand becomes that piece's label (never
 * written twice); any other text is a note and moves with the piece it sat beside; pictures,
 * stickers, hidden pieces and locked pieces stay where they are. A piece with no saved brand gets
 * no label (we only write brands we are sure of).
 *
 * Pure: no database, no DOM. lib/style.ts fetches, this decides, scripts/check-house-layout.mjs
 * measures the result.
 */
import type { CanvasNode, ClosetItemNode, TextNode } from '@/types/canvas'
import type { PieceType } from './styleFromTemplates.ts'

export type Box = [number, number, number, number]
export const LABEL_FONT = "'Amalfi Coast', cursive"
const FS = 26, GAP = 6, LABEL_H = 40, MIN_FS = 18

const WITH_OUTER: Record<string, Box> = {
  outer: [40, 30, 470, 600], top: [490, 40, 740, 420], bottom: [760, 30, 1050, 990],
  shoe: [60, 700, 470, 990], acc0: [490, 500, 740, 700], acc1: [490, 790, 740, 990],
}
// One change from lookCanvas, here only: its accessory column was 160 wide, which drew a bag as
// small as the "tiny Tory Burch bag" this request began with, and a necklace 90 px tall. The column
// is 240 wide (bag about 1.5x larger), the shoe box 90 narrower; top and bottom are as they were.
const NO_OUTER: Record<string, Box> = {
  top: [40, 30, 520, 600], bottom: [640, 30, 1040, 990],
  shoe: [60, 700, 360, 990], acc0: [380, 640, 620, 807], acc1: [380, 823, 620, 990],
}
const DRESS: Record<string, Box> = {
  bottom: [60, 30, 520, 990], shoe: [560, 680, 1040, 990], acc0: [600, 60, 1000, 330], acc1: [600, 370, 1000, 620],
}
const DRESS_OUTER: Record<string, Box> = {
  outer: [40, 30, 470, 600], bottom: [700, 30, 1050, 990], shoe: [60, 700, 470, 990], acc0: [490, 120, 690, 420], acc1: [490, 560, 690, 860],
}
// Where 3 or more accessories go, per box set (the area the two accessory boxes span). For
// NO_OUTER the shoe shares it: 160 wide alone would make three accessories 87 px tall.
const ACC_AREA: Record<string, { area: Box; withShoe?: boolean }> = {
  WITH_OUTER: { area: [490, 500, 740, 990] },
  NO_OUTER: { area: [60, 640, 620, 990], withShoe: true },
  DRESS: { area: [600, 60, 1000, 620] },
  DRESS_OUTER: { area: [490, 120, 690, 860] },
}
const SETS: Record<string, Record<string, Box>> = { WITH_OUTER, NO_OUTER, DRESS, DRESS_OUTER }

export interface HousePiece {
  nodeId: string
  pieceId: string
  type: PieceType
  /** A brand saved on the piece. Null when there is none, and then no label is written. */
  brand: string | null
  /** The photo's natural size, and its visible box in those pixels (null = the whole photo). */
  natW: number
  natH: number
  content: Box | null
}

export interface HouseResult {
  nodes: CanvasNode[]
  layout: string
  placed: number
  labelsAdded: number
  labelsMoved: number
  /** Pieces left without a label because no brand is saved on them. */
  unlabeled: string[]
}

const ACC_ORDER: PieceType[] = ['bag', 'jewelry', 'belt', 'scarf', 'hat', 'accessory', 'other']
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Which role each piece plays, and which box set that makes. */
export function assignRoles(pieces: HousePiece[]): { layout: string; roles: { role: string; piece: HousePiece }[] } {
  const of = (t: PieceType) => pieces.filter((p) => p.type === t)
  const extra: HousePiece[] = []
  const dresses = of('dress'), tops = of('top'), bottoms = of('bottom'), outers = of('outerwear'), shoes = of('shoes')
  const dress = dresses[0] ?? null
  let outer = outers[0] ?? null
  extra.push(...dresses.slice(1), ...outers.slice(1), ...shoes.slice(1))
  let top: HousePiece | null = null, bottom: HousePiece | null = null
  if (dress) {
    // A top with a dress is worn over it (a cardigan filed as a top).
    const t = [...tops]
    if (!outer && t.length) outer = t.shift()!
    extra.push(...t, ...bottoms)
  } else {
    const t = [...tops]
    top = t.shift() ?? null
    if (!outer && t.length) outer = t.shift()!
    bottom = bottoms[0] ?? null
    extra.push(...t, ...bottoms.slice(1))
  }
  const accs = pieces
    .filter((p) => ACC_ORDER.includes(p.type))
    .sort((a, b) => ACC_ORDER.indexOf(a.type) - ACC_ORDER.indexOf(b.type))
  accs.push(...extra)
  const garments = [dress, top, bottom, outer].filter(Boolean).length
  if (!garments && !shoes.length) return { layout: 'GRID', roles: accs.map((p, i) => ({ role: `cell${i}`, piece: p })) }
  const layout = dress ? (outer ? 'DRESS_OUTER' : 'DRESS') : outer ? 'WITH_OUTER' : 'NO_OUTER'
  const roles: { role: string; piece: HousePiece }[] = []
  if (dress) roles.push({ role: 'bottom', piece: dress })
  if (bottom) roles.push({ role: 'bottom', piece: bottom })
  if (top) roles.push({ role: 'top', piece: top })
  if (outer) roles.push({ role: 'outer', piece: outer })
  if (shoes[0]) roles.push({ role: 'shoe', piece: shoes[0] })
  accs.forEach((p, i) => roles.push({ role: `acc${i}`, piece: p }))
  return { layout, roles }
}

/**
 * n cells in an area, in the grid that draws a typical accessory biggest. Bags, shoes and belts
 * are wider than tall (about 1.3 to 1), so a cell is judged by the height such a piece gets in it
 * once its label is under it.
 */
export function gridCells(area: Box, n: number, gap = 16): Box[] {
  const [x0, y0, x1, y1] = area
  let best: { cols: number; rows: number; score: number } | null = null
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const cw = (x1 - x0 - gap * (cols - 1)) / cols, ch = (y1 - y0 - gap * (rows - 1)) / rows
    const score = Math.min(cw / 1.3, ch - LABEL_H)
    if (!best || score > best.score) best = { cols, rows, score }
  }
  const { cols, rows } = best!
  const cw = (x1 - x0 - gap * (cols - 1)) / cols, ch = (y1 - y0 - gap * (rows - 1)) / rows
  const out: Box[] = []
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols)
    // A short last row is centred.
    const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols
    const lead = ((cols - inRow) * (cw + gap)) / 2
    const c = i % cols
    const x = x0 + lead + c * (cw + gap), y = y0 + r * (ch + gap)
    out.push([x, y, x + cw, y + ch])
  }
  return out
}

/** The box (on the 1080 board) for every role. */
export function boxesFor(layout: string, roles: string[]): Record<string, Box> {
  if (layout === 'GRID') {
    const cells = gridCells([40, 30, 1040, 1050], roles.length)
    return Object.fromEntries(roles.map((r, i) => [r, cells[i]]))
  }
  const set = SETS[layout]
  const out: Record<string, Box> = {}
  const accs = roles.filter((r) => r.startsWith('acc'))
  for (const r of roles) if (!r.startsWith('acc') && set[r]) out[r] = set[r]
  if (accs.length <= 2) {
    accs.forEach((r, i) => { out[r] = set[`acc${i}`] })
    return out
  }
  const { area, withShoe } = ACC_AREA[layout]
  const shared = withShoe && out.shoe ? ['shoe', ...accs] : accs
  gridCells(area, shared.length).forEach((cell, i) => { out[shared[i]] = cell })
  return out
}

/**
 * Lay the board out the house way. `measure(text, size)` gives a label's drawn width in board
 * pixels (the browser measures Amalfi Coast; without it an estimate is used). `variant` odd = the
 * mirror image.
 */
export function houseLayout(
  board: { width: number; height: number },
  nodes: CanvasNode[],
  pieces: HousePiece[],
  opts: { variant?: number; measure?: (text: string, size: number) => number } = {},
): HouseResult {
  const measure = opts.measure ?? ((t: string, size: number) => t.length * size * 0.55)
  const mirror = (opts.variant ?? 0) % 2 === 1
  const sx = board.width / 1080, sy = board.height / 1080, k = Math.min(sx, sy)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const movable = pieces.filter((p) => {
    const n = byId.get(p.nodeId) as ClosetItemNode | undefined
    return n && !n.hidden && !n.locked && p.natW > 0 && p.natH > 0
  })
  const { layout, roles } = assignRoles(movable)
  const boxes = boxesFor(layout, roles.map((r) => r.role))
  const toBoard = (b: Box): Box => {
    const [l, t, r, bt] = mirror ? [1080 - b[2], b[1], 1080 - b[0], b[3]] : b
    return [l * sx, t * sy, r * sx, bt * sy]
  }

  // Where each piece is drawn now (centre), so notes can follow the piece they sat beside.
  const drawn = (n: ClosetItemNode, p: HousePiece) => {
    const scale = n.target_height ? n.target_height / p.natH : n.scale
    const w = p.natW * Math.abs(scale), h = p.natH * Math.abs(n.scale_y ?? scale)
    return { x: n.flipped ? n.x - w / 2 : n.x + w / 2, y: n.y + h / 2 }
  }

  const next = new Map<string, CanvasNode>()
  const moved = new Map<string, { dx: number; dy: number }>()
  const spots: { piece: HousePiece; cx: number; bottom: number; width: number }[] = []
  roles.forEach(({ role, piece: p }, z) => {
    const box = boxes[role]
    if (!box) return
    const [x0, y0, x1, y1] = toBoard(box)
    const fit: Box = [x0, y0, x1, y1 - (LABEL_H - 10) * k]
    const [l, t, r, b] = p.content ?? [0, 0, p.natW, p.natH]
    const s = Math.min((fit[2] - fit[0]) / Math.max(1, r - l), (fit[3] - fit[1]) / Math.max(1, b - t))
    const cw = (r - l) * s, ch = (b - t) * s
    const left = fit[0] + (fit[2] - fit[0] - cw) / 2, top = fit[1] + (fit[3] - fit[1] - ch) / 2
    const n = byId.get(p.nodeId) as ClosetItemNode
    const before = drawn(n, p)
    // A flipped piece is drawn leftwards from x, so its visible box starts at x - r*s.
    const x = n.flipped ? left + r * s : left - l * s
    const placed: ClosetItemNode = { ...n, x: round(x), y: round(top - t * s), scale: Math.round(s * 1e5) / 1e5, rotation: 0, z_index: z }
    delete placed.scale_y
    delete placed.target_height
    next.set(n.id, placed)
    const after = drawn(placed, p)
    moved.set(n.id, { dx: after.x - before.x, dy: after.y - before.y })
    spots.push({ piece: p, cx: left + cw / 2, bottom: top + ch, width: x1 - x0 })
  })

  // Text already on the board: a piece's brand is its label; anything else is a note.
  const labelOf = new Map<string, TextNode>()
  const pieceNodes = movable.map((p) => ({ p, n: byId.get(p.nodeId) as ClosetItemNode }))
  for (const n of nodes) {
    if (n.type !== 'text') continue
    const owner = movable.find((p) => p.brand && norm(n.content) === norm(p.brand) && !labelOf.has(p.nodeId))
    if (owner) { labelOf.set(owner.nodeId, n); continue }
    let near: string | null = null, nd = Infinity
    for (const { p, n: pn } of pieceNodes) {
      const c = drawn(pn, p)
      const d = Math.hypot(c.x - (n.x + (n.width ?? 0) / 2), c.y - (n.y + n.font_size / 2))
      if (d < nd) { nd = d; near = pn.id }
    }
    const mv = near ? moved.get(near) : undefined
    if (mv) next.set(n.id, { ...n, x: round(n.x + mv.dx), y: round(n.y + mv.dy) })
  }

  const out: CanvasNode[] = nodes.map((n) => next.get(n.id) ?? n)
  const topZ = Math.max(0, ...out.map((n) => n.z_index)) + 1
  let labelsAdded = 0, labelsMoved = 0
  const unlabeled: string[] = []
  spots.forEach(({ piece, cx, bottom, width }, j) => {
    if (!piece.brand) { unlabeled.push(piece.pieceId); return }
    // One line, Amalfi Coast, centred under the piece. A long brand in a narrow box is set a
    // little smaller rather than wrapped into a stack over the piece below.
    let size = FS * k
    const room = width + 40 * k
    while (size > MIN_FS * k && measure(piece.brand, size) > room) size -= 1
    size = Math.round(size * 10) / 10
    const w = Math.max(width, measure(piece.brand, size) + 12 * k)
    const x = Math.max(4, Math.min(board.width - w - 4, cx - w / 2))
    const at = { x: round(x), y: round(bottom + GAP * k), width: round(w), align: 'center' as const, font_family: LABEL_FONT, font_size: size, rotation: 0, z_index: topZ + j }
    const existing = labelOf.get(piece.nodeId)
    if (existing) {
      const i = out.findIndex((n) => n.id === existing.id)
      out[i] = { ...existing, ...at }
      labelsMoved++
      return
    }
    out.push({ id: `tx_house_${piece.nodeId}`, type: 'text', content: piece.brand, fill: '#000000', ...at } as TextNode)
    labelsAdded++
  })

  return { nodes: out, layout, placed: spots.length, labelsAdded, labelsMoved, unlabeled }
}

const round = (n: number) => Math.round(n * 100) / 100
