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
        .select('id, client_id, name, brand, content_tag_ids, is_deleted, raw, primary_image_hash, processed_image_hash')
        .eq('client_id', clientId)
        .eq('is_deleted', false)
        .order('name')

      if (cancelled) return

      const allItems = data ?? []
      setItems(allItems)

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
