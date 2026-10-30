import { resolveClosetImageUrls } from '@/lib/resolveClosetImageUrls'
import type { NaturalSize } from '@/lib/restyleSelection'
import type { LookCanvasState } from '@/types/canvas'

/**
 * The size of the photo the canvas draws for each piece, for the few pieces whose place on a board
 * cannot be told from their corner alone (lib/restyleSelection.ts placeOnBoard). Same address the
 * canvas loads (resolveClosetImageUrls), so the scale saved on the node means the same thing here.
 *
 * Only ever asked about a handful: 11 nodes across Danielle York's 81 pulled Atelier looks. A photo
 * that does not load is left out, and the piece is then counted as in the picture, so the card
 * names it rather than hiding it.
 */
export async function measurePieces(closetItemIds: string[]): Promise<Map<string, NaturalSize>> {
  const out = new Map<string, NaturalSize>()
  const ids = [...new Set(closetItemIds)]
  if (ids.length === 0) return out
  const state = {
    version: 1,
    canvas: { width: 1080, height: 1080, background: '#ffffff' },
    nodes: ids.map((id) => ({ id, type: 'closet_item', closet_item_id: id, x: 0, y: 0, scale: 1, rotation: 0, flipped: false, z_index: 0, locked: false })),
  } as LookCanvasState
  const urls = await resolveClosetImageUrls(state)
  await Promise.all(ids.map((id) => new Promise<void>((resolve) => {
    const url = urls[id]
    if (!url) { resolve(); return }
    const img = new Image()
    const done = () => { clearTimeout(timer); resolve() }
    const timer = setTimeout(done, 10_000)
    img.onload = () => { if (img.naturalWidth > 0) out.set(id, { width: img.naturalWidth, height: img.naturalHeight }); done() }
    img.onerror = done
    img.src = url
  })))
  return out
}
