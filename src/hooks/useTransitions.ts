import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { proxyImageUrl } from '@/lib/images'
import { lookImageUrl } from '@/lib/lookImage'
import { r2ImageUrl } from '@/lib/imageUrls'
import { planBuilderRestyle, type OmittedPiece } from '@/lib/restyleSelection'
import { measurePieces } from '@/lib/measurePieces'
import { buildGoodPixBoard } from '@/lib/goodpixBoard'
import type { LookCanvasState } from '@/types/canvas'

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
  closetItemIds: string[]  // everything it is built from (the restyle starts from the ones she still owns)
  source: string | null    // builder = restyle in place; goodpix = rebuild as a replacement (ADR-0076)
  transitionedAt: string | null
  /**
   * The GoodPix board this look was composed on. Two pulled looks on one board are the same
   * picture and the same work — 47 of Alicia Hidalgo's 235 cards were duplicates of each other
   * on 2026-09-17 — so the queue collapses them into one card. See lib/transitionQueue.ts.
   */
  boardId: string | null
}

function itemImage(row: any): string | null {
  // Intake (digitized) items are R2 keys served through the image-proxy Edge Function;
  // GoodPix items carry a direct URL in raw. Mirrors useClosetItems' resolution.
  if (row.source === 'intake_pipeline') {
    const key = row.processed_image_hash ?? row.primary_image_hash
    if (key) return r2ImageUrl(key)
  }
  const raw = row.raw ?? {}
  return raw.processed_image ?? raw.image ?? raw.images?.[0] ?? null
}

/**
 * WHAT EACH CARD NAMES: the pieces IN THE LOOK'S PICTURE that she has let go of. Exactly what
 * Restyle takes off, because both ask the same function.
 *
 * Paige Berndt, 2026-10-28, Danielle York Look 155: the card named a Chanel Sheer Mesh dress
 * "that piece as you can see, is not part of the look", and Restyle took off pieces the card never
 * named. The card used to read `transitioned_item_ids`, which is stamped from `closet_item_ids`
 * when a piece goes out, and that list also holds pieces parked off the side of the board. Now:
 *  - an Atelier look asks planBuilderRestyle over its saved board (photos measured only for the
 *    few pieces whose corner sits just outside the board);
 *  - a GoodPix look asks buildGoodPixBoard, the board its Restyle opens.
 * `transitioned_item_ids` stays what it is (why the look is down, lib/lookTransitions.ts).
 */
async function pulledLooksWithCauses(rows: any[], items: TransitionedItem[]): Promise<TransitionedLook[]> {
  const letGoById = new Map(items.map((i) => [i.id, i]))
  const letGo = (id: string): OmittedPiece | null => {
    const p = letGoById.get(id)
    return p ? { id: p.id, name: p.name, brand: p.brand, reason: 'transitioned' } : null
  }

  const plans = new Map<string, ReturnType<typeof planBuilderRestyle>>()
  const toMeasure = new Set<string>()
  for (const l of rows) {
    if (l.source !== 'builder' || !l.canvas_state?.nodes) continue
    const plan = planBuilderRestyle(l.canvas_state as LookCanvasState, letGo)
    plans.set(l.id, plan)
    plan.unknown.forEach((id) => toMeasure.add(id))
  }
  if (toMeasure.size) {
    const sizes = await measurePieces([...toMeasure])
    for (const l of rows) {
      if (plans.get(l.id)?.unknown.length) plans.set(l.id, planBuilderRestyle(l.canvas_state as LookCanvasState, letGo, sizes))
    }
  }

  const goodpix = new Map<string, string[]>()
  const gpRows = rows.filter((l) => l.source !== 'builder')
  for (let i = 0; i < gpRows.length; i += 6) {   // a few at a time: each reads the layout and its pieces
    await Promise.all(gpRows.slice(i, i + 6).map(async (l) => {
      try {
        const board = await buildGoodPixBoard(l.id, Array.isArray(l.closet_item_ids) ? l.closet_item_ids : [])
        const inPicture = board.omitted.filter((o) => o.reason === 'transitioned').map((o) => o.id)
        // A picture on the board we could not match to one of her pieces may BE the let-go piece
        // (Angela McPartlin Look 120: the SLVRLAKE jeans are in the picture, unmatched). Then the
        // recorded pieces stay on the card too: naming one too many beats hiding one.
        const recorded: string[] = Array.isArray(l.transitioned_item_ids) ? l.transitioned_item_ids : []
        goodpix.set(l.id, board.pictures > 0 ? [...new Set([...inPicture, ...recorded])] : inPicture)
      } catch (e) {
        console.error('transitions: could not read the board of', l.id, e)   // the card keeps the recorded pieces
      }
    }))
  }

  return rows.map((l: any) => {
    const rawImg = lookImageUrl(l.raw)
    const recorded: string[] = Array.isArray(l.transitioned_item_ids) ? l.transitioned_item_ids : []
    const inPicture = plans.get(l.id)?.omitted.map((o) => o.id) ?? goodpix.get(l.id) ?? recorded
    return {
      id: l.id,
      name: l.name ?? 'Untitled Look',
      image: rawImg ? proxyImageUrl(rawImg) : null,
      causeItemIds: inPicture,
      closetItemIds: Array.isArray(l.closet_item_ids) ? l.closet_item_ids : [],
      source: l.source ?? null,
      transitionedAt: l.transitioned_at ?? null,
      boardId: l.source_board_id ?? null,
    }
  })
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
          // canvas_state IS selected now: the card names the pieces in the PICTURE, and only the
          // board knows what is in it (lib/restyleSelection.ts planBuilderRestyle). 463 KB for
          // Danielle York's 87 pulled looks, the most of any client on 2026-10-28.
          .select('id, name, raw, source, source_board_id, closet_item_ids, transitioned_at, transitioned_item_ids, canvas_state')
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
      const nextItems: TransitionedItem[] = (itemsRes.data ?? []).map((r: any) => ({
        id: r.id,
        name: (r.name_override?.trim() || r.name) ?? 'Untitled item',
        brand: r.brand && r.brand !== 'None' ? r.brand : null,
        reason: r.transition_reason ?? null,
        source: r.transition_source ?? null,
        transitionedAt: r.transitioned_at ?? null,
        image: itemImage(r),
      }))
      let nextLooks: TransitionedLook[]
      try {
        nextLooks = await pulledLooksWithCauses(looksRes.data ?? [], nextItems)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'load failed')
        setLoading(false)
        return
      }
      if (cancelled) return
      setItems(nextItems)
      setLooks(nextLooks)
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
   *
   * Takes a LIST because one card can cover several looks: a GoodPix board with two identical
   * pulled looks on it is one decision, and retiring half of it would leave the twin sitting in
   * the queue as a card she has already answered. See lib/transitionQueue.ts.
   *
   * Asks for the rows back and checks the count. An update RLS declines comes back HTTP 200 with
   * an empty body and no error (ADR-0108), so a refused retire would otherwise read as done.
   */
  const retireLooks = useCallback(async (lookIds: string[]) => {
    if (!clientId || lookIds.length === 0) return
    const done = new Set<string>()
    for (let i = 0; i < lookIds.length; i += 50) {   // a big .in() write fails silently: chunk it
      const chunk = lookIds.slice(i, i + 50)
      const { data, error } = await supabase
        .from('gp_looks')
        .update({ archived: true, published: false, transitioned_at: null, transitioned_item_ids: null })
        .in('id', chunk).eq('client_id', clientId)
        .select('id')
      if (error) throw error
      for (const r of data ?? []) done.add(r.id)
    }
    if (done.size !== lookIds.length) {
      const missed = lookIds.filter((id) => !done.has(id))
      throw new Error(`retired ${done.size} of ${lookIds.length} looks; the database refused ${missed.join(', ')}`)
    }
    refetch()
  }, [clientId, refetch])

  return { items, looks, loading, error, refetch, transitionOut, restoreItem, retireLooks }
}
