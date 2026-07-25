import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { ClosetItem } from '@/lib/images'

export function useClosetItems(clientId: string | null) {
  const [items, setItems] = useState<ClosetItem[]>([])
  // tag id -> name, read from gp_content_tags (the SAME source the lookbook uses). The category
  // resolver reads each item's content_tag_ids column against this map, so builder + lookbook
  // resolve identically. (Previously we read the closet_item_tags junction, which is empty for
  // GoodPix items → the builder mis-guessed their category from the name. See ADR / 2026-07-07.)
  const [tagNameById, setTagNameById] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  // refetch() after an edit is a BACKGROUND refresh — must not flip `loading` (which would
  // remount the grid and bounce the stylist to the top mid-categorizing).
  const bg = useRef(false)

  useEffect(() => {
    if (!clientId) {
      setItems([])
      setTagNameById(new Map())
      return
    }

    let cancelled = false
    const background = bg.current
    bg.current = false
    if (!background) setLoading(true)
    setError(null)

    async function load() {
      // PAGE THROUGH EVERY ROW. PostgREST caps an unbounded select at 1000 and returns
      // the truncated set with NO error — a client at 1000+ pieces would silently show
      // only the first 1000 across Collection, Colors and the canvas closet, looking
      // like a complete collection. (Danielle York was at 889 and still uploading.)
      // Same .range() loop useReconciliation and useItemLookUsage already use.
      const PAGE = 1000
      const allItems: ClosetItem[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error: queryError } = await supabase
          // Read the base table directly (not the `closet_items` view) so the new
          // override columns are available without depending on the view's frozen
          // column list. SELECT RLS on gp_closet_items is open (same as the view).
          .from('gp_closet_items')
          .select('id, client_id, name, name_override, style_note, category, custom_categories, category_suggested, brand, color, color_family, color_families, color_audit, content_tag_ids, is_deleted, transitioned_at, transition_reason, transition_source, client_edited_fields, client_edited_at, drive_verified_at, drive_verified_by, raw, primary_image_hash, processed_image_hash, source, added_at')
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
          .range(from, from + PAGE - 1)

        if (cancelled) return

        // Never collapse a failed query into an empty list — that masked the
        // 2026-06-24 outage (a missing column read as "client has no items").
        // Surface the error so the UI shows a broken state, not a false-empty one.
        if (queryError) {
          console.error('useClosetItems: closet query failed —', queryError.message)
          setError(queryError.message)
          setItems([])
          setLoading(false)
          return
        }

        const page = data ?? []
        allItems.push(...page)
        if (page.length < PAGE) break
      }

      setItems(allItems)

      // Route intake-pipeline (digitized) item images through the image-proxy
      // Edge Function. R2 serves no CORS headers, so signed R2 URLs taint the
      // Konva canvas and break look export/thumbnails. The proxy returns the
      // bytes with Access-Control-Allow-Origin:* so the canvas stays clean.
      const intakeItems = allItems.filter(i => i.source === 'intake_pipeline')
      if (intakeItems.length > 0) {
        const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
        for (const item of allItems) {
          if (item.source === 'intake_pipeline') {
            const key = item.processed_image_hash ?? item.primary_image_hash
            if (key) {
              item.raw = {
                ...item.raw,
                processed_image: `${SUPABASE_URL}/functions/v1/image-proxy?key=${encodeURIComponent(key)}`,
              }
            }
          }
        }
        if (!cancelled) setItems([...allItems]) // Re-set to trigger re-render
      }

      // Resolve garment-tag NAMES from gp_content_tags for every tag id referenced by these items'
      // content_tag_ids column — exactly like the lookbook's getContentTags. Chunk the .in() so a
      // long id list never blows the URL length limit.
      const tagIds = [...new Set(allItems.flatMap((i) => i.content_tag_ids ?? []))]
      if (tagIds.length > 0) {
        const nameMap = new Map<string, string>()
        for (let i = 0; i < tagIds.length; i += 150) {
          const chunk = tagIds.slice(i, i + 150)
          const { data: tagRows } = await supabase.from('gp_content_tags').select('id, name').in('id', chunk)
          for (const t of tagRows ?? []) nameMap.set(t.id, String(t.name ?? ''))
        }
        if (!cancelled) setTagNameById(nameMap)
      } else if (!cancelled) {
        setTagNameById(new Map())
      }

      if (!cancelled) setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [clientId, reloadTick])

  return { items, tagNameById, loading, error, refetch: () => { bg.current = true; setReloadTick((t) => t + 1) } }
}
