/**
 * A GOODPIX LOOK, LAID OUT THE WAY THE STYLIST LEFT IT — the one place a GoodPix arrangement
 * becomes an Atelier canvas. ADR-0127.
 *
 * Paige Berndt, 2026-09-17: "all the pieces are laid out all over the screen and the brand names
 * are removed. Can we implement something where the original layout stays intact, but the
 * transitioned pieces are removed?" Until now there was nothing to lay out FROM: the scraper read
 * one flat picture and an id list, so 0 of 15,065 GoodPix looks had an arrangement and every
 * Restyle or Rebuild in canvas was a grid (lib/rebuildLookCanvas.ts). GoodPix keeps the
 * arrangement as a Fabric.js canvas behind its board editor; goodpix-scraper resync_layouts.py
 * (and the dashboard's Sync from GoodPix) copy it, untranslated, into gp_looks.gp_layout. This
 * file translates it. Keeping the translation HERE, not in the copiers, means a mistake in it is
 * corrected by a deploy rather than by refetching fifteen thousand boards.
 *
 * THREE THINGS THAT LOOK ARBITRARY AND ARE MEASURED:
 *
 * 1. THE COORDINATE SPACE is not the canvas size GoodPix reports. Objects sit in a 1080-wide space
 *    for a square board and 1200x1600 / 1600x1200 for portrait / landscape, while the reported size
 *    is 1x, 1.5x or 2x that. Found by redrawing 30 boards at each candidate scale and comparing the
 *    result with GoodPix's own baked picture: the right scale matched to a mean grey error of 1-9
 *    (of 255), the wrong ones 20-100. When GoodPix records the v1 size (`v1_primary`) it is the
 *    space; when it does not, the long side is 1080 for a square board and 1600 otherwise.
 *    Those are exactly our BOARD_PRESETS, so a converted look opens on a stock board at scale 1.
 *
 * 2. A PIECE IS RECOGNISED BY ITS PICTURE, not by an id. Only some objects carry `closetItemId`;
 *    the rest are recognised by the 32-hex hash in the GoodPix image filename, which is shared by
 *    every size GoodPix makes of that photo (processed-original / -large, compressed-...). On 120
 *    sampled boards this recognised 434 of 442 of the client's own pieces; the 8 misses are
 *    pieces whose photo was replaced after the look was made. The callers pass the photos Atelier
 *    has on record as well, which catches some of those.
 *
 * 3. ABOUT A THIRD OF THE PICTURES ON A GOODPIX LOOK ARE NOT HER PIECES at all: 255 of 698 on the
 *    sample were shop products (they carry `productId`). Karl, 2026-09-18: bring them across as
 *    plain pictures. So anything not recognised as one of her pieces becomes a `picture` node —
 *    it looks the same, it moves and resizes, and it is never mistaken for something she owns.
 */
import type { LookCanvasState, CanvasNode, ClosetItemNode, TextNode, PictureNode } from '@/types/canvas'

export interface GpLayoutObject {
  type?: string
  left?: number
  top?: number
  width?: number
  height?: number
  scaleX?: number
  scaleY?: number
  angle?: number
  flipX?: boolean
  flipY?: boolean
  originX?: string
  originY?: string
  cropX?: number
  cropY?: number
  opacity?: number
  visible?: boolean
  src?: string | null
  /** R2 key the copier put a picture under when it could not be loaded from where GoodPix keeps it. */
  mirror?: string
  closetItemId?: string
  productId?: string
  text?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: string | number
  fontStyle?: string
  underline?: boolean
  fill?: string | null
  textAlign?: string
}

export interface GpLayout {
  v: number
  board_id?: string
  board_updated_at?: string
  canvas?: { width?: number; height?: number; background?: string | null }
  v1_primary?: { width?: number; height?: number } | null
  preview_url?: string | null
  objects?: GpLayoutObject[]
  pool?: { id: string; urls: string[] }[]
}

// ── recognising images ─────────────────────────────────────────────────────────────────────

const GP_HASH = /(?:processed|compressed)-(?:original|large|medium|small)-([0-9a-f]{32})/

/** GoodPix wraps an S3 url in its own proxies (`...?url=<s3>`). The S3 url is what we load. */
export function unwrapGoodPixUrl(src: string): string {
  const m = src.match(/[?&]url=([^&]+)/)
  if (!m) return src
  try { return decodeURIComponent(m[1]) } catch { return src }
}

export function goodPixPhotoHash(url: string | null | undefined): string | null {
  if (!url) return null
  let u = url
  try { u = decodeURIComponent(url) } catch { /* keep as is */ }
  return u.match(GP_HASH)?.[1] ?? null
}

function photoIndex(layout: GpLayout, extraUrls?: Map<string, string[]>): Map<string, string> {
  const byHash = new Map<string, string>()
  const add = (id: string, urls: (string | null | undefined)[]) => {
    for (const u of urls) {
      const h = goodPixPhotoHash(u)
      if (h && !byHash.has(h)) byHash.set(h, id)
    }
  }
  for (const p of layout.pool ?? []) add(p.id, p.urls ?? [])
  for (const [id, urls] of extraUrls ?? new Map()) add(id, urls)
  return byHash
}

function isImage(o: GpLayoutObject) { return (o.type ?? '').toLowerCase() === 'image' }
function isText(o: GpLayoutObject) {
  const t = (o.type ?? '').toLowerCase()
  return t === 'textbox' || t === 'i-text' || t === 'text'
}

/** Which of her pieces does this object show? null = it is not one of hers (a picture). */
function pieceFor(o: GpLayoutObject, byHash: Map<string, string>, known: Set<string>): string | null {
  if (o.closetItemId && known.has(o.closetItemId)) return o.closetItemId
  const h = goodPixPhotoHash(o.src ? unwrapGoodPixUrl(o.src) : null)
  return (h && byHash.get(h)) || (o.closetItemId ?? null)
}

/**
 * Every piece of hers the layout actually SHOWS. Callers use this to ask the database which of
 * them she still owns before converting — the layout is the truth about what is in the picture,
 * `closet_item_ids` is only the board's pool (Alicia Hidalgo Look 93: 10 in the pool, 7 in the
 * picture, and the piece recorded as pulling it not in the picture at all).
 */
export function piecesInLayout(layout: GpLayout, extraUrls?: Map<string, string[]>): string[] {
  const byHash = photoIndex(layout, extraUrls)
  const known = new Set([...(layout.pool ?? []).map((p) => p.id), ...(extraUrls?.keys() ?? [])])
  const out: string[] = []
  for (const o of layout.objects ?? []) {
    if (!isImage(o) || o.visible === false) continue
    const id = pieceFor(o, byHash, known)
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

// ── geometry ───────────────────────────────────────────────────────────────────────────────

/** The space GoodPix's object coordinates live in. See note 1 at the top. */
export function layoutSpace(layout: GpLayout): { width: number; height: number } {
  const cw = layout.canvas?.width || 1080
  const ch = layout.canvas?.height || cw
  const v1 = layout.v1_primary
  if (v1?.width) return { width: v1.width, height: v1.height || (v1.width * ch) / cw }
  const target = cw === ch ? 1080 : 1600
  const div = Math.max(cw, ch) / target
  return { width: cw / div, height: ch / div }
}

const ORIGIN: Record<string, number> = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 }

interface Box { tlx: number; tly: number; w: number; h: number; angle: number; cos: number; sin: number }

/** An object's unrotated box and its top-left corner, in layout units, whatever its origin. */
function boxOf(o: GpLayoutObject): Box {
  const w = (o.width ?? 0) * Math.abs(o.scaleX ?? 1)
  const h = (o.height ?? 0) * Math.abs(o.scaleY ?? 1)
  const angle = o.angle ?? 0
  const r = (angle * Math.PI) / 180
  const cos = Math.cos(r), sin = Math.sin(r)
  const ox = (ORIGIN[o.originX ?? 'left'] ?? 0) * w
  const oy = (ORIGIN[o.originY ?? 'top'] ?? 0) * h
  // Fabric rotates about the origin point, so the top-left corner is the origin minus R*(ox,oy).
  return { tlx: (o.left ?? 0) - (cos * ox - sin * oy), tly: (o.top ?? 0) - (sin * ox + cos * oy), w, h, angle, cos, sin }
}

/** A point in the object's unrotated box (dx, dy), carried through its rotation, in layout units. */
function at(b: Box, dx: number, dy: number): [number, number] {
  return [b.tlx + b.cos * dx - b.sin * dy, b.tly + b.sin * dx + b.cos * dy]
}

const FONT_BY_NAME: Record<string, string> = {
  'amalfi coast': "'Amalfi Coast', cursive",
  'great vibes': "'Great Vibes', cursive",
  'playfair display': "'Playfair Display', serif",
  'playfair display sc': "'Playfair Display SC', serif",
  'schnyder': "'Schnyder', Georgia, serif",
  'neue haas': "'Neue Haas', 'Helvetica Neue', Arial, sans-serif",
}

export function fontFor(name: string | undefined): string {
  if (!name) return "'Amalfi Coast', cursive"
  const clean = name.replace(/['"]/g, '').split(',')[0].trim()
  return FONT_BY_NAME[clean.toLowerCase()] ?? `'${clean}', ${/script|hand|vibes|coast/i.test(clean) ? 'cursive' : 'sans-serif'}`
}

// ── conversion ─────────────────────────────────────────────────────────────────────────────

export interface LayoutConversion {
  canvas: LookCanvasState
  /** Her pieces placed where they were. */
  placed: string[]
  /** Her pieces that were IN the picture and were left off because `keep` refused them. */
  leftOff: string[]
  /** Shop products and other pictures carried across as plain pictures. */
  pictures: number
  /** Handwritten notes and labels carried across as text. */
  texts: number
  /** Objects we could not carry (shapes, lines, invisible objects, a picture with no source). */
  skipped: number
  /**
   * Each placed piece's box on the board as GoodPix drew it: centre, size (unrotated), angle.
   * The Style button learns arrangements from these (lib/styleFromTemplates.ts); the node itself
   * cannot say its width, because that depends on which photo of the piece Atelier loads.
   */
  boxes: { nodeId: string; pieceId: string; cx: number; cy: number; w: number; h: number; rotation: number; flipped: boolean }[]
}

export interface ConvertOptions {
  /** Is this piece still hers? Pieces the layout shows that fail this are left off the board. */
  keep: (closetItemId: string) => boolean
  /** Photos Atelier holds for pieces, to recognise a photo GoodPix no longer lists on the pool. */
  extraUrls?: Map<string, string[]>
  /** Turn an R2 key into a loadable url (the image proxy). */
  mirrorUrl: (key: string) => string
  /** Build ids deterministic per look, so a re-open does not churn node identity. */
  idPrefix?: string
}

export function convertGoodPixLayout(layout: GpLayout, opts: ConvertOptions): LayoutConversion {
  const space = layoutSpace(layout)
  const square = Math.abs(space.width - space.height) < 1
  // Scale the layout onto the matching stock board: long side 1080 (square) or 1600.
  const k = (square ? 1080 : 1600) / Math.max(space.width, space.height)
  const bg = typeof layout.canvas?.background === 'string' && layout.canvas.background ? layout.canvas.background : '#ffffff'
  const canvas: LookCanvasState = {
    version: 1,
    canvas: { width: Math.round(space.width * k), height: Math.round(space.height * k), background: bg },
    nodes: [],
  }
  const byHash = photoIndex(layout, opts.extraUrls)
  const known = new Set([...(layout.pool ?? []).map((p) => p.id), ...(opts.extraUrls?.keys() ?? [])])
  const prefix = opts.idPrefix ?? 'gp'
  const placed: string[] = []
  const leftOff: string[] = []
  let pictures = 0, texts = 0, skipped = 0
  const nodes: CanvasNode[] = []
  const boxes: LayoutConversion['boxes'] = []

  ;(layout.objects ?? []).forEach((o, i) => {
    if (o.visible === false) { skipped++; return }
    const z = i
    const b = boxOf(o)

    if (isImage(o)) {
      const piece = pieceFor(o, byHash, known)
      if (piece) {
        if (!opts.keep(piece)) { if (!leftOff.includes(piece)) leftOff.push(piece); return }
        // Konva mirrors a negative scaleX about the node's own x, so a flipped piece is anchored
        // on the right edge of its box (the convention the builder's own flip already uses).
        // Konva has no vertical mirror on a piece, so flipY = mirror horizontally + turn 180.
        const fx = !!o.flipX, fy = !!o.flipY
        const flipped = fy ? !fx : fx
        const [ax, ay] = at(b, fx ? b.w : 0, fy ? b.h : 0)
        const node: ClosetItemNode = {
          id: `${prefix}_ci_${i}_${piece.slice(-8)}`,
          type: 'closet_item',
          closet_item_id: piece,
          x: ax * k,
          y: ay * k,
          scale: 1,
          target_height: b.h * k,
          rotation: fy ? b.angle + 180 : b.angle,
          flipped,
          z_index: z,
          locked: false,
        }
        nodes.push(node)
        const [ccx, ccy] = at(b, b.w / 2, b.h / 2)
        boxes.push({ nodeId: node.id, pieceId: piece, cx: ccx * k, cy: ccy * k, w: b.w * k, h: b.h * k, rotation: b.angle, flipped: !!o.flipX })
        if (!placed.includes(piece)) placed.push(piece)
        return
      }
      const src = o.mirror ? opts.mirrorUrl(o.mirror) : (o.src ? unwrapGoodPixUrl(o.src) : null)
      if (!src || src.startsWith('data:')) { skipped++; return }
      const pic: PictureNode = {
        id: `${prefix}_pic_${i}`,
        type: 'picture',
        src,
        x: b.tlx * k,
        y: b.tly * k,
        width: b.w * k,
        height: b.h * k,
        rotation: b.angle,
        flipped: !!o.flipX,
        flipped_y: !!o.flipY,
        z_index: z,
        locked: false,
        product_id: o.productId ?? null,
      }
      nodes.push(pic)
      pictures++
      return
    }

    if (isText(o) && (o.text ?? '').trim()) {
      const sy = Math.abs(o.scaleY ?? 1), sx = Math.abs(o.scaleX ?? 1)
      const align = o.textAlign === 'center' || o.textAlign === 'right' ? o.textAlign : 'left'
      const node: TextNode = {
        id: `${prefix}_tx_${i}`,
        type: 'text',
        content: o.text ?? '',
        font_family: fontFor(o.fontFamily),
        font_size: Math.max(6, (o.fontSize ?? 40) * sy * k),
        fill: typeof o.fill === 'string' && o.fill ? o.fill : '#1A1A1A',
        x: b.tlx * k,
        y: b.tly * k,
        rotation: b.angle,
        z_index: z,
        width: (o.width ?? 0) * sx * k || undefined,
        align,
        bold: o.fontWeight === 'bold' || Number(o.fontWeight) >= 600 || undefined,
        underline: o.underline || undefined,
      }
      nodes.push(node)
      texts++
      return
    }

    skipped++   // Rect, Path, Group, an empty text box: nothing an Atelier board can draw yet
  })

  canvas.nodes = nodes
  return { canvas, placed, leftOff, pictures, texts, skipped, boxes }
}
