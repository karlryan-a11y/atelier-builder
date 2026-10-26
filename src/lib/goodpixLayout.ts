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

/**
 * Which of her pieces does this object show? null = it is not one of hers (a picture).
 *
 * `productId` IS A PIECE ID ON MOST BOARDS. ADR-0132. Note 3 above reads "255 of 698 sampled
 * images were shop products (they carry `productId`)", and that sentence was doing a job it could
 * not do: on the boards behind the Transitions queue, GoodPix puts HER OWN piece id in
 * `productId` and leaves `closetItemId` null. Measured over every pulled look that has a stored
 * arrangement, 2026-09-21: 824 of 1,729 board pictures are her own clothes carrying only a
 * `productId`, and Alicia Hidalgo's Nashville Capsule is all ten of them.
 *
 * The cost of reading it as "not hers" was not cosmetic. Those pictures become anonymous, so the
 * transition filter cannot see them: 101 of her 228 pulled looks answered Restyle with "She no
 * longer owns any piece in this look" while every piece sat in her closet (1 after this change),
 * and 146 looks drew a garment she had transitioned out as an untracked picture — Paige Berndt,
 * 2026-09-21: "these pants that showed up on the canvas ... are not in her closet".
 *
 * A REAL shop product is still a picture, because the id has to be one the CALLER vouched for.
 * `known` holds the board's own pool plus the rows the caller read for THIS CLIENT
 * (lib/goodpixBoard.ts filters by client_id), so an id that is not one of her pieces never
 * resolves here. The order is deliberate: an explicit `closetItemId` wins, then the photo hash,
 * and `productId` is consulted only when neither answered.
 */
function pieceFor(o: GpLayoutObject, byHash: Map<string, string>, known: Set<string>): string | null {
  if (o.closetItemId && known.has(o.closetItemId)) return o.closetItemId
  const h = goodPixPhotoHash(o.src ? unwrapGoodPixUrl(o.src) : null)
  const byPhoto = h ? byHash.get(h) : undefined
  if (byPhoto) return byPhoto
  if (o.productId && known.has(o.productId)) return o.productId
  return o.closetItemId ?? null
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
  boxes: { nodeId: string; pieceId: string; cx: number; cy: number; w: number; h: number; rotation: number; flipped: boolean; srcW: number; srcH: number; drawnSrc: string | null }[]
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
        // The photo GoodPix drew here, unless it drew only a crop of it (then the box is all we know).
        const drawnSrc = o.cropX || o.cropY ? null : (o.mirror ? opts.mirrorUrl(o.mirror) : (o.src ? unwrapGoodPixUrl(o.src) : null))
        boxes.push({ nodeId: node.id, pieceId: piece, cx: ccx * k, cy: ccy * k, w: b.w * k, h: b.h * k, rotation: b.angle, flipped: !!o.flipX, srcW: o.width ?? 0, srcH: o.height ?? 0, drawnSrc: drawnSrc && !drawnSrc.startsWith('data:') ? drawnSrc : null })
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

// ── fitting the photo Atelier has ──────────────────────────────────────────────────────────

/** A photo as the board will load it: natural size, and the box its visible (opaque) part fills. */
export interface PhotoSize {
  width: number
  height: number
  content?: { x: number; y: number; width: number; height: number } | null
}

// The board's own clamp on a target_height scale (LookCanvas.tsx, render/composite.ts).
const MIN_SCALE = 0.03, MAX_SCALE = 3.0
// Same shape as the photo GoodPix drew, within this, means it IS that photo: leave it alone.
const SAME_SHAPE = 0.03

/**
 * EVERY PIECE IN ITS GOODPIX BOX, WHATEVER PHOTO ATELIER HAS FOR IT.
 *
 * Cynthia Dada, 2026-10-21, Chris Cadieux Looks 11 and 24: after she replaced the jeans photo the
 * jeans came in too big, and the Magnanni belt and Tom Ford loafer came in tiny though their photos
 * were never touched. A converted piece only carries the box HEIGHT (`target_height`), and the board
 * sizes whatever photo it loads by height alone. That is right only for GoodPix's own photo. A
 * replaced photo, another crop, or transparent space around the piece comes out the wrong size.
 *
 * So, once the photos are measured (lib/goodpixBoard.ts), a piece whose photo is NOT the shape
 * GoodPix drew has its visible part fitted inside the box (the whole of it, centred) by rewriting
 * x, y and target_height only. The board's sizing rule is unchanged. A piece whose photo is the
 * shape GoodPix drew, or could not be measured, is left exactly as converted.
 *
 * THE BOX IS NOT ALWAYS THE PIECE. The tester on the preview, 2026-10-25, Looks 11 and 24: the new
 * jeans then ran from the shirt down over both loafers, about 30% too tall. GoodPix's own jeans
 * photo had see-through space around the jeans, so its box is bigger than the jeans GoodPix drew.
 * So when the photo GoodPix drew was measured too (`drawn`, keyed by node id), the target is the
 * part of the box its visible piece filled; without it, the whole box as before.
 */
export function fitPiecesToPhotos(canvas: LookCanvasState, boxes: LayoutConversion['boxes'], photos: Map<string, PhotoSize>, drawn?: Map<string, PhotoSize>): LookCanvasState {
  const boxById = new Map(boxes.map((b) => [b.nodeId, b]))
  const nodes = canvas.nodes.map((n) => {
    if (n.type !== 'closet_item' || !n.target_height) return n
    const box = boxById.get(n.id)
    const photo = photos.get(n.id)
    if (!box || !photo || !needsFit(box, photo)) return n
    const c = visiblePart(photo)
    // The box is [0, W] x [0, H] in the node's own frame (turned, and mirrored when flipped): the
    // converter anchors every piece that way. The target is the part of it GoodPix's piece filled.
    const W = box.w, H = n.target_height
    const gp = drawn?.get(n.id)
    const g = gp && gp.width > 0 && gp.height > 0 ? visiblePart(gp) : null
    const t = g
      ? { x: (g.x / gp!.width) * W, y: (g.y / gp!.height) * H, width: (g.width / gp!.width) * W, height: (g.height / gp!.height) * H }
      : { x: 0, y: 0, width: W, height: H }
    // Fit the visible part inside the target, centred.
    const s = Math.min(Math.max(Math.min(t.width / c.width, t.height / c.height), MIN_SCALE), MAX_SCALE)
    const du = t.x + (t.width - c.width * s) / 2 - c.x * s
    const dv = t.y + (t.height - c.height * s) / 2 - c.y * s
    const r = (n.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r)
    const u = n.flipped ? -du : du
    return { ...n, x: n.x + cos * u - sin * dv, y: n.y + sin * u + cos * dv, target_height: s * photo.height }
  })
  return { ...canvas, nodes }
}

/** Will fitPiecesToPhotos move this piece? Only when its photo is not the shape GoodPix drew. */
export function needsFit(box: LayoutConversion['boxes'][number], photo: PhotoSize): boolean {
  if (!(photo.width > 0) || !(photo.height > 0) || !(box.w > 0)) return false
  return !(box.srcW > 0 && box.srcH > 0
    && Math.abs((photo.width / photo.height) / (box.srcW / box.srcH) - 1) <= SAME_SHAPE)
}

function visiblePart(p: PhotoSize): { x: number; y: number; width: number; height: number } {
  return p.content && p.content.width > 0 && p.content.height > 0
    ? p.content : { x: 0, y: 0, width: p.width, height: p.height }
}
