import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { proxyImageUrl } from '@/lib/images'
import { lookImageUrl } from '@/lib/lookImage'
import { useStyleRefreshStore } from '@/hooks/useStyleTabRefresh'

// A light record of a look for the "styled in" popup — just what we need to show it.
//
// `published` is load-bearing, not decoration: styledCoverage() counts a piece as styled ONLY if
// one of its looks is published, so dropping this column from the SELECT below would silently
// promote every draft look to "styled" and inflate the number on every client. That is ADR-0103
// exactly (a column left out of a SELECT answers every question with undefined), so
// scripts/check-styled-coverage.mjs asserts the column is still selected.
export interface LookLite { id: string; name: string; image: string | null; published: boolean }

// Builds a reverse index: closet_item_id → the looks that item appears in. Reads EVERY one of the
// client's looks (both 'goodpix' imports and 'builder' looks — the app's other looks hook filters
// to 'builder' only, which would badly undercount), excludes archived, and dedupes so an item
// placed twice on one board still counts that look once. Read-only; no writes.
export function useItemLookUsage(clientId: string | null) {
  const [byItem, setByItem] = useState<Map<string, LookLite[]>>(new Map())
  const [loading, setLoading] = useState(false)
  // Set when a page of the read FAILED. The map is then incomplete, so "styled in N looks"
  // would undercount; callers can tell a real zero from a failed read.
  const [error, setError] = useState<string | null>(null)
  // Re-read in the background when Categorize comes back into view: a look saved on the canvas
  // changes which pieces are styled (hooks/useStyleTabRefresh.ts). The map on screen stays until
  // the new one replaces it.
  const epoch = useStyleRefreshStore((s) => s.categorizeEpoch)

  useEffect(() => {
    if (!clientId) { setByItem(new Map()); setError(null); return }
    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      // Paginate against PostgREST's 1000-row cap so a heavily-styled client can't silently truncate.
      const all: Record<string, unknown>[] = []
      let failed: string | null = null
      const PAGE = 1000
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          // gp_looks base (not the `looks` view) so transitioned looks can be excluded — the view
          // doesn't expose transitioned_at. "Styled in N looks" must not count a pulled look. (014)
          .from('gp_looks')
          .select('id, name, archived, published, raw, closet_item_ids')
          .eq('client_id', clientId)
          .is('transitioned_at', null)
          // Unique stable order is required for paginated .range() — without it the page boundary
          // skips/duplicates rows non-deterministically for clients with >1000 looks. (id = PK)
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error) { console.error('useItemLookUsage:', error.message); failed = error.message || 'load failed'; break }
        all.push(...((data ?? []) as Record<string, unknown>[]))
        if (!data || data.length < PAGE) break
      }
      if (cancelled) return

      const map = new Map<string, LookLite[]>()
      const seen = new Map<string, Set<string>>() // itemId → set of look ids already counted
      for (const l of all) {
        if (l.archived) continue
        const rawImg = lookImageUrl(l.raw)
        const lite: LookLite = {
          id: l.id as string,
          name: (l.name as string) || 'Untitled look',
          image: rawImg ? proxyImageUrl(rawImg) : null,
          published: l.published === true,
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
      if (!cancelled) { setByItem(map); setError(failed); setLoading(false) }
    })()

    return () => { cancelled = true }
  }, [clientId, epoch])

  // "NOT IN THIS LOOK" (Cynthia, 2026-10-08, Holly McClellan's J.Crew Print Dress listed under
  // Looks 47 and 48 that do not show it: GoodPix saved those looks with the whole board's piece
  // list). Takes ONE piece off ONE look's list. The look, its picture and the piece are untouched.
  // Returns an error message, or null when it saved.
  const removeItemFromLook = useCallback(async (lookId: string, itemId: string): Promise<string | null> => {
    const { data: cur, error: rErr } = await supabase.from('gp_looks').select('closet_item_ids').eq('id', lookId).maybeSingle()
    if (rErr || !cur) return rErr?.message ?? 'look not found'
    const ids: string[] = Array.isArray(cur.closet_item_ids) ? cur.closet_item_ids : []
    if (ids.includes(itemId)) {
      const next = ids.filter((i) => i !== itemId)
      const { data: written, error } = await supabase.from('gp_looks')
        .update({ closet_item_ids: next.length ? next : null }).eq('id', lookId).select('id')
      if (error) return error.message
      if (!written?.length) return 'not saved'
    }
    // Every other copy of this map (Canvas "Still to style", its styled marks) re-reads too.
    useStyleRefreshStore.getState().bumpCategorize()
    setByItem((prev) => {
      const m = new Map(prev)
      const left = (m.get(itemId) ?? []).filter((l) => l.id !== lookId)
      if (left.length) m.set(itemId, left); else m.delete(itemId)
      return m
    })
    return null
  }, [])

  return { byItem, loading, error, removeItemFromLook }
}
