import { supabase } from '@/lib/supabase'
import type { LookCanvasState, ClosetItemNode } from '@/types/canvas'
import type { ClosetItem } from '@/lib/images'

/**
 * Resolve node-id → image URL for a canvas state (a Look's or a Capsule's) the SAME way the
 * collection grid does. Digitized (intake_pipeline) items store their image as an R2 key, not
 * in `raw` — they must go through the image-proxy or the garment loads blank (only text labels
 * showed). GoodPix items still use raw.
 *
 * Shared by ChatPanel (open/duplicate a Look) and CategorizePanel (Edit a Capsule) — extracted
 * here so both can hydrate the canvas the same way without CategorizePanel needing to reach into
 * ChatPanel's internals.
 */
export async function resolveClosetImageUrls(canvasState: LookCanvasState): Promise<Record<string, string>> {
  const closetNodes = canvasState.nodes.filter((n): n is ClosetItemNode => n.type === 'closet_item')
  const closetItemIds = closetNodes.map((n) => n.closet_item_id)
  const newImageUrls: Record<string, string> = {}
  if (closetItemIds.length === 0) return newImageUrls

  const { data: items } = await supabase
    .from('gp_closet_items')
    .select('id, raw, source, processed_image_hash, primary_image_hash')
    .in('id', closetItemIds)

  if (items) {
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
    const urlMap = new Map<string, string>()
    for (const item of items as Array<{ id: string; raw: ClosetItem['raw']; source?: string; processed_image_hash?: string | null; primary_image_hash?: string | null }>) {
      let url: string | null = null
      if (item.source === 'intake_pipeline') {
        const key = item.processed_image_hash ?? item.primary_image_hash
        if (key) url = `${SUPABASE_URL}/functions/v1/image-proxy?key=${encodeURIComponent(key)}`
      }
      if (!url) url = item.raw?.processed_image ?? item.raw?.image ?? item.raw?.images?.[0] ?? null
      if (url) urlMap.set(item.id, url)
    }
    for (const node of closetNodes) {
      const url = urlMap.get(node.closet_item_id)
      if (url) newImageUrls[node.id] = url
    }
  }
  return newImageUrls
}
