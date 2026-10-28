import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { parentMapFrom, wouldCycle, withStandardNesting, standardNestingOn, isRequestRow, categoryKey, type NestingRow } from '@/lib/categoryNesting'
import { slugifyCategory, categoriesOf } from '@/lib/garmentCategory'
import { useClosetItems } from '@/hooks/useClosetItems'

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

/** A stored row: the tree's fields, plus `kind` and `is_hidden` for her saved categories. */
export type ClientCategoryRow = NestingRow & { kind?: string | null; is_hidden?: boolean | null; created_at?: string | null }

/** A client's request for a group, from her Collection (atelier-looks api/nesting-request.ts). */
export interface NestingRequest { slug: string; group: string; groupLabel: string; createdAt: string | null }

export function useClientCategories(clientId: string | null) {
  const [allRows, setRows] = useState<ClientCategoryRow[]>([])
  const [standardOn, setStandardOn] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The categories her pieces carry, for the standard set. The same shared read every closet screen
  // makes (react-query), so this costs nothing extra.
  const { items, tagNameById } = useClosetItems(clientId)

  const fetchAll = useCallback(async () => {
    if (!clientId) { setRows([]); setError(null); return }
    setLoading(true)
    const [{ data, error: e }, flag] = await Promise.all([
      supabase
        .from('client_categories')
        .select('slug, label, group_label, sort_order, same_as, kind, is_hidden, created_at')
        .eq('client_id', clientId)
        .order('sort_order')
        .order('slug'),
      supabase.from('gp_clients').select('standard_nesting:raw->standard_nesting').eq('id', clientId).maybeSingle(),
    ])
    setStandardOn(standardNestingOn(flag.data as any))
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
      same_as: r.same_as ?? null,
      kind: r.kind ?? null, is_hidden: r.is_hidden ?? false, created_at: r.created_at ?? null,
    })))
  }, [clientId])

  useEffect(() => { void fetchAll() }, [fetchAll])

  // Her requests live in the same table but are never her tree, and never one of her categories.
  const rows = useMemo(() => allRows.filter((r) => !isRequestRow(r)), [allRows])
  const requests = useMemo<NestingRequest[]>(() => allRows.filter((r) => isRequestRow(r)).map((r) => ({
    slug: r.slug.replace(/^request:/, ''), group: r.parent_slug ?? '', groupLabel: r.label ?? '', createdAt: r.created_at ?? null,
  })), [allRows])

  // THE STANDARD SET (2026-10-28, lib/categoryNesting.ts): every category her pieces carry that her
  // own rows say nothing about, unless she is kept on her hand-made nesting.
  const slugsInUse = useMemo(() => {
    const s = new Set<string>()
    if (!standardOn) return s
    for (const item of items) {
      const tags = (item.content_tag_ids ?? []).map((id: string) => tagNameById.get(id)).filter((n): n is string => !!n)
      for (const c of categoriesOf(item, tags)) s.add(c)
    }
    return s
  }, [items, tagNameById, standardOn])
  const parentBySlug = useMemo(() => parentMapFrom(withStandardNesting(rows, slugsInUse)), [rows, slugsInUse])

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
          // INSIDE and SAME AS are exclusive: putting a category inside another clears its same-as
          // (ADR-0163).
          same_as: null,
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

  /**
   * Make a category that exists only to be a group — one nobody has filed a piece under.
   * Julia's spreadsheet needs this: she wants Skirts under a heading, and "Bottoms" is
   * not a category anyone has ever tagged.
   */
  const createGroup = useCallback(async (label: string) => {
    if (!clientId) return { ok: false as const, message: 'No client selected.' }
    const name = label.trim()
    const slug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    if (!slug) return { ok: false as const, message: 'Give the group a name.' }
    const { data, error: e } = await supabase
      .from('client_categories')
      .upsert({ client_id: clientId, slug, label: name, group_label: null, kind: 'garment' }, { onConflict: 'client_id,slug' })
      .select('slug')
    if (e) return { ok: false as const, message: e.message }
    if (!data?.length) {
      return { ok: false as const, message: 'The database accepted the request but saved nothing. This usually means the write was refused.' }
    }
    await fetchAll()
    return { ok: true as const, slug }
  }, [clientId, fetchAll])

  /**
   * A Collection category with no pieces in it yet (Cynthia Dada, 2026-10-20), from the New
   * category box. Saved as kind 'custom' so the rail and the pickers can tell it from a row
   * Nesting or Same as wrote (lib/savedClosetCategories.ts).
   *
   * INSERT, NEVER UPSERT. An upsert on a slug that already has a row would overwrite its
   * placement (group_label, same_as). If the row is already there, nothing is written. A
   * category that already exists from her pieces or the standard list gets no row either, so
   * her site's label for it does not change; `existing` tells the caller to just show it.
   */
  const createSavedCategory = useCallback(async (label: string, existing: (slug: string) => boolean) => {
    if (!clientId) return { ok: false as const, message: 'No client selected.' }
    const name = label.trim()
    const slug = slugifyCategory(name)
    if (!slug) return { ok: false as const, message: 'Give the category a name.' }
    if (existing(slug)) return { ok: true as const, slug }
    const row = rows.find((r) => r.slug === slug)
    if (row && (row.kind === 'custom' || row.same_as || row.is_hidden)) return { ok: true as const, slug }
    // A row Nesting made (an empty group, say) becomes one of hers. Only `kind` changes.
    const { data, error: e } = row
      ? await supabase.from('client_categories').update({ kind: 'custom' }).eq('client_id', clientId).eq('slug', slug).select('slug')
      : await supabase
        .from('client_categories')
        .insert({ client_id: clientId, slug, label: name, group_label: null, kind: 'custom' })
        .select('slug')
    // 23505: the row was made by someone else since this screen loaded. It exists, which is the ask.
    if (e && e.code !== '23505') return { ok: false as const, message: e.message }
    if (!e && !data?.length) {
      return { ok: false as const, message: 'The database accepted the request but saved nothing. This usually means the write was refused.' }
    }
    await fetchAll()
    return { ok: true as const, slug }
  }, [clientId, rows, fetchAll])

  /**
   * SAME AS (ADR-0163): read this category as another one for this client ("handbags" as Handbags).
   * `target` null clears it, and the category is itself again. Clears any INSIDE placement, since a
   * category that IS another one cannot also sit under a third. Nothing on any piece is rewritten.
   */
  const setSameAs = useCallback(async (slug: string, target: string | null, label?: string) => {
    if (!clientId) return { ok: false as const, message: 'No client selected.' }
    const child = slug.trim().toLowerCase()
    const as = target ? target.trim().toLowerCase() : null
    if (!child) return { ok: false as const, message: 'No category given.' }
    if (as === child) return { ok: false as const, message: 'A category cannot be the same as itself.' }
    const { data, error: e } = await supabase
      .from('client_categories')
      .upsert(
        { client_id: clientId, slug: child, label: label ?? child, same_as: as, group_label: null, kind: 'garment' },
        { onConflict: 'client_id,slug' },
      )
      .select('slug, same_as')
    if (e) return { ok: false as const, message: e.message }
    if (!data?.length) {
      return { ok: false as const, message: 'The database accepted the request but saved nothing. This usually means the write was refused.' }
    }
    await fetchAll()
    return { ok: true as const }
  }, [clientId, fetchAll])

  /** Remove her request rows (after applying them, or when the stylist decides against it). */
  const dismissRequest = useCallback(async (slugs: string[]) => {
    if (!clientId) return { ok: false as const, message: 'No client selected.' }
    const { data, error: e } = await supabase
      .from('client_categories')
      .delete()
      .eq('client_id', clientId)
      .eq('kind', 'request')
      .in('slug', slugs.map((s) => `request:${s}`))
      .select('slug')
    if (e) return { ok: false as const, message: e.message }
    // A refused delete is a 200 with nothing in it (ADR-0108).
    if (!data?.length) return { ok: false as const, message: 'The request could not be removed. This usually means the write was refused.' }
    await fetchAll()
    return { ok: true as const }
  }, [clientId, fetchAll])

  /**
   * Her request, applied: each category goes inside the group (a real row, as if the stylist had
   * done it by hand), then the request rows are removed. A group that is not one of her categories
   * yet is made first, so it reads the way she wrote it.
   */
  const applyRequest = useCallback(async (group: string, groupLabel: string, slugs: string[], labelOf: (slug: string) => string) => {
    if (!clientId) return { ok: false as const, message: 'No client selected.' }
    if (!rows.some((r) => categoryKey(r.slug) === categoryKey(group)) && !slugsInUse.has(group)) {
      const made = await createGroup(groupLabel || group)
      if (!made.ok) return made
    }
    const failed: string[] = []
    for (const slug of slugs) {
      const res = await setParent(slug, group, labelOf(slug))
      if (!res.ok) failed.push(`${labelOf(slug)}: ${res.message}`)
    }
    if (failed.length) return { ok: false as const, message: `Could not move ${failed.join('; ')}` }
    return dismissRequest(slugs)
  }, [clientId, rows, slugsInUse, createGroup, setParent, dismissRequest])

  return { rows, requests, standardOn, parentBySlug, loading, error, setParent, setSameAs, createGroup, createSavedCategory, applyRequest, dismissRequest, refetch: fetchAll }
}
