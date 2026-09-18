/**
 * THE STYLE BUTTON, LEARNED FROM REAL LOOKS — the one place an arrangement is chosen and applied.
 * ADR-0128.
 *
 * Karl, 2026-09-18: "the purpose of the magic button is to auto organize the text and items into a
 * styled look ... use the grid data from goodpix and analyze it to be able to think about where to
 * put everything based on past styled looks." And: "we don't want it to wipe." And, on labels:
 * "only brands we're sure of."
 *
 * Until now ✨ placed each piece at a fixed spot per category taken from three reference looks,
 * wrote a brand label for every piece that had a brand, and cleared the board first — so on a look
 * rebuilt from GoodPix it erased the stylist's handwriting and the shop pictures ADR-0127 had just
 * brought back.
 *
 * NOW: the pieces on the board are reduced to their MIX (e.g. bottom+outerwear+shoes+shoes+top),
 * and ✨ copies the arrangement of a real look the team already styled with that exact mix — her
 * own looks first. Measured on the 14,835 GoodPix layouts (2026-09-18): 75% of looks have an exact
 * mix styled at least 5 other times, 96% the same set of piece types, and for about half the same
 * client has styled that exact mix before. Copying one real, coherent arrangement beats averaging
 * many: an average of good looks is not a good look.
 *
 * RULES THIS FILE KEEPS:
 *   - Nothing is deleted. Text she typed and pictures stay. A note travels with the piece it sat
 *     beside, so "optional cardigan if needed" is still next to the cardigan afterwards.
 *   - A brand label is written only from a brand saved on the piece ("sure"), only where the
 *     stylist of the template look put a label for that piece, and never twice: an existing text
 *     that already says the brand is moved there instead.
 *   - Deterministic: the same board and the same library give the same answer, and pressing again
 *     steps to the next-best look.
 *
 * Pure: no database, no DOM. The button (lib/style.ts) fetches, this decides, the scorecard
 * (scripts/check-style-templates.mjs) grades the same code against held-out real looks.
 */
import { resolveCategory } from './categorize.ts'   // .ts: node scripts import this file
import type { CanvasNode, ClosetItemNode, TextNode } from '@/types/canvas'

export type PieceType =
  | 'dress' | 'top' | 'bottom' | 'outerwear' | 'shoes' | 'bag' | 'jewelry'
  | 'belt' | 'scarf' | 'hat' | 'accessory' | 'other'

const FROM_CATEGORY: Record<string, PieceType> = {
  dresses: 'dress', tops: 'top', skirts: 'bottom', pants: 'bottom', jeans: 'bottom', shorts: 'bottom',
  outerwear: 'outerwear', swim: 'top', activewear: 'top', shoes: 'shoes', bags: 'bag',
  jewelry: 'jewelry', belts: 'belt', scarves: 'scarf', hats: 'hat', sunglasses: 'accessory', other: 'other',
}

// Saved categories that are not the builder's own slugs but plainly mean one (GoodPix-era and
// custom spellings seen on real pieces, 2026-09-18). Anything else falls through to the name.
const CATEGORY_ALIAS: Record<string, string> = {
  handbags: 'bags', handbag: 'bags', bag: 'bags', purse: 'bags', clutch: 'bags',
  eyewear: 'sunglasses', glasses: 'sunglasses',
  jackets: 'outerwear', jacket: 'outerwear', blazers: 'outerwear', blazer: 'outerwear', coats: 'outerwear', coat: 'outerwear', cardigans: 'outerwear',
  jumpsuits: 'dresses', jumpsuit: 'dresses', dress: 'dresses',
  sweater: 'tops', sweaters: 'tops', sweatshirts: 'tops', bodysuits: 'tops', top: 'tops',
  pant: 'pants', trousers: 'pants', denim: 'jeans', skirt: 'skirts', short: 'shorts',
  shoe: 'shoes', boots: 'shoes', heels: 'shoes', sneakers: 'shoes',
  earrings: 'jewelry', necklaces: 'jewelry', bracelets: 'jewelry', belt: 'belts', scarf: 'scarves', hat: 'hats',
}

/** A piece's type for arranging: the category the stylist saved wins, else the name is read. */
export function pieceType(name: string | null | undefined, category: string | null | undefined): PieceType {
  const saved = (category ?? '').toLowerCase().trim()
  const cat = CATEGORY_ALIAS[saved] ?? saved
  return FROM_CATEGORY[resolveCategory({ name: name ?? '', category: cat || null }, [])] ?? 'other'
}

/** The mix, with multiplicity: two pairs of shoes is not one. */
export function mixKey(types: PieceType[]): string { return [...types].sort().join('+') }
/** The set of types, ignoring how many of each: the fallback match. */
export function typesKey(types: PieceType[]): string { return [...new Set(types)].sort().join('+') }

export interface TemplateSlot {
  type: PieceType
  /** Centre and size on the template's board, in board pixels. */
  cx: number; cy: number; w: number; h: number
  rotation: number
  flipped: boolean
  z: number
}
export interface TemplateLabel {
  /** The slot this text sat beside (the nearest piece). */
  slot: number
  /** Top-left of the text relative to that slot's centre, in board pixels. */
  dx: number; dy: number
  font_family: string
  font_size: number
  fill: string
  width?: number
  align?: 'left' | 'center' | 'right'
  rotation: number
}
export interface LookTemplate {
  look_id: string
  look_name: string | null
  client_id: string
  board_id: string | null
  mix_key: string
  types_key: string
  board_w: number
  board_h: number
  slots: TemplateSlot[]
  labels: TemplateLabel[]
}

// ── building a template from a converted GoodPix look ─────────────────────────────────────────

interface ConvLike {
  canvas: { canvas: { width: number; height: number }; nodes: CanvasNode[] }
  boxes: { nodeId: string; pieceId: string; cx: number; cy: number; w: number; h: number; rotation: number; flipped: boolean }[]
}

export function templateFromConversion(
  conv: ConvLike,
  typeOf: (pieceId: string) => PieceType,
  meta: { look_id: string; look_name: string | null; client_id: string; board_id: string | null },
): LookTemplate | null {
  if (!conv.boxes.length) return null
  const zOf = new Map(conv.canvas.nodes.map((n) => [n.id, n.z_index]))
  const slots: TemplateSlot[] = conv.boxes.map((b) => ({
    type: typeOf(b.pieceId), cx: b.cx, cy: b.cy, w: b.w, h: b.h,
    rotation: b.rotation, flipped: b.flipped, z: zOf.get(b.nodeId) ?? 0,
  }))
  // Each text box belongs to the piece nearest its centre; each piece keeps at most one (the
  // nearest), which is its label. The rest are notes — they are not copied onto new looks.
  const best = new Map<number, { d: number; label: TemplateLabel }>()
  for (const n of conv.canvas.nodes) {
    if (n.type !== 'text' || !n.content.trim()) continue
    const tw = n.width ?? n.font_size * Math.max(3, n.content.length * 0.5)
    const tcx = n.x + tw / 2, tcy = n.y + n.font_size / 2
    let si = -1, sd = Infinity
    slots.forEach((s, i) => { const d = Math.hypot(s.cx - tcx, s.cy - tcy); if (d < sd) { sd = d; si = i } })
    if (si < 0) continue
    const label: TemplateLabel = {
      slot: si, dx: n.x - slots[si].cx, dy: n.y - slots[si].cy,
      font_family: n.font_family, font_size: n.font_size, fill: n.fill,
      width: n.width, align: n.align, rotation: n.rotation,
    }
    const prev = best.get(si)
    if (!prev || sd < prev.d) best.set(si, { d: sd, label })
  }
  const types = slots.map((s) => s.type)
  return {
    ...meta,
    mix_key: mixKey(types),
    types_key: typesKey(types),
    board_w: conv.canvas.canvas.width,
    board_h: conv.canvas.canvas.height,
    slots,
    labels: [...best.values()].map((v) => v.label),
  }
}

// ── choosing ───────────────────────────────────────────────────────────────────────────────────

/**
 * Best first: the exact mix before the same set of types, her own looks before anyone's, a board
 * of the same shape before one that must be letterboxed, then a stable order so "press again"
 * walks a fixed list.
 */
export function rankTemplates(
  types: PieceType[],
  candidates: LookTemplate[],
  opts: { clientId?: string | null; board: { width: number; height: number }; exclude?: (t: LookTemplate) => boolean },
): LookTemplate[] {
  const mk = mixKey(types), tk = typesKey(types)
  const aspect = opts.board.width / opts.board.height
  const score = (t: LookTemplate) =>
    (t.mix_key === mk ? 0 : t.types_key === tk ? 100 : 1000)
    + (opts.clientId && t.client_id === opts.clientId ? 0 : 10)
    + (Math.abs(t.board_w / t.board_h - aspect) < 0.05 ? 0 : 1)
  // One template per GoodPix board: duplicate looks on a board are the same arrangement.
  const seen = new Set<string>()
  const pool = candidates
    .filter((t) => !(opts.exclude?.(t)))
    .filter((t) => t.mix_key === mk || t.types_key === tk)
  // Within a tier, the most TYPICAL arrangement of this mix first: the one whose pieces sit
  // closest to where the team usually puts them. The first-by-id look was an arbitrary pick.
  const typ = typicality(pool.filter((t) => t.mix_key === mk))
  return pool
    .sort((a, b) => score(a) - score(b) || (typ.get(a.look_id) ?? 9) - (typ.get(b.look_id) ?? 9) || a.look_id.localeCompare(b.look_id))
    .filter((t) => { const k = t.board_id || t.look_id; if (seen.has(k)) return false; seen.add(k); return true })
}

/**
 * How far each look's pieces sit from the usual spot for that mix (lower = more typical). Pieces
 * are compared type by type, left to right, in board fractions so square and portrait boards mix.
 */
function typicality(group: LookTemplate[]): Map<string, number> {
  const out = new Map<string, number>()
  if (group.length < 3) return out
  const norm = (t: LookTemplate) => {
    const bytype = new Map<string, { x: number; y: number }[]>()
    for (const sl of t.slots) bytype.set(sl.type, [...(bytype.get(sl.type) ?? []), { x: sl.cx / t.board_w, y: sl.cy / t.board_h }])
    for (const v of bytype.values()) v.sort((a, b) => a.x - b.x)
    return bytype
  }
  const all = group.map((t) => ({ t, p: norm(t) }))
  const med = (v: number[]) => { const b = [...v].sort((x, y) => x - y); return b[Math.floor(b.length / 2)] }
  const centre = new Map<string, { x: number; y: number }[]>()
  for (const [type, pts] of all[0].p) {
    centre.set(type, pts.map((_, i) => ({
      x: med(all.map((a) => a.p.get(type)?.[i]?.x ?? 0.5)),
      y: med(all.map((a) => a.p.get(type)?.[i]?.y ?? 0.5)),
    })))
  }
  for (const { t, p } of all) {
    let d = 0
    for (const [type, pts] of p) pts.forEach((q, i) => { const c = centre.get(type)?.[i]; if (c) d += Math.hypot(q.x - c.x, q.y - c.y) })
    out.set(t.look_id, d)
  }
  return out
}

// ── applying ───────────────────────────────────────────────────────────────────────────────────

export interface BoardPiece {
  nodeId: string
  pieceId: string
  type: PieceType
  /** A brand saved on the piece. Null when we are not sure, and then no label is written. */
  brand: string | null
}

export interface Arrangement {
  nodes: CanvasNode[]
  /** Pieces moved onto a slot of the template. */
  placed: number
  /** Pieces the template had no slot for; left exactly where they were. */
  unplaced: number
  labelsAdded: number
  labelsMoved: number
  notesMoved: number
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

interface Rect { x: number; y: number; w: number; h: number }
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * Lay the board out like `tpl`. `displayOf(nodeId)` gives a piece's current drawn size (from the
 * loaded photo) so it can be centred on its slot and so notes can find the piece they sat beside;
 * without it the template's own slot size is used.
 */
export function arrangeFromTemplate(
  board: { width: number; height: number },
  nodes: CanvasNode[],
  pieces: BoardPiece[],
  tpl: LookTemplate,
  displayOf?: (nodeId: string) => { w: number; h: number } | null,
): Arrangement {
  const s = Math.min(board.width / tpl.board_w, board.height / tpl.board_h)
  const ox = (board.width - tpl.board_w * s) / 2
  const oy = (board.height - tpl.board_h * s) / 2
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const sizeOf = (n: ClosetItemNode, fallback?: TemplateSlot) => {
    const d = displayOf?.(n.id)
    if (d && d.h > 0) return d
    const h = n.target_height ?? fallback?.h ?? 200
    return { w: fallback ? (fallback.w / fallback.h) * h : h * 0.75, h }
  }
  const centreOf = (n: ClosetItemNode) => {
    const { w, h } = sizeOf(n)
    return { x: n.flipped ? n.x - w / 2 : n.x + w / 2, y: n.y + h / 2 }
  }

  // 1. Assign pieces to slots type by type, left to right, so a stylist's left/right intent holds.
  const assignment = new Map<string, number>()   // nodeId -> slot index
  const types = [...new Set(pieces.map((p) => p.type))]
  for (const type of types) {
    const ps = pieces.filter((p) => p.type === type)
      .sort((a, b) => centreOf(byId.get(a.nodeId) as ClosetItemNode).x - centreOf(byId.get(b.nodeId) as ClosetItemNode).x)
    const ss = tpl.slots.map((sl, i) => ({ sl, i })).filter((x) => x.sl.type === type).sort((a, b) => a.sl.cx - b.sl.cx)
    ps.forEach((p, i) => { if (ss[i]) assignment.set(p.nodeId, ss[i].i) })
  }

  // 2. Move each assigned piece; remember how far it moved, for the notes that belong to it.
  const moved = new Map<string, { dx: number; dy: number }>()
  const next = new Map<string, CanvasNode>()
  const pieceBox = new Map<string, Rect>()   // nodeId -> where the piece now sits
  for (const p of pieces) {
    const n = byId.get(p.nodeId) as ClosetItemNode | undefined
    const si = assignment.get(p.nodeId)
    if (!n || si == null) continue
    const sl = tpl.slots[si]
    const before = centreOf(n)
    const h = sl.h * s
    const nat = sizeOf(n, sl)
    const w = (nat.w / nat.h) * h
    const cx = ox + sl.cx * s, cy = oy + sl.cy * s
    const r = (sl.rotation * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r)
    // top-left (or right edge when flipped) = centre - R*(±w/2, h/2)
    const ax = sl.flipped ? w / 2 : -w / 2, ay = -h / 2
    next.set(n.id, {
      ...n,
      x: cx + (c * ax - sn * ay),
      y: cy + (sn * ax + c * ay),
      target_height: h,
      scale: 1,
      scale_y: undefined,
      rotation: sl.rotation,
      flipped: sl.flipped,
      z_index: sl.z,
    })
    moved.set(n.id, { dx: cx - before.x, dy: cy - before.y })
    pieceBox.set(n.id, { x: cx - w / 2, y: cy - h / 2, w, h })
  }

  // 3. Text already on the board. A text that says a piece's brand is that piece's label; any
  //    other text is a note and travels with the piece it sits nearest to.
  const pieceNodes = pieces.map((p) => byId.get(p.nodeId) as ClosetItemNode).filter(Boolean)
  const brandLabelFor = new Map<string, TextNode>()   // nodeId of piece -> its existing label
  let notesMoved = 0
  for (const n of nodes) {
    if (n.type !== 'text') continue
    const owner = pieces.find((p) => p.brand && norm(n.content) === norm(p.brand))
    if (owner && !brandLabelFor.has(owner.nodeId)) { brandLabelFor.set(owner.nodeId, n); continue }
    let near: ClosetItemNode | null = null, nd = Infinity
    for (const pn of pieceNodes) {
      const c = centreOf(pn)
      const d = Math.hypot(c.x - (n.x + (n.width ?? 0) / 2), c.y - (n.y + n.font_size / 2))
      if (d < nd) { nd = d; near = pn }
    }
    const mv = near ? moved.get(near.id) : undefined
    if (mv) { next.set(n.id, { ...n, x: n.x + mv.dx, y: n.y + mv.dy }); notesMoved++ }
  }

  // 4. Labels, only where the template's stylist put one, only for a brand we are sure of.
  const out: CanvasNode[] = nodes.map((n) => next.get(n.id) ?? n)
  let labelsAdded = 0, labelsMoved = 0
  // Label spots taken so far, so two labels never land on each other (two brands on two pairs of
  // shoes did, 2026-09-18) and a label does not sit on top of a piece when a clear spot exists.
  const taken: Rect[] = []
  const place = (want: { x: number; y: number }, box: { w: number; h: number }, own: Rect | undefined) => {
    const inside = (r: Rect) => r.x >= 4 && r.y >= 4 && r.x + r.w <= board.width - 4 && r.y + r.h <= board.height - 4
    const clamp = (p: { x: number; y: number }) => ({
      x: Math.max(4, Math.min(p.x, board.width - box.w - 4)), y: Math.max(4, Math.min(p.y, board.height - box.h - 4)),
    })
    const tries = [want]
    if (own) tries.push(
      { x: own.x + own.w / 2 - box.w / 2, y: own.y + own.h + 6 },          // under its piece
      { x: own.x + own.w / 2 - box.w / 2, y: own.y - box.h - 6 },          // over it
      { x: own.x - box.w - 8, y: own.y + own.h / 2 - box.h / 2 },          // to its left
      { x: own.x + own.w + 8, y: own.y + own.h / 2 - box.h / 2 },          // to its right
    )
    // Label on label: never. Label on a piece: allowed. Stylists write inside a piece's box all the
    // time (it includes the photo's empty margin); penalising that moved labels from 5.9% to 9.1%
    // of the board away from where stylists put them, measured on 400 held-out looks.
    const cost = (r: Rect) => (taken.some((t) => overlap(t, r) > 0) ? 1e9 : 0) + (inside(r) ? 0 : 1e6)
    let best: Rect | null = null, bc = Infinity
    for (const t of tries) {
      const p = clamp(t), r = { x: p.x, y: p.y, w: box.w, h: box.h }
      const c = cost(r)
      if (c < bc) { bc = c; best = r }
      if (c === 0) break
    }
    taken.push(best!)
    return best!
  }
  const topZ = Math.max(0, ...out.map((n) => n.z_index)) + 1
  for (const [nodeId, si] of assignment) {
    const piece = pieces.find((p) => p.nodeId === nodeId)
    const label = tpl.labels.find((l) => l.slot === si)
    if (!piece?.brand || !label) continue
    const sl = tpl.slots[si]
    const want = { x: ox + (sl.cx + label.dx) * s, y: oy + (sl.cy + label.dy) * s }
    const existing = brandLabelFor.get(nodeId)
    // One line: the template's box width fitted HER label ("Vince"), so reusing it wrapped a
    // longer brand ("MICHAEL Michael Kors") into a tall stack over the piece.
    const size = existing ? existing.font_size : Math.max(8, label.font_size * s)
    const spot = place(want, { w: size * 0.5 * piece.brand.length, h: size * 1.3 }, pieceBox.get(nodeId))
    if (existing) {
      const i = out.findIndex((n) => n.id === existing.id)
      out[i] = { ...existing, x: spot.x, y: spot.y }
      labelsMoved++
      continue
    }
    out.push({
      id: `tx_style_${nodeId}_${si}`,
      type: 'text',
      content: piece.brand,
      font_family: label.font_family,
      font_size: size,
      fill: label.fill || '#1A1A1A',
      x: spot.x,
      y: spot.y,
      rotation: label.rotation ?? 0,
      z_index: topZ + labelsAdded,
    } as TextNode)
    labelsAdded++
  }

  return { nodes: out, placed: assignment.size, unplaced: pieces.length - assignment.size, labelsAdded, labelsMoved, notesMoved }
}
