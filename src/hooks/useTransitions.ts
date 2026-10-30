import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { proxyImageUrl } from '@/lib/images'
import { lookImageUrl } from '@/lib/lookImage'
import { r2ImageUrl } from '@/lib/imageUrls'
import { builderBoardPlan, lookCandidateIds, piecesOutOfLook, type LookPiece, type OutLook } from '@/lib/lookOutPieces'
import type { OmitReason } from '@/lib/restyleSelection'
import { measurePieces } from '@/lib/measurePieces'
import type { GpLayout } from '@/lib/goodpixLayout'
import type { CanvasNode, LookCanvasState } from '@/types/canvas'

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

/** A piece the card names: one the look is missing because she no longer has it. */
export interface MissingPiece {
  id: string
  name: string
  brand: string | null
  reason: OmitReason
  source: string | null   // client | stylist, for a transitioned piece
  transitionedAt: string | null
  image: string | null
}

export interface TransitionedLook {
  id: string
  name: string
  image: string | null
  /**
   * Every piece the look is missing, the same list the opened look shows (lib/lookOutPieces.ts).
   * Not only the recorded causes: `transitioned_item_ids` keeps just the LATEST transition that
   * pulled the look, so pieces transitioned earlier were left off the card (Paige Berndt,
   * 2026-11-10). Falls back to the recorded causes if the pieces could not be read.
   */
  causeItemIds: string[]
  missing: MissingPiece[]
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

type CardPiece = LookPiece & { clientId: string; transitionSource: string | null; image: string | null }

/** The pieces the cards may name, read the way the opened look reads them. null if a read failed. */
async function readLookPieces(ids: string[]): Promise<Map<string, CardPiece> | null> {
  const out = new Map<string, CardPiece>()
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200))   // a big .in() fails silently: chunk it
  const results = await Promise.all(chunks.map((chunk) => supabase
    .from('gp_closet_items')
    .select('id, client_id, name, name_override, brand, transitioned_at, transition_source, is_deleted, deleted_at, source, primary_image_hash, processed_image_hash, image:raw->image, processed_image:raw->processed_image, images:raw->images')
    .in('id', chunk)))
  for (const { data, error } of results) {
    if (error) return null
    for (const r of (data ?? []) as any[]) {
      const raw = { image: r.image, processed_image: r.processed_image, images: r.images }
      out.set(r.id, {
        id: r.id,
        clientId: r.client_id,
        name: (r.name_override?.trim() || r.name) ?? 'Untitled piece',
        brand: r.brand && r.brand !== 'None' ? r.brand : null,
        transitionedAt: r.transitioned_at ?? null,
        transitionSource: r.transition_source ?? null,
        isDeleted: r.is_deleted ?? null,
        deletedAt: r.deleted_at ?? null,
        // The same addresses lib/goodpixBoard.ts matches a picture against.
        urls: [raw.image, raw.processed_image, ...(Array.isArray(raw.images) ? raw.images : [])].filter((u: unknown): u is string => typeof u === 'string'),
        image: itemImage({ ...r, raw }),
      })
    }
  }
  return out
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
          // canvas_state is deliberately NOT selected whole: it is large, and only the one look a
          // stylist actually opens needs it (single-row fetch on demand, per ADR-0076). Its piece
          // nodes, the board's size and the GoodPix arrangement are, because the card has to name
          // the same missing pieces the opened look does (lib/lookOutPieces.ts): about 1 MB for
          // Alicia Hidalgo's 206 pulled looks, the largest queue on the platform.
          .select('id, name, raw, source, source_board_id, closet_item_ids, transitioned_at, transitioned_item_ids, gp_layout, board_nodes:canvas_state->nodes, board_size:canvas_state->canvas')
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
      const lookRows = (looksRes.data ?? []) as any[]
      const outLooks = new Map<string, OutLook>(lookRows.map((l) => [l.id, {
        source: l.source ?? null,
        closetItemIds: Array.isArray(l.closet_item_ids) ? l.closet_item_ids : [],
        layout: (l.gp_layout ?? null) as GpLayout | null,
        boardNodes: Array.isArray(l.board_nodes) ? (l.board_nodes as CanvasNode[]) : null,
        board: (l.board_size ?? null) as LookCanvasState['canvas'] | null,
      }]))
      // Every piece any card could name, as it stands now. A failed read leaves the cards on the
      // recorded causes rather than claiming a look is missing nothing.
      const pieces = await readLookPieces([...new Set([...outLooks.values()].flatMap(lookCandidateIds))])
      if (cancelled) return
      // A GoodPix board is matched against her own pieces only (lib/goodpixBoard.ts readPieces).
      const hers = pieces && new Map([...pieces].filter(([, p]) => p.clientId === clientId))
      // An Atelier card names only the let-go pieces IN THE PICTURE, as its Restyle takes off
      // (Paige Berndt, 2026-10-28, Danielle York Look 155). The few pieces whose corner sits just
      // past an edge have their photo measured first, the same as CategorizePanel's Restyle.
      if (pieces) {
        const toMeasure = new Set<string>()
        for (const out of outLooks.values()) builderBoardPlan(out, pieces)?.unknown.forEach((id) => toMeasure.add(id))
        if (toMeasure.size) {
          const sizes = await measurePieces([...toMeasure])
          if (cancelled) return
          for (const out of outLooks.values()) if (out.source === 'builder') out.sizes = sizes
        }
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
      setLooks(lookRows.map((l: any) => {
        const rawImg = lookImageUrl(l.raw)
        const causes: string[] = Array.isArray(l.transitioned_item_ids) ? l.transitioned_item_ids : []
        const out = outLooks.get(l.id)!
        const read = out.source === 'builder' ? pieces : hers
        const missing: MissingPiece[] = read
          ? piecesOutOfLook(out, read).map((o) => {
            const p = read.get(o.id)
            return {
              id: o.id, name: o.name, brand: o.brand, reason: o.reason,
              source: p?.transitionSource ?? null,
              transitionedAt: p?.transitionedAt ?? null,
              image: p?.image ?? null,
            }
          })
          : []
        return {
          id: l.id,
          name: l.name ?? 'Untitled Look',
          image: rawImg ? proxyImageUrl(rawImg) : null,
          // A board read in full is the answer, even when nothing in its picture is gone: the
          // recorded causes may be pieces parked off the side of it.
          causeItemIds: missing.length || (read && out.source === 'builder' && out.boardNodes) ? missing.map((m) => m.id) : causes,
          missing,
          closetItemIds: out.closetItemIds,
          source: l.source ?? null,
          transitionedAt: l.transitioned_at ?? null,
          boardId: l.source_board_id ?? null,
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
