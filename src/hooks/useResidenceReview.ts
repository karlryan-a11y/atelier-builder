import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { residenceOfItem, type ResidenceSlug } from '@/lib/residences'

/**
 * The residence review queue for a multi-residence client.
 *
 * Filing a back-catalogue of looks by home is slow, so each unfiled look carries a
 * PROPOSAL the stylist confirms or corrects. Two independent signals sit on every
 * card, and they fail in different places, which is the point of showing both:
 *
 *  1. `proposal` — an offline vision pass that read the look's composed image.
 *     Validated against 40 known-answer looks: high confidence was 18/18 correct,
 *     medium only 10/19. It reads ski gear and beach dressing reliably and cannot
 *     tell mountain evening wear from city evening wear, because the garments are
 *     genuinely the same.
 *
 *  2. `provenance` — how many pieces IN the look the stylist has already placed in
 *     a residence herself. Derived live from the collection rather than stored, so
 *     it stays true as she refiles pieces. This is the signal that can see Aspen,
 *     precisely where the image cannot.
 *
 * Accepting writes to `look_category_assignments` — the same row a chip click makes
 * — so nothing downstream (lookbook, publish gate, counts) learns a new concept.
 */

export interface ResidenceProposal {
  lookId: string
  slugs: ResidenceSlug[]
  confidence: 'high' | 'medium' | 'low'
  reason: string | null
}

/** Per-residence count of pieces in a look the stylist already placed in that home. */
export type Provenance = Partial<Record<ResidenceSlug, number>>

export function useResidenceReview(clientId: string | null) {
  const [proposals, setProposals] = useState<Map<string, ResidenceProposal>>(new Map())
  const [itemResidence, setItemResidence] = useState<Map<string, ResidenceSlug[]>>(new Map())
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    if (!clientId) { setProposals(new Map()); setItemResidence(new Map()); return }
    setLoading(true)

    const [propRes, itemRes] = await Promise.all([
      supabase
        .from('look_residence_proposals')
        .select('look_id, proposed_slugs, confidence, reason')
        .eq('client_id', clientId)
        .is('resolved_at', null),
      // PostgREST caps every query at 1000 rows; a large wardrobe would silently
      // truncate and quietly under-report provenance, so page to exhaustion.
      (async () => {
        const all: any[] = []
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase
            .from('gp_closet_items')
            .select('id, category, custom_categories')
            .eq('client_id', clientId)
            .range(from, from + 999)
          if (error) { console.error('useResidenceReview items:', error.message); break }
          if (!data?.length) break
          all.push(...data)
          if (data.length < 1000) break
        }
        return all
      })(),
    ])

    if (propRes.error) console.error('useResidenceReview proposals:', propRes.error.message)

    setProposals(new Map((propRes.data ?? []).map((r: any) => [r.look_id, {
      lookId: r.look_id,
      slugs: (r.proposed_slugs ?? []) as ResidenceSlug[],
      confidence: r.confidence,
      reason: r.reason,
    }])))

    const placed = new Map<string, ResidenceSlug[]>()
    for (const it of itemRes) {
      const res = residenceOfItem(it)
      if (res.length) placed.set(it.id, res)
    }
    setItemResidence(placed)
    setLoading(false)
  }, [clientId])

  useEffect(() => { fetchAll() }, [fetchAll])

  /** How many pieces in this look the stylist has already placed, per residence. */
  const provenanceFor = useCallback((closetItemIds: string[]): Provenance => {
    const out: Provenance = {}
    for (const id of closetItemIds) {
      for (const slug of itemResidence.get(id) ?? []) out[slug] = (out[slug] ?? 0) + 1
    }
    return out
  }, [itemResidence])

  /** Number of pieces in the look that carry any placement at all. */
  const placedCount = useCallback((closetItemIds: string[]) =>
    closetItemIds.filter((id) => itemResidence.has(id)).length, [itemResidence])

  const markResolved = useCallback(async (lookId: string, by: string) => {
    const { error } = await supabase
      .from('look_residence_proposals')
      .update({ resolved_at: new Date().toISOString(), resolved_by: by })
      .eq('look_id', lookId)
    if (error) { console.error('markResolved:', error.message); return false }
    setProposals((prev) => { const n = new Map(prev); n.delete(lookId); return n })
    return true
  }, [])

  /**
   * File the look under `categoryIds` and take it out of the queue. `assign` is the
   * caller's existing assignLook, so the accepted answer travels the ordinary
   * tagging path and the panel's optimistic state updates with it.
   */
  const accept = useCallback(async (
    lookId: string,
    categoryIds: string[],
    assign: (lookId: string, categoryId: string, on: boolean) => void | Promise<void>,
    by = 'stylist',
  ) => {
    if (categoryIds.length === 0) return
    setBusy(lookId)
    try {
      for (const cid of categoryIds) await assign(lookId, cid, true)
      await markResolved(lookId, by)
    } finally {
      setBusy(null)
    }
  }, [markResolved])

  /** Take it out of the queue without filing it — "I'll decide this one later, elsewhere." */
  const dismiss = useCallback(async (lookId: string) => {
    setBusy(lookId)
    try { await markResolved(lookId, 'stylist:dismissed') } finally { setBusy(null) }
  }, [markResolved])

  const openCount = proposals.size
  const byConfidence = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0 }
    for (const p of proposals.values()) c[p.confidence]++
    return c
  }, [proposals])

  return {
    loading, busy, proposals, openCount, byConfidence,
    provenanceFor, placedCount, accept, dismiss, refetch: fetchAll,
  }
}
