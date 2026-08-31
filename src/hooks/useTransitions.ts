import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { proxyImageUrl } from '@/lib/images'

// The Transitions tab: pieces a client (or stylist) marked "no longer owned", and the looks
// that were pulled from the lookbook because they used one of those pieces. Restore returns a
// piece and re-publishes any look no OTHER transitioned piece still holds back. See migration 014.

export interface TransitionedItem {
  id: string
  name: string
  brand: string | null
  reason: string | null   // donated | sold | discarded | unspecified
  source: string | null   // client | stylist
  transitionedAt: string | null
  image: string | null
}

export interface TransitionedLook {
  id: string
  name: string
  image: string | null
  causeItemIds: string[]   // which transitioned pieces pulled this look
  closetItemIds: string[]  // everything it is built from (the restyle starts from these minus the causes)
  source: string | null    // builder = restyle in place; goodpix = rebuild as a replacement (ADR-0076)
  transitionedAt: string | null
}

function itemImage(row: any): string | null {
  // Intake (digitized) items are R2 keys served through the image-proxy Edge Function;
  // GoodPix items carry a direct URL in raw. Mirrors useClosetItems' resolution.
  if (row.source === 'intake_pipeline') {
    const key = row.processed_image_hash ?? row.primary_image_hash
    if (key) return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/image-proxy?key=${encodeURIComponent(key)}`
  }
  const raw = row.raw ?? {}
  return raw.processed_image ?? raw.image ?? raw.images?.[0] ?? null
}

export function useTransitions(clientId: string | null) {
  const [items, setItems] = useState<TransitionedItem[]>([])
  const [looks, setLooks] = useState<TransitionedLook[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const bg = useRef(false)

  useEffect(() => {
    if (!clientId) { setItems([]); setLooks([]); return }
    let cancelled = false
    const background = bg.current
    bg.current = false
    if (!background) setLoading(true)
    setError(null)

    ;(async () => {
      const [itemsRes, looksRes] = await Promise.all([
        supabase.from('gp_closet_items')
          .select('id, name, name_override, brand, transitioned_at, transition_reason, transition_source, raw, primary_image_hash, processed_image_hash, source')
          .eq('client_id', clientId)
          .not('transitioned_at', 'is', null)
          .order('transitioned_at', { ascending: false }),
        supabase.from('gp_looks')
          // canvas_state is deliberately NOT selected: it is large, and only the one look a
          // stylist actually opens needs it (single-row fetch on demand, per ADR-0076).
          .select('id, name, thumbnail_url, raw, source, closet_item_ids, transitioned_at, transitioned_item_ids')
          .eq('client_id', clientId)
          .not('transitioned_at', 'is', null)
          .order('transitioned_at', { ascending: false }),
      ])
      if (cancelled) return
      if (itemsRes.error || looksRes.error) {
        setError(itemsRes.error?.message ?? looksRes.error?.message ?? 'load failed')
        setLoading(false)
        return
      }
      setItems((itemsRes.data ?? []).map((r: any) => ({
        id: r.id,
        name: (r.name_override?.trim() || r.name) ?? 'Untitled item',
        brand: r.brand && r.brand !== 'None' ? r.brand : null,
        reason: r.transition_reason ?? null,
        source: r.transition_source ?? null,
        transitionedAt: r.transitioned_at ?? null,
        image: itemImage(r),
      })))
      setLooks((looksRes.data ?? []).map((l: any) => {
        const rawImg = l.raw?.main_image_url ?? l.thumbnail_url ?? null
        return {
          id: l.id,
          name: l.name ?? 'Untitled Look',
          image: rawImg ? proxyImageUrl(rawImg) : null,
          causeItemIds: Array.isArray(l.transitioned_item_ids) ? l.transitioned_item_ids : [],
          closetItemIds: Array.isArray(l.closet_item_ids) ? l.closet_item_ids : [],
          source: l.source ?? null,
          transitionedAt: l.transitioned_at ?? null,
        }
      }))
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [clientId, tick])

  const refetch = useCallback(() => { bg.current = true; setTick((t) => t + 1) }, [])

  // Stylist marks a piece out (e.g. during an in-person closet edit). Same effect as the client
  // action: pull the piece and every look styled with it. Writes run under the stylist JWT (staff
  // can update any client's rows). Mirrors atelier-looks /api/transition action 'out'.
  const transitionOut = useCallback(async (itemId: string, reason = 'unspecified') => {
    if (!clientId) return
    const now = new Date().toISOString()
    const { data: affected, error: lErr } = await supabase
      .from('gp_looks')
      .select('id, transitioned_at, transitioned_item_ids')
      .eq('client_id', clientId)
      .contains('closet_item_ids', [itemId])
    if (lErr) throw lErr
    for (const lk of affected ?? []) {
      const ids = new Set<string>([...(lk.transitioned_item_ids ?? []), itemId])
      const { error } = await supabase.from('gp_looks')
        .update({ transitioned_at: lk.transitioned_at ?? now, transitioned_item_ids: [...ids] })
        .eq('id', lk.id).eq('client_id', clientId)
      if (error) throw error
    }
    const { error: uErr } = await supabase.from('gp_closet_items')
      .update({ transitioned_at: now, transition_reason: reason, transition_source: 'stylist' })
      .eq('id', itemId).eq('client_id', clientId)
    if (uErr) throw uErr
    refetch()
  }, [clientId, refetch])

  // Restore a piece and re-publish looks it was the LAST remaining cause for.
  const restoreItem = useCallback(async (itemId: string) => {
    if (!clientId) return
    const { data: affected, error: lErr } = await supabase
      .from('gp_looks')
      .select('id, transitioned_at, transitioned_item_ids')
      .eq('client_id', clientId)
      .contains('transitioned_item_ids', [itemId])
    if (lErr) throw lErr
    const { error: rErr } = await supabase.from('gp_closet_items')
      .update({ transitioned_at: null, transition_reason: null, transition_source: null })
      .eq('id', itemId).eq('client_id', clientId)
    if (rErr) throw rErr
    for (const lk of affected ?? []) {
      const remaining = (lk.transitioned_item_ids ?? []).filter((id: string) => id !== itemId)
      const stillDown = remaining.length > 0
      const { error } = await supabase.from('gp_looks')
        .update({
          transitioned_at: stillDown ? lk.transitioned_at : null,
          transitioned_item_ids: remaining.length ? remaining : null,
        })
        .eq('id', lk.id).eq('client_id', clientId)
      if (error) throw error
    }
    refetch()
  }, [clientId, refetch])

  /**
   * Retire a pulled look for good, instead of restyling it. Maegan, 2026-08-31: "It's rare that
   * we'll want a full look deleted" — rare, not never, and until now there was no way to say so,
   * which is why a look nobody intended to keep still sat in the queue five weeks later.
   *
   * Archive, not delete: it leaves the lookbook and the Transitions queue but the row survives
   * and Restore brings it back. Clearing the transition columns is what lifts it out of the
   * queue; leaving them set would archive it and still show it as outstanding work.
   */
  const retireLook = useCallback(async (lookId: string) => {
    if (!clientId) return
    const { error } = await supabase
      .from('gp_looks')
      .update({ archived: true, published: false, transitioned_at: null, transitioned_item_ids: null })
      .eq('id', lookId).eq('client_id', clientId)
    if (error) throw error
    refetch()
  }, [clientId, refetch])

  return { items, looks, loading, error, refetch, transitionOut, restoreItem, retireLook }
}
