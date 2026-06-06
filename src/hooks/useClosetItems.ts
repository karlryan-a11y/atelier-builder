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

      // Resolve signed URLs for intake pipeline items
      const intakeItems = allItems.filter(i => i.source === 'intake_pipeline')
      if (intakeItems.length > 0) {
        const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
        const r2Keys = intakeItems.map(i => i.processed_image_hash ?? i.primary_image_hash).filter(Boolean) as string[]
        const BATCH = 50
        const signedUrls = new Map<string, string>()
        for (let b = 0; b < r2Keys.length; b += BATCH) {
          try {
            const resp = await fetch(SUPABASE_URL + '/functions/v1/intake-signed-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ keys: r2Keys.slice(b, b + BATCH), expires_in: 3600 }),
            })
            if (resp.ok) {
              const data = await resp.json()
              for (const [key, url] of Object.entries(data.urls ?? {})) {
                signedUrls.set(key, url as string)
              }
            }
          } catch {}
        }
        // Inject signed URLs into raw.processed_image for intake items
        for (const item of allItems) {
          if (item.source === 'intake_pipeline') {
            const key = item.processed_image_hash ?? item.primary_image_hash
            if (key && signedUrls.has(key)) {
              item.raw = { ...item.raw, processed_image: signedUrls.get(key)! }
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
