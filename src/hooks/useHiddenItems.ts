import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

// The hidden pool: items with is_deleted=true. Nothing else in the app surfaces these, so a piece
// archived (or removed as a "duplicate", or by a one-off SQL command) simply vanishes with no way to
// find it. This hook lists them so a stylist can eyeball each and Restore the ones hidden by mistake.
// Delete provenance (deleted_at/by/reason) is shown when present (migration 016; NULL for legacy hides).

export interface HiddenItem {
  id: string
  name: string
  brand: string | null
  category: string | null
  addedAt: string | null
  deletedAt: string | null
  deletedBy: string | null
  deletedReason: string | null
  image: string | null
}

function itemImage(row: any): string | null {
  if (row.source === 'intake_pipeline') {
    const key = row.processed_image_hash ?? row.primary_image_hash
    if (key) return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/image-proxy?key=${encodeURIComponent(key)}`
  }
  const raw = row.raw ?? {}
  return raw.processed_image ?? raw.image ?? raw.images?.[0] ?? null
}

export function useHiddenItems(clientId: string | null) {
  const [items, setItems] = useState<HiddenItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const bg = useRef(false)

  useEffect(() => {
    if (!clientId) { setItems([]); return }
    let cancelled = false
    const background = bg.current
    bg.current = false
    if (!background) setLoading(true)
    setError(null)

    ;(async () => {
      // Page past the 1000-row cap with a unique tiebreaker (same deterministic-pagination rule as
      // the rest of the app — a big client can have 1000+ hidden rows).
      const PAGE = 1000
      const rows: any[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error: e } = await supabase
          .from('gp_closet_items')
          .select('id, name, name_override, brand, category, raw, primary_image_hash, processed_image_hash, source, added_at, deleted_at, deleted_by, deleted_reason')
          .eq('client_id', clientId)
          .eq('is_deleted', true)
          .order('added_at', { ascending: false, nullsFirst: false })
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1)
        if (cancelled) return
        if (e) { setError(e.message); setLoading(false); return }
        rows.push(...(data ?? []))
        if (!data || data.length < PAGE) break
      }
      setItems(rows.map((r) => ({
        id: r.id,
        name: (r.name_override?.trim() || r.name) ?? 'Untitled item',
        brand: r.brand && r.brand !== 'None' ? r.brand : null,
        category: r.category ?? null,
        addedAt: r.added_at ?? null,
        deletedAt: r.deleted_at ?? null,
        deletedBy: r.deleted_by ?? null,
        deletedReason: r.deleted_reason ?? null,
        image: itemImage(r),
      })))
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [clientId, tick])

  const refetch = useCallback(() => { bg.current = true; setTick((t) => t + 1) }, [])

  // Restore a hidden piece → it returns to the collection AND the client's lookbook (both read
  // is_deleted=false). Clears the delete provenance since it's no longer deleted.
  const restore = useCallback(async (id: string) => {
    if (!clientId) return
    const { error: e } = await supabase.from('gp_closet_items')
      .update({ is_deleted: false, deleted_at: null, deleted_by: null, deleted_reason: null })
      .eq('id', id).eq('client_id', clientId)
    if (e) throw e
    refetch()
  }, [clientId, refetch])

  return { items, loading, error, refetch, restore }
}
