// The core job: given the item ids whose photo just changed, re-bake every look and capsule hero
// that styles them. LOOKS FIRST, then capsules — a look-grid capsule composite is built from its
// member looks' fresh thumbnails, so the looks must be updated before the grid re-renders.
import { db, uploadImage } from './supabase.js'
import { render, type CanvasRenderResult, type GridRenderResult } from './browser.js'
import { imageProxyUrl } from './env.js'

// ── Loose row shapes (service-role reads; we only touch a few fields) ──────────────────────────
interface ClosetItemRow {
  id: string
  client_id: string
  raw: { processed_image?: string; image?: string; images?: string[]; [k: string]: unknown } | null
  source: string | null
  processed_image_hash: string | null
  primary_image_hash: string | null
}
interface CanvasNodeLite { id: string; type: string; closet_item_id?: string; z_index: number }
interface CanvasStateLite { canvas: { width: number; height: number; background: string }; nodes: CanvasNodeLite[] }
interface LookRow {
  id: string
  client_id: string
  name: string | null
  canvas_state: CanvasStateLite | null
  thumbnail_url: string | null
  raw: Record<string, unknown> | null
}
interface BoardRow {
  id: string
  client_id: string
  name: string | null
  closet_item_ids: string[] | null
  raw: Record<string, unknown> | null
}

export interface RegenerateSummary { looks: number; capsules: number; failures: string[] }

const itemIdsInCanvas = (cs: CanvasStateLite | null): string[] =>
  (cs?.nodes ?? []).filter((n) => n.type === 'closet_item' && n.closet_item_id).map((n) => n.closet_item_id as string)

/** Resolve node-id → live image URL exactly like the builder (ChatPanel.resolveLookImageUrls). */
async function resolveImageUrls(cs: CanvasStateLite): Promise<Record<string, string>> {
  const closetNodes = cs.nodes.filter((n) => n.type === 'closet_item' && n.closet_item_id)
  const ids = [...new Set(closetNodes.map((n) => n.closet_item_id as string))]
  const urls: Record<string, string> = {}
  if (ids.length === 0) return urls

  const { data: items } = await db
    .from('gp_closet_items')
    .select('id, raw, source, processed_image_hash, primary_image_hash')
    .in('id', ids)

  const byItem = new Map<string, string>()
  for (const item of (items ?? []) as ClosetItemRow[]) {
    let url: string | null = null
    if (item.source === 'intake_pipeline') {
      const key = item.processed_image_hash ?? item.primary_image_hash
      if (key) url = imageProxyUrl(key)
    }
    if (!url) url = item.raw?.processed_image ?? item.raw?.image ?? item.raw?.images?.[0] ?? null
    if (url) byItem.set(item.id, url)
  }
  for (const node of closetNodes) {
    const url = byItem.get(node.closet_item_id as string)
    if (url) urls[node.id] = url
  }
  return urls
}

/** Bake one canvas_state (a look or a board-composed capsule) → { pngBase64, thumbnailDataUrl }. */
async function bakeCanvas(cs: CanvasStateLite): Promise<CanvasRenderResult> {
  const imageUrls = await resolveImageUrls(cs)
  return render<CanvasRenderResult>({ kind: 'canvas', canvasState: cs, imageUrls, pixelRatio: 2 })
}

/** Regenerate every affected look. Returns the set of look ids that were updated. */
async function regenerateLooks(clientIds: string[], itemIds: Set<string>, failures: string[]): Promise<Set<string>> {
  const updated = new Set<string>()
  const { data: looks } = await db
    .from('gp_looks')
    .select('id, client_id, name, canvas_state, thumbnail_url, raw')
    .eq('source', 'builder')
    .is('transitioned_at', null)
    .in('client_id', clientIds)

  for (const look of (looks ?? []) as LookRow[]) {
    if (!look.canvas_state) continue
    if (!itemIdsInCanvas(look.canvas_state).some((id) => itemIds.has(id))) continue
    try {
      const { pngBase64, thumbnailDataUrl } = await bakeCanvas(look.canvas_state)
      const key = `looks/${look.id}/image-${Date.now()}.png`
      const r2Key = await uploadImage(pngBase64, key)
      if (!r2Key) { failures.push(`look ${look.id}: upload failed`); continue }
      const raw = { ...(look.raw ?? {}), main_image_r2_key: r2Key, main_image_url: imageProxyUrl(r2Key) }
      const { error } = await db
        .from('gp_looks')
        .update({ raw, thumbnail_url: thumbnailDataUrl || look.thumbnail_url, updated_at: new Date().toISOString() })
        .eq('id', look.id)
      if (error) { failures.push(`look ${look.id}: ${error.message}`); continue }
      updated.add(look.id)
    } catch (err) {
      failures.push(`look ${look.id}: ${err instanceof Error ? err.message : 'render error'}`)
    }
  }
  return updated
}

/** Regenerate every affected capsule (gp_boards): board-composed AND look-grid heroes. */
async function regenerateCapsules(clientIds: string[], itemIds: Set<string>, affectedLookIds: Set<string>, failures: string[]): Promise<number> {
  let count = 0
  const { data: boards } = await db
    .from('gp_boards')
    .select('id, client_id, name, closet_item_ids, raw')
    .in('client_id', clientIds)

  for (const board of (boards ?? []) as BoardRow[]) {
    const raw = board.raw ?? {}
    const canvasState = raw.canvas_state as CanvasStateLite | undefined
    const lookIds = (raw.look_ids as string[] | undefined) ?? []

    // 1) Board-composed capsule (Save-as-capsule) — re-bake from its own canvas_state.
    if (canvasState && itemIdsInCanvas(canvasState).some((id) => itemIds.has(id))) {
      try {
        const { pngBase64 } = await bakeCanvas(canvasState)
        const key = `capsules/${board.id}/image-${Date.now()}.png`
        const r2Key = await uploadImage(pngBase64, key)
        if (!r2Key) { failures.push(`capsule ${board.id}: upload failed`); continue }
        const newRaw = { ...raw, image_r2_key: r2Key, image_url: imageProxyUrl(r2Key) }
        const { error } = await db.from('gp_boards').update({ raw: newRaw }).eq('id', board.id)
        if (error) { failures.push(`capsule ${board.id}: ${error.message}`); continue }
        count++
      } catch (err) {
        failures.push(`capsule ${board.id}: ${err instanceof Error ? err.message : 'render error'}`)
      }
      continue
    }

    // 2) Look-grid capsule — rebuild the grid from its member looks' FRESH thumbnails.
    if (lookIds.length > 0 && lookIds.some((id) => affectedLookIds.has(id))) {
      try {
        const { data: members } = await db
          .from('gp_looks')
          .select('id, name, thumbnail_url')
          .in('id', lookIds)
          .is('transitioned_at', null)
        // Preserve the capsule's look order (members come back unordered).
        const byId = new Map((members ?? []).map((m: { id: string }) => [m.id, m]))
        const ordered = lookIds
          .map((id) => byId.get(id) as { id: string; name: string | null; thumbnail_url: string | null } | undefined)
          .filter((m): m is { id: string; name: string | null; thumbnail_url: string | null } => !!m)
        const gridLooks = ordered.map((m) => ({
          name: m.name ?? 'Untitled Look',
          imageUrl: m.thumbnail_url,
          thumbnailUrl: m.thumbnail_url,
        }))
        const { pngBase64 } = await render<GridRenderResult>({ kind: 'capsuleGrid', looks: gridLooks })
        const key = `capsules/${board.id}/image-${Date.now()}.png`
        const r2Key = await uploadImage(pngBase64, key)
        if (!r2Key) { failures.push(`capsule ${board.id}: upload failed`); continue }
        const newRaw = { ...raw, image_r2_key: r2Key, image_url: imageProxyUrl(r2Key) }
        const { error } = await db.from('gp_boards').update({ raw: newRaw }).eq('id', board.id)
        if (error) { failures.push(`capsule ${board.id}: ${error.message}`); continue }
        count++
      } catch (err) {
        failures.push(`capsule ${board.id}: ${err instanceof Error ? err.message : 'render error'}`)
      }
    }
  }
  return count
}

/** Entry point: re-bake all look + capsule heroes that style any of `itemIds`. */
export async function regenerate(rawItemIds: string[]): Promise<RegenerateSummary> {
  const itemIds = new Set(rawItemIds.filter(Boolean))
  const failures: string[] = []
  if (itemIds.size === 0) return { looks: 0, capsules: 0, failures }

  // Scope everything to the affected item's client(s) so scans stay bounded.
  const { data: items } = await db
    .from('gp_closet_items')
    .select('id, client_id')
    .in('id', [...itemIds])
  const clientIds = [...new Set((items ?? []).map((i: { client_id: string }) => i.client_id).filter(Boolean))]
  if (clientIds.length === 0) return { looks: 0, capsules: 0, failures }

  const affectedLookIds = await regenerateLooks(clientIds, itemIds, failures)
  const capsules = await regenerateCapsules(clientIds, itemIds, affectedLookIds, failures)

  console.log(`[regenerate] items=${itemIds.size} looks=${affectedLookIds.size} capsules=${capsules} failures=${failures.length}`)
  if (failures.length) console.warn('[regenerate] failures:', failures)
  return { looks: affectedLookIds.size, capsules, failures }
}
