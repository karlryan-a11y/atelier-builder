import { supabase } from '@/lib/supabase'
import type { LookCanvasState } from '@/types/canvas'
import { buildCanvasFromClosetItems } from '@/lib/rebuildLookCanvas'
import { fitPiecesToPhotos, needsFit, type GpLayout, type PhotoSize } from '@/lib/goodpixLayout'
import { selectRestylePieces, type OmittedPiece } from '@/lib/restyleSelection'
import { planGoodPixBoard, boardCandidateIds, type BoardPiece } from '@/lib/restyleBoard'
import { storedProxyUrl } from '@/lib/imageUrls'
import { resolveClosetImageUrls } from '@/lib/resolveClosetImageUrls'
import { measurePhoto } from '@/lib/photoContent'

/**
 * THE BOARD A GOODPIX LOOK OPENS ON — for Restyle (a pulled look) and Rebuild in canvas alike, so
 * the two cannot drift. ADR-0127.
 *
 * With a stored layout (gp_looks.gp_layout, copied from GoodPix's own editor) the look opens the
 * way the stylist left it: every piece in its place, the handwriting as text, shop products as
 * plain pictures, and ONLY the pieces she no longer owns missing. The pieces that decide the
 * board are the ones IN THE PICTURE — not `closet_item_ids`, which is the GoodPix board's pool
 * and routinely lists pieces the stylist tried and took out (Alicia Hidalgo Look 93: ten in the
 * pool, seven in the picture). Pool pieces that are not in the picture are named, not placed.
 *
 * Without a layout (not copied yet, or GoodPix had none) it falls back to the grid, exactly as
 * before, and says so.
 */
export interface GoodPixBoard {
  canvas: LookCanvasState
  /** node id -> photo url for the canvas, resolved the way every board does (resolveClosetImageUrls). */
  imageUrls: Record<string, string>
  /** Pieces that were in the look and are left off because she no longer has them. */
  omitted: OmittedPiece[]
  /** Pieces GoodPix listed for the look that are NOT in its picture: not placed, only named. */
  notInPicture: OmittedPiece[]
  /** True when the board came from the stored arrangement, false for the grid fallback. */
  fromLayout: boolean
  pictures: number
  texts: number
}

const mirrorUrl = (key: string) => storedProxyUrl(key)

async function readPieces(ids: string[], clientId: string | null) {
  const out = new Map<string, BoardPiece>()
  for (let i = 0; i < ids.length; i += 200) {   // a big .in() fails silently: chunk it
    // client_id is load-bearing since ADR-0132: `productId` is now read as a piece id, so this
    // filter is what keeps a genuine shop product from ever resolving to somebody's garment.
    let q = supabase
      .from('gp_closet_items')
      .select('id, name, name_override, brand, transitioned_at, is_deleted, deleted_at, raw')
      .in('id', ids.slice(i, i + 200))
    if (clientId) q = q.eq('client_id', clientId)
    const { data, error } = await q
    if (error) throw error
    for (const r of (data ?? []) as any[]) {
      const raw = r.raw ?? {}
      out.set(r.id, {
        id: r.id,
        name: (r.name_override?.trim() || r.name) ?? 'Untitled piece',
        brand: r.brand && r.brand !== 'None' ? r.brand : null,
        transitionedAt: r.transitioned_at ?? null,
        isDeleted: r.is_deleted ?? null,
        deletedAt: r.deleted_at ?? null,
        urls: [raw.image, raw.processed_image, ...(Array.isArray(raw.images) ? raw.images : [])].filter((u: unknown): u is string => typeof u === 'string'),
      })
    }
  }
  return out
}

/** The ids on each board's own product list: the only shop products GoodPix names as such. */
async function readStoreProducts(boardIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>()
  const ids = [...new Set(boardIds.filter(Boolean))]
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from('gp_boards').select('id, product_list').in('id', ids.slice(i, i + 100))
    if (error) throw error
    for (const b of (data ?? []) as any[]) {
      const list = Array.isArray(b.product_list) ? b.product_list : []
      out.set(b.id, new Set(list.map((p: any) => p?._id).filter((x: unknown): x is string => typeof x === 'string')))
    }
  }
  return out
}

/**
 * The name a piece carries under ANY client: only to call a piece she no longer has by its name.
 * Never used to decide what goes on the board; that read stays scoped to her (ADR-0132).
 */
async function readNames(ids: string[]): Promise<Map<string, { name: string; brand: string | null }>> {
  const out = new Map<string, { name: string; brand: string | null }>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('gp_closet_items').select('id, name, name_override, brand').in('id', ids.slice(i, i + 200))
    if (error) throw error
    for (const r of (data ?? []) as any[]) {
      out.set(r.id, { name: (r.name_override?.trim() || r.name) ?? 'Untitled piece', brand: r.brand && r.brand !== 'None' ? r.brand : null })
    }
  }
  return out
}

export async function buildGoodPixBoard(lookId: string, closetItemIds: string[]): Promise<GoodPixBoard> {
  // client_id comes back with the layout so the piece read can be scoped to her (ADR-0132).
  const { data: row, error } = await supabase.from('gp_looks').select('gp_layout, client_id, source_board_id').eq('id', lookId).maybeSingle()
  if (error) throw error
  const layout = (row?.gp_layout ?? null) as GpLayout | null
  const clientId = (row?.client_id ?? null) as string | null

  if (!layout || !(layout.objects ?? []).length) {
    const pieces = await readPieces(closetItemIds, clientId)
    const { keep, omitted } = selectRestylePieces(closetItemIds, pieces)
    const canvas = buildCanvasFromClosetItems(keep)
    return { canvas, imageUrls: await resolveClosetImageUrls(canvas), omitted, notInPicture: [], fromLayout: false, pictures: 0, texts: 0 }
  }

  // Everything the layout could be showing: the look's list, GoodPix's pool, explicit ids, and
  // the `productId`s, which are her own piece ids on most boards (ADR-0132). readPieces answers
  // for this client alone; lib/restyleBoard.ts decides what an id that is not hers means.
  const pieces = await readPieces(boardCandidateIds(layout, closetItemIds), clientId)
  const products = await readStoreProducts([row?.source_board_id ?? ''])
  const plan = planGoodPixBoard(lookId, layout, closetItemIds, pieces, products.get(row?.source_board_id ?? '') ?? new Set(), mirrorUrl)
  const omitted = await nameMissing(plan.omitted)

  const conv = plan.conversion

  // Each piece is fitted into the box GoodPix drew, measured against the photo the board will
  // load. Cynthia Dada, 2026-10-21: a replaced or differently cropped photo came in too big or
  // tiny (lib/goodpixLayout.ts fitPiecesToPhotos). A piece with GoodPix's own photo is unchanged.
  const imageUrls = await resolveClosetImageUrls(conv.canvas)
  const byUrl = new Map<string, Promise<PhotoSize | null>>()
  const measure = (url: string) => {
    if (!byUrl.has(url)) byUrl.set(url, measurePhoto(url))
    return byUrl.get(url)!
  }
  const photos = new Map<string, PhotoSize>()
  await Promise.all(Object.entries(imageUrls).map(async ([nodeId, url]) => {
    const p = await measure(url)
    if (p) photos.set(nodeId, p)
  }))
  // A piece that will be refitted is fitted to the piece GoodPix drew, not its whole box: GoodPix's
  // own photo can have see-through space around the piece (the tester, 2026-10-25, Looks 11 and 24:
  // the new jeans came in about 30% too tall). Only those photos are fetched.
  const drawn = new Map<string, PhotoSize>()
  await Promise.all(conv.boxes.map(async (b) => {
    const p = photos.get(b.nodeId)
    if (!b.drawnSrc || !p || !needsFit(b, p)) return
    const gp = await measure(b.drawnSrc)
    if (gp) drawn.set(b.nodeId, gp)
  }))
  const canvas = fitPiecesToPhotos(conv.canvas, conv.boxes, photos, drawn)

  return { canvas, imageUrls, omitted, notInPicture: plan.notInPicture, fromLayout: true, pictures: conv.pictures, texts: conv.texts }
}

/** A piece with no row of hers is called by the name it has anywhere in Atelier, if any. */
async function nameMissing(omitted: OmittedPiece[]): Promise<OmittedPiece[]> {
  const ids = [...new Set(omitted.filter((o) => o.reason === 'missing').map((o) => o.id))]
  if (!ids.length) return omitted
  const names = await readNames(ids)
  return omitted.map((o) => {
    if (o.reason !== 'missing') return o
    const known = names.get(o.id)
    return known ? { ...o, name: known.name, brand: known.brand } : o
  })
}

export interface LookToCheck {
  id: string
  closetItemIds: string[]
  layout: GpLayout | null
  boardId: string | null
}

/**
 * Every piece each look shows that she no longer has, the same answer Restyle's board gives, for
 * the Transitions cards. One read of her pieces for all the looks, not one per card.
 */
export async function piecesGoneFromLooks(clientId: string, looks: LookToCheck[]): Promise<Map<string, OmittedPiece[]>> {
  const out = new Map<string, OmittedPiece[]>()
  if (!looks.length) return out
  const pieces = await readPieces([...new Set(looks.flatMap((l) => boardCandidateIds(l.layout, l.closetItemIds)))], clientId)
  const products = await readStoreProducts(looks.map((l) => l.boardId ?? ''))
  const plans = looks.map((l) => {
    if (!l.layout || !(l.layout.objects ?? []).length) {
      const { omitted } = selectRestylePieces(l.closetItemIds, pieces)
      return { look: l, omitted: omitted.map((o) => ({ ...o, image: pieces.get(o.id)?.urls[0] ?? null })) }
    }
    return { look: l, omitted: planGoodPixBoard(l.id, l.layout, l.closetItemIds, pieces, products.get(l.boardId ?? '') ?? new Set(), mirrorUrl).omitted }
  })
  // One name read for every card, then each card's list.
  const named = await nameMissing(plans.flatMap((p) => p.omitted))
  let at = 0
  for (const { look, omitted } of plans) {
    out.set(look.id, named.slice(at, at + omitted.length))
    at += omitted.length
  }
  return out
}
