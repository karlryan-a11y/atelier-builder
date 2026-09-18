import { supabase } from '@/lib/supabase'
import type { LookCanvasState } from '@/types/canvas'
import { buildCanvasFromClosetItems } from '@/lib/rebuildLookCanvas'
import { convertGoodPixLayout, piecesInLayout, type GpLayout } from '@/lib/goodpixLayout'
import { selectRestylePieces, type OmittedPiece, type RestylePiece } from '@/lib/restyleSelection'

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
  /** Pieces that were in the look and are left off because she no longer has them. */
  omitted: OmittedPiece[]
  /** Pieces GoodPix listed for the look that are NOT in its picture: not placed, only named. */
  notInPicture: OmittedPiece[]
  /** True when the board came from the stored arrangement, false for the grid fallback. */
  fromLayout: boolean
  pictures: number
  texts: number
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const mirrorUrl = (key: string) => `${SUPABASE_URL}/functions/v1/image-proxy?key=${encodeURIComponent(key)}`

async function readPieces(ids: string[]) {
  const out = new Map<string, RestylePiece & { urls: string[] }>()
  for (let i = 0; i < ids.length; i += 200) {   // a big .in() fails silently: chunk it
    const { data, error } = await supabase
      .from('gp_closet_items')
      .select('id, name, name_override, brand, transitioned_at, is_deleted, deleted_at, raw')
      .in('id', ids.slice(i, i + 200))
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

export async function buildGoodPixBoard(lookId: string, closetItemIds: string[]): Promise<GoodPixBoard> {
  const { data: row, error } = await supabase.from('gp_looks').select('gp_layout').eq('id', lookId).maybeSingle()
  if (error) throw error
  const layout = (row?.gp_layout ?? null) as GpLayout | null

  if (!layout || !(layout.objects ?? []).length) {
    const pieces = await readPieces(closetItemIds)
    const { keep, omitted } = selectRestylePieces(closetItemIds, pieces)
    return { canvas: buildCanvasFromClosetItems(keep), omitted, notInPicture: [], fromLayout: false, pictures: 0, texts: 0 }
  }

  // Everything the layout could be showing: the look's list, GoodPix's pool, explicit ids.
  const candidates = [...new Set([
    ...closetItemIds,
    ...(layout.pool ?? []).map((p) => p.id),
    ...(layout.objects ?? []).map((o) => o.closetItemId).filter((x): x is string => !!x),
  ])]
  const pieces = await readPieces(candidates)
  const extraUrls = new Map([...pieces].map(([id, p]) => [id, p.urls]))

  const inPicture = piecesInLayout(layout, extraUrls)
  const { keep, omitted } = selectRestylePieces(inPicture, pieces)
  const keepSet = new Set(keep)
  const conv = convertGoodPixLayout(layout, {
    keep: (id) => keepSet.has(id),
    extraUrls,
    mirrorUrl,
    idPrefix: lookId.slice(-6),
  })

  const shown = new Set(inPicture)
  const notInPicture: OmittedPiece[] = closetItemIds
    .filter((id) => !shown.has(id))
    .map((id) => pieces.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ id: p.id, name: p.name, brand: p.brand, reason: 'not_in_picture' as const }))

  return { canvas: conv.canvas, omitted, notInPicture, fromLayout: true, pictures: conv.pictures, texts: conv.texts }
}
