import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { parentMapFrom, wouldCycle, type NestingRow } from '@/lib/categoryNesting'

/**
 * The client's closet-category tree — `client_categories`. (ADR-0113)
 *
 * STORED IN `group_label`, NOT a new column. Migration 006 created that field as
 * "display-only section header (Clothing/Accessories/...)", which is the same question
 * a parent answers: which group does this category sit in. It is nullable, it has never
 * been read or written, and using it means this needed no DDL at all — which is what let
 * it ship while the database password was unavailable.
 *
 * The in-memory field is still called `parent_slug`, because that is what it means. The
 * translation happens here and in atelier-looks' `getClientCategories`, and nowhere else.
 * If a properly named column is ever added, those two places change and nothing else does.
 *
 * FIRST READER AND WRITER THIS TABLE HAS EVER HAD. Migration 006 created it in June
 * with slug/label/kind/group_label/sort_order/is_hidden and a unique key on
 * (client_id, slug), and nothing in either repo has touched it since. It had zero
 * rows when this was written. Treat every assumption about it as unproven.
 *
 * NOT the same taxonomy as `look_categories` (migration 008, `useLookCategories`).
 * That one files LOOKS and capsules. This one files PIECES. They share almost every
 * word and nothing else — ADR-0099: a piece has two kinds of category and every
 * surface must say which.
 *
 * A row exists only for a category a stylist has said something about. A category
 * with no row is top level, which is every category on every client today, so a
 * client nobody has touched renders exactly as she does now.
 */

export type { NestingRow }

export function useClientCategories(clientId: string | null) {
  const [rows, setRows] = useState<NestingRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    if (!clientId) { setRows([]); setError(null); return }
    setLoading(true)
    const { data, error: e } = await supabase
      .from('client_categories')
      .select('slug, label, group_label, sort_order')
      .eq('client_id', clientId)
      .order('sort_order')
      .order('slug')
    setLoading(false)
    if (e) {
      // Never collapse a failed read into "she has no tree" — that reads as a client
      // with flat categories, which is indistinguishable from success and is exactly
      // how the 2026-06-24 outage hid (a missing column read as "no items").
      console.error('useClientCategories: read failed —', e.message)
      setError(e.message)
      return
    }
    setError(null)
    setRows((data ?? []).map((r: any) => ({
      slug: r.slug, label: r.label, parent_slug: r.group_label ?? null, sort_order: r.sort_order ?? 0,
    })))
  }, [clientId])

  useEffect(() => { void fetchAll() }, [fetchAll])

  const parentBySlug = useMemo(() => parentMapFrom(rows), [rows])

  /**
   * Nest `slug` under `parent`, or pass null to move it back to the top level.
   *
   * ASKS FOR THE ROW BACK. A write RLS declines comes back as HTTP 200 with an empty
   * body and no error (ADR-0108, measured against live), so a refused write reads as
   * a success and the stylist watches her dropdown change and save nothing. Zero rows
   * returned is treated as a failure here, and it is the likeliest failure on this
   * table specifically, because no policy on it has ever been exercised.
   */
  const setParent = useCallback(async (slug: string, parent: string | null, label?: string) => {
    if (!clientId) return { ok: false as const, message: 'No client selected.' }
    const child = slug.trim().toLowerCase()
    const next = parent ? parent.trim().toLowerCase() : null
    if (!child) return { ok: false as const, message: 'No category given.' }
    if (next && wouldCycle(child, next, parentBySlug)) {
      return { ok: false as const, message: `${label ?? child} already sits above that one.` }
    }

    const { data, error: e } = await supabase
      .from('client_categories')
      .upsert(
        {
          client_id: clientId,
          slug: child,
          label: label ?? child,
          group_label: next,
          // `kind` is NOT NULL with a default of 'garment' (migration 006). Sent
          // explicitly so an upsert that INSERTS does not depend on the default
          // surviving a future schema edit.
          kind: 'garment',
        },
        { onConflict: 'client_id,slug' },
      )
      .select('slug, label, group_label, sort_order')

    if (e) return { ok: false as const, message: e.message }
    if (!data?.length) {
      return {
        ok: false as const,
        message: 'The database accepted the request but saved nothing. This usually means the write was refused.',
      }
    }
    await fetchAll()
    return { ok: true as const }
  }, [clientId, parentBySlug, fetchAll])

  return { rows, parentBySlug, loading, error, setParent, refetch: fetchAll }
}
