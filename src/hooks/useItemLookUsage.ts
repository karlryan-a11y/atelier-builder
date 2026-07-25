import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { proxyImageUrl } from '@/lib/images'

// A light record of a look for the "styled in" popup — just what we need to show it.
export interface LookLite { id: string; name: string; image: string | null }

// Builds a reverse index: closet_item_id → the looks that item appears in. Reads EVERY one of the
// client's looks (both 'goodpix' imports and 'builder' looks — the app's other looks hook filters
// to 'builder' only, which would badly undercount), excludes archived, and dedupes so an item
// placed twice on one board still counts that look once. Read-only; no writes.
export function useItemLookUsage(clientId: string | null) {
  const [byItem, setByItem] = useState<Map<string, LookLite[]>>(new Map())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!clientId) { setByItem(new Map()); return }
    let cancelled = false
    setLoading(true)

    ;(async () => {
      // Paginate against PostgREST's 1000-row cap so a heavily-styled client can't silently truncate.
      const all: Record<string, unknown>[] = []
      const PAGE = 1000
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          // gp_looks base (not the `looks` view) so transitioned looks can be excluded — the view
          // doesn't expose transitioned_at. "Styled in N looks" must not count a pulled look. (014)
          .from('gp_looks')
          .select('id, name, archived, thumbnail_url, raw, closet_item_ids')
          .eq('client_id', clientId)
          .is('transitioned_at', null)
          // Unique stable order is required for paginated .range() — without it the page boundary
          // skips/duplicates rows non-deterministically for clients with >1000 looks. (id = PK)
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error) { console.error('useItemLookUsage:', error.message); break }
        all.push(...((data ?? []) as Record<string, unknown>[]))
        if (!data || data.length < PAGE) break
      }
      if (cancelled) return

      const map = new Map<string, LookLite[]>()
      const seen = new Map<string, Set<string>>() // itemId → set of look ids already counted
      for (const l of all) {
        if (l.archived) continue
        const raw = (l.raw ?? {}) as Record<string, unknown>
        const rawImg = (l.thumbnail_url as string) ?? (raw.main_image_url as string) ?? null
        const lite: LookLite = {
          id: l.id as string,
          name: (l.name as string) || 'Untitled look',
          image: rawImg ? proxyImageUrl(rawImg) : null,
        }
        const ids = Array.isArray(l.closet_item_ids) ? (l.closet_item_ids as string[]) : []
        for (const itemId of ids) {
          if (!itemId) continue
          let s = seen.get(itemId)
          if (!s) { s = new Set(); seen.set(itemId, s) }
          if (s.has(lite.id)) continue // same item twice in one look → count the look once
          s.add(lite.id)
          const arr = map.get(itemId) ?? []
          arr.push(lite)
          map.set(itemId, arr)
        }
      }
      if (!cancelled) { setByItem(map); setLoading(false) }
    })()

    return () => { cancelled = true }
  }, [clientId])

  return { byItem, loading }
}
