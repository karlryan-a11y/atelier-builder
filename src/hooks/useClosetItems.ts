import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { ClosetItem } from '@/lib/images'

export function useClosetItems(clientId: string | null) {
  const [items, setItems] = useState<ClosetItem[]>([])
  const [itemTagIds, setItemTagIds] = useState<Map<string, string[]>>(new Map())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!clientId) {
      setItems([])
      setItemTagIds(new Map())
      return
    }

    let cancelled = false
    setLoading(true)

    async function load() {
      const { data } = await supabase
        .from('closet_items')
        .select('id, client_id, name, brand, content_tag_ids, is_deleted, raw, primary_image_hash, processed_image_hash, source, added_at')
        .eq('client_id', clientId)
        .eq('is_deleted', false)
        .order('added_at', { ascending: false, nullsFirst: false })

      if (cancelled) return

      const allItems = data ?? []
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

      if (allItems.length > 0) {
        const ids = allItems.map((i) => i.id)
        const { data: junctionRows } = await supabase
          .from('closet_item_tags')
          .select('closet_item_id, tag_id')
          .in('closet_item_id', ids)

        if (!cancelled) {
          const map = new Map<string, string[]>()
          for (const row of junctionRows ?? []) {
            const arr = map.get(row.closet_item_id) ?? []
            arr.push(row.tag_id)
            map.set(row.closet_item_id, arr)
          }
          setItemTagIds(map)
        }
      }

      if (!cancelled) setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [clientId])

  return { items, itemTagIds, loading }
}
