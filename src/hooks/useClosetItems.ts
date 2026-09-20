import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ClosetItem } from '@/lib/images'
import { styleKeys } from '@/lib/queryClient'
import { r2ImageUrl } from '@/lib/imageUrls'

/**
 * The columns the client's closet is read with, for EVERY screen that shows it.
 *
 * `raw` is NOT selected whole. It is ~75% of the bytes (Cynthia Lippe: 3.78 MB with it, under
 * 1 MB without) and the closet screens read exactly three things out of it, all to find the
 * picture (lib/images.ts resolveItemImage): raw.processed_image, raw.image and raw.images[0].
 * Those three come back as aliases and are folded back into `raw` below, so every reader sees the
 * same `item.raw.X` it always did.
 *
 * `ClosetItemRaw` (lib/images.ts) lists exactly those keys and has no index signature, so a
 * screen that starts reading any other raw field does not compile, and
 * scripts/check-closet-raw-fields.mjs fails if the type and this SELECT ever disagree.
 * Verified on production 2026-09-19: over all 89,593 closet rows the trimmed fields resolve to
 * the identical picture as the full raw (0 mismatches).
 */
export const CLOSET_SELECT =
  'id, client_id, name, name_override, style_note, category, custom_categories, category_suggested, brand, color, color_family, color_families, color_audit, content_tag_ids, is_deleted, transitioned_at, transition_reason, transition_source, client_edited_fields, client_edited_at, drive_verified_at, drive_verified_by, ' +
  'raw_image:raw->>image, raw_processed_image:raw->>processed_image, raw_image0:raw->images->>0, ' +
  'primary_image_hash, processed_image_hash, source, added_at'

const PAGE = 1000
const TAG_CHUNK = 150

type ClosetRow = Omit<ClosetItem, 'raw'> & {
  raw_image: string | null
  raw_processed_image: string | null
  raw_image0: string | null
}

export interface ClosetData {
  items: ClosetItem[]
  // tag id -> name, read from gp_content_tags (the SAME source the lookbook uses). The category
  // resolver reads each item's content_tag_ids column against this map, so builder + lookbook
  // resolve identically. (Previously we read the closet_item_tags junction, which is empty for
  // GoodPix items → the builder mis-guessed their category from the name. See ADR / 2026-07-07.)
  tagNameById: Map<string, string>
}

function closetQuery(clientId: string, count = false) {
  return supabase
    // Read the base table directly (not the `closet_items` view) so the new
    // override columns are available without depending on the view's frozen
    // column list. SELECT RLS on gp_closet_items is open (same as the view).
    .from('gp_closet_items')
    .select(CLOSET_SELECT, count ? { count: 'exact' } : undefined)
    .eq('client_id', clientId)
    .eq('is_deleted', false)
    // Transitioned-out pieces are excluded here the same way deleted ones are: this
    // hook feeds every "the client's current collection" surface. The Transitions tab
    // queries for them explicitly instead. See migration 014.
    .is('transitioned_at', null)
    .order('added_at', { ascending: false, nullsFirst: false })
    // Unique tiebreaker so paginated .range() is deterministic — added_at has ties/nulls, and
    // without a total order the >1000-item page boundary skips/duplicates rows each load. (id = PK)
    .order('id', { ascending: true })
}

function toItem(row: ClosetRow): ClosetItem {
  const { raw_image, raw_processed_image, raw_image0, ...rest } = row
  const raw: ClosetItem['raw'] = {}
  if (raw_processed_image != null) raw.processed_image = raw_processed_image
  if (raw_image != null) raw.image = raw_image
  if (raw_image0 != null) raw.images = [raw_image0]
  return { ...rest, raw }
}

/**
 * Read the client's whole current collection. Exported for the cache and for tests; screens use
 * the hook below.
 *
 * PAGE THROUGH EVERY ROW. PostgREST caps an unbounded select at 1000 and returns the truncated
 * set with NO error — a client at 1000+ pieces would silently show only the first 1000 across
 * Collection, Colors and the canvas closet, looking like a complete collection. The first page
 * asks for the exact count, and the rest are read IN PARALLEL (they used to run one after the
 * other). If the collection grew while we read, the last page comes back full and we keep going
 * one page at a time until a short page, then drop any row a shifted page boundary repeated.
 */
export async function fetchClosetData(clientId: string): Promise<ClosetData> {
  try {
    return await readCloset(clientId)
  } catch (e) {
    console.error('useClosetItems: closet query failed —', e instanceof Error ? e.message : e)
    throw e
  }
}

async function readCloset(clientId: string): Promise<ClosetData> {
  const first = await closetQuery(clientId, true).range(0, PAGE - 1)
  // Never collapse a failed query into an empty list — that masked the 2026-06-24 outage (a
  // missing column read as "client has no items"). Throw, so the screen shows a broken state.
  if (first.error) throw new Error(first.error.message)
  const pages: ClosetRow[][] = [(first.data ?? []) as unknown as ClosetRow[]]
  const total = first.count ?? pages[0].length

  if (pages[0].length === PAGE) {
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, Math.ceil(total / PAGE) - 1) }, (_, i) => {
        const from = (i + 1) * PAGE
        return closetQuery(clientId).range(from, from + PAGE - 1)
      }),
    )
    for (const r of rest) {
      if (r.error) throw new Error(r.error.message)
      pages.push((r.data ?? []) as unknown as ClosetRow[])
    }
    // Grew mid-read (or the count was short): continue sequentially until a short page.
    for (let from = pages.length * PAGE; pages[pages.length - 1].length === PAGE; from += PAGE) {
      const r = await closetQuery(clientId).range(from, from + PAGE - 1)
      if (r.error) throw new Error(r.error.message)
      pages.push((r.data ?? []) as unknown as ClosetRow[])
    }
  }

  const seen = new Set<string>()
  const items: ClosetItem[] = []
  for (const page of pages) {
    for (const row of page) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      items.push(toItem(row))
    }
  }

  // Route intake-pipeline (digitized) item images through the image-proxy
  // Edge Function. R2 serves no CORS headers, so signed R2 URLs taint the
  // Konva canvas and break look export/thumbnails. The proxy returns the
  // bytes with Access-Control-Allow-Origin:* so the canvas stays clean.
  // Through the cached /img/ path (r2ImageUrl), not a raw image-proxy URL: same CORS-clean bytes
  // for Konva, but served from the edge cache instead of the function on every board open.
  for (const item of items) {
    if (item.source === 'intake_pipeline') {
      const key = item.processed_image_hash ?? item.primary_image_hash
      if (key) {
        item.raw = { ...item.raw, processed_image: r2ImageUrl(key) }
      }
    }
  }

  // Resolve garment-tag NAMES from gp_content_tags for every tag id referenced by these items'
  // content_tag_ids column — exactly like the lookbook's getContentTags. Chunk the .in() so a
  // long id list never blows the URL length limit; the chunks run in parallel.
  const tagIds = [...new Set(items.flatMap((i) => i.content_tag_ids ?? []))]
  const tagNameById = new Map<string, string>()
  const chunks: string[][] = []
  for (let i = 0; i < tagIds.length; i += TAG_CHUNK) chunks.push(tagIds.slice(i, i + TAG_CHUNK))
  const tagPages = await Promise.all(
    chunks.map((chunk) => supabase.from('gp_content_tags').select('id, name').in('id', chunk)),
  )
  for (const { data: tagRows } of tagPages) {
    for (const t of tagRows ?? []) tagNameById.set(t.id, String(t.name ?? ''))
  }

  return { items, tagNameById }
}

const NO_ITEMS: ClosetItem[] = []
const NO_TAGS = new Map<string, string>()

/**
 * The client's current collection, from the ONE shared cache (lib/queryClient.ts). The canvas
 * closet, Collection, Colors, Review and Nesting all call this with the same client id and share
 * one read. scripts/check-style-shared-cache.mjs fails if a closet screen reads gp_closet_items
 * for itself again.
 *
 * refetch() is a BACKGROUND refresh — it never flips `loading` (which would remount the grid and
 * bounce the stylist to the top mid-categorizing), and every screen showing the collection gets
 * the result. patchItems() writes an edit into the cache at once, before that refresh lands.
 */
export function useClosetItems(clientId: string | null) {
  const qc = useQueryClient()
  const queryKey = styleKeys.closet(clientId)
  const query = useQuery({
    queryKey,
    queryFn: () => fetchClosetData(clientId!),
    enabled: !!clientId,
  })

  const refetch = useCallback(() => {
    if (!clientId) return
    void qc.invalidateQueries({ queryKey: styleKeys.closet(clientId) })
  }, [qc, clientId])

  const patchItems = useCallback((ids: string[], patch: Partial<ClosetItem>) => {
    if (!clientId) return
    const idSet = new Set(ids)
    qc.setQueryData<ClosetData>(styleKeys.closet(clientId), (old) => old && ({
      ...old,
      items: old.items.map((i) => (idSet.has(i.id) ? { ...i, ...patch } : i)),
    }))
  }, [qc, clientId])

  // A failed read shows as an error with NO items, never as a false-empty or stale collection
  // under an error banner (same contract as before the shared cache).
  const failed = query.isError
  const error = failed ? (query.error instanceof Error ? query.error.message : String(query.error)) : null

  return useMemo(() => ({
    items: clientId && !failed ? query.data?.items ?? NO_ITEMS : NO_ITEMS,
    tagNameById: clientId && !failed ? query.data?.tagNameById ?? NO_TAGS : NO_TAGS,
    loading: !!clientId && query.isLoading,
    error,
    refetch,
    patchItems,
  }), [clientId, failed, query.data, query.isLoading, error, refetch, patchItems])
}
