import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { LookCanvasState } from '@/types/canvas'
import { planCategoryDeletion, type CategoryDeletionPlan } from '@/lib/categoryDeletion'

/**
 * Categorize + publish queue, on the ID-BASED taxonomy (migration 008):
 *   - look_categories(id, client_id, slug, label, sort_order, is_hidden, description)  — per-client taxonomy
 *   - look_category_assignments(look_id, category_id)                      — looks ↔ categories (M:N)
 *   - board_category_assignments(board_id, category_id)                    — capsules ↔ categories (M:N)
 *
 * Categories are assigned by ID, so renaming a category's label updates every
 * look/capsule in it with ONE row update (A5 bulk-rename), and categories persist
 * per-client (add/rename/reorder/hide). The legacy string `gp_looks.tags` /
 * `gp_boards.category_tags` are no longer the source of truth.
 *
 * Publish gate stays on gp_looks.published / gp_boards.published; archive on
 * gp_looks.archived / gp_boards.is_deleted.
 */

export interface LookCategory {
  id: string
  slug: string
  label: string
  sort_order: number
  is_hidden: boolean
  /**
   * Stylist-only note on how to style this category, e.g. "always a sports jacket, never
   * jeans" on Summit Club. Amaia asked for it: the rule lives in one stylist's head today,
   * so a second stylist covering her client cannot know it. NOT rendered on the client
   * lookbook — atelier-looks names its columns and never selects this one. (ADR-0110)
   */
  description: string | null
}
export interface TaggableLook {
  id: string
  name: string
  image: string | null
  categoryIds: string[]
  published: boolean
  archived: boolean
  sort_order: number | null
  // 'builder' looks carry a canvas_state and can be reopened for editing; 'goodpix' looks
  // are a flat scraped image + closet_item_ids and can only be REBUILT onto the canvas.
  source: string
  closetItemIds: string[]
}
export interface TaggableCapsule {
  id: string
  name: string
  image: string | null
  categoryIds: string[]
  published: boolean
  archived: boolean
  sort_order: number | null
  // Present only for capsules saved via the single-canvas "Save as Capsule" path
  // (useCapsules.saveCapsule writes it to raw.canvas_state). Capsules built via
  // "Capsule from Looks" (CreateCapsuleDialog) don't have one — those can't be
  // re-opened in the canvas, so the Edit action is hidden when this is null.
  canvasState: LookCanvasState | null
}

const slugify = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

export function useLookCategories(clientId: string | null) {
  const [categories, setCategories] = useState<LookCategory[]>([])
  const [looks, setLooks] = useState<TaggableLook[]>([])
  const [capsules, setCapsules] = useState<TaggableCapsule[]>([])
  const [loading, setLoading] = useState(false)

  const fetchAll = useCallback(async () => {
    if (!clientId) { setCategories([]); setLooks([]); setCapsules([]); return }
    setLoading(true)
    const [catsRes, looksRes, capsRes] = await Promise.all([
      supabase.from('look_categories')
        .select('id, slug, label, sort_order, is_hidden, description')
        .eq('client_id', clientId)
        .order('sort_order').order('label'),
      supabase.from('gp_looks')
        .select('id, name, thumbnail_url, raw, published, archived, sort_order, source, closet_item_ids')
        .eq('client_id', clientId)
        // Transitioned looks live in the Transitions tab, not the normal Looks/Queue grid. (migration 014)
        .is('transitioned_at', null)
        // Match the client lookbook's ordering so "On lookbook" == what she sees.
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase.from('gp_boards')
        .select('id, name, raw, published, is_deleted, sort_order')
        .eq('client_id', clientId)
        // Match the client lookbook's ordering so "On lookbook" == what she sees.
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false }),
    ])

    const lookIds = (looksRes.data ?? []).map((l: any) => l.id)
    const boardIds = (capsRes.data ?? []).map((b: any) => b.id)
    const [laRes, baRes] = await Promise.all([
      lookIds.length
        ? supabase.from('look_category_assignments').select('look_id, category_id').in('look_id', lookIds)
        : Promise.resolve({ data: [] as any[] }),
      boardIds.length
        ? supabase.from('board_category_assignments').select('board_id, category_id').in('board_id', boardIds)
        : Promise.resolve({ data: [] as any[] }),
    ])

    const byLook = new Map<string, string[]>()
    for (const r of (laRes.data ?? [])) {
      if (!byLook.has(r.look_id)) byLook.set(r.look_id, [])
      byLook.get(r.look_id)!.push(r.category_id)
    }
    const byBoard = new Map<string, string[]>()
    for (const r of (baRes.data ?? [])) {
      if (!byBoard.has(r.board_id)) byBoard.set(r.board_id, [])
      byBoard.get(r.board_id)!.push(r.category_id)
    }

    setCategories((catsRes.data ?? []) as LookCategory[])
    setLooks((looksRes.data ?? []).map((l: any) => ({
      id: l.id,
      name: l.name ?? 'Untitled Look',
      image: l.raw?.main_image_url ?? l.thumbnail_url ?? null,
      categoryIds: byLook.get(l.id) ?? [],
      published: !!l.published,
      archived: !!l.archived,
      sort_order: l.sort_order ?? null,
      source: l.source ?? 'goodpix',
      closetItemIds: (l.closet_item_ids as string[] | null) ?? [],
    })))
    setCapsules((capsRes.data ?? []).map((b: any) => ({
      id: b.id,
      name: b.name ?? 'Untitled Capsule',
      image: b.raw?.image_url ?? b.raw?.image ?? null,
      categoryIds: byBoard.get(b.id) ?? [],
      published: !!b.published,
      archived: !!b.is_deleted,
      sort_order: b.sort_order ?? null,
      canvasState: (b.raw?.canvas_state as LookCanvasState | undefined) ?? null,
    })))
    setLoading(false)
  }, [clientId])

  useEffect(() => { fetchAll() }, [fetchAll])

  const draftCount = useMemo(
    () => looks.filter((l) => !l.published && !l.archived).length
        + capsules.filter((c) => !c.published && !c.archived).length,
    [looks, capsules],
  )

  // ── category taxonomy (persistent, per-client) ──
  const createCategory = useCallback(async (label: string): Promise<LookCategory | null> => {
    const l = label.trim()
    if (!l || !clientId) return null
    const slug = slugify(l) || `cat-${Date.now()}`
    const existing = categories.find((c) => c.label.toLowerCase() === l.toLowerCase() || c.slug === slug)
    if (existing) return existing
    const sort_order = categories.length
    const { data, error } = await supabase.from('look_categories')
      .insert({ client_id: clientId, slug, label: l, sort_order })
      .select('id, slug, label, sort_order, is_hidden, description').single()
    if (error || !data) { console.error('createCategory:', error?.message); return null }
    setCategories((prev) => [...prev, data as LookCategory])
    return data as LookCategory
  }, [clientId, categories])

  /**
   * Delete a category, per planCategoryDeletion: refuse on a residence, hard-delete when
   * empty, hide when things are filed under it. Returns the plan so the caller can show the
   * stylist the same sentence the decision was made on.
   *
   * `confirm` is passed in rather than called here so the decision stays testable —
   * scripts/check-category-deletion.mjs exercises every branch without a browser.
   */
  const deleteCategory = useCallback(async (
    id: string,
    confirmWith: (message: string) => boolean,
    clientName?: string,
  ): Promise<CategoryDeletionPlan | null> => {
    const cat = categories.find((c) => c.id === id)
    if (!cat) return null
    const lookCount = looks.filter((l) => l.categoryIds.includes(id)).length
    const capsuleCount = capsules.filter((c) => c.categoryIds.includes(id)).length
    const plan = planCategoryDeletion({ slug: cat.slug, label: cat.label, lookCount, capsuleCount, clientName })

    if (plan.action === 'refuse') { confirmWith(plan.message); return plan }
    if (!confirmWith(plan.message)) return null

    if (plan.action === 'delete') {
      setCategories((prev) => prev.filter((c) => c.id !== id))
      // `.select()` so we see what was actually removed. A DELETE that RLS declines comes back
      // as zero rows and NO error, which would leave the category sitting on the client's site
      // while the stylist watched it vanish from her rail. Whether `authenticated` holds a
      // DELETE policy on this table is not something the app can know, so it does not assume:
      // if nothing was deleted, hide it instead. Either way the category leaves her lookbook.
      const { data, error } = await supabase.from('look_categories').delete().eq('id', id).select('id')
      if (error || !data || data.length === 0) {
        if (error) console.error('deleteCategory fell back to hiding:', error.message)
        const { error: hideErr } = await supabase.from('look_categories').update({ is_hidden: true }).eq('id', id)
        if (hideErr) { console.error('deleteCategory:', hideErr.message); await fetchAll() }
        else setCategories((prev) => (prev.some((c) => c.id === id) ? prev : [...prev, { ...cat, is_hidden: true }]))
      }
    } else {
      setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, is_hidden: true } : c)))
      const { error } = await supabase.from('look_categories').update({ is_hidden: true }).eq('id', id)
      if (error) { console.error('hideCategory:', error.message); await fetchAll() }
    }
    return plan
  }, [categories, looks, capsules, fetchAll])

  /** Put a hidden category back on the client's site. */
  const restoreCategory = useCallback(async (id: string) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, is_hidden: false } : c)))
    const { error } = await supabase.from('look_categories').update({ is_hidden: false }).eq('id', id)
    if (error) { console.error('restoreCategory:', error.message); await fetchAll() }
  }, [fetchAll])

  const renameCategory = useCallback(async (id: string, label: string) => {
    const l = label.trim()
    if (!l) return
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, label: l } : c)))
    const { error } = await supabase.from('look_categories').update({ label: l }).eq('id', id)
    if (error) { console.error('renameCategory:', error.message); await fetchAll() }
  }, [fetchAll])

  /**
   * Write the stylist note on a category. Deliberately SEPARATE from renameCategory rather
   * than folded into one editor: rename shipped 2026-09-04 (ADR-0108) and has still never
   * been clicked in a real stylist session, so rebuilding it to hold a second field would
   * put its first real use behind this change. Two small controls, strictly less code
   * touched, and rename cannot regress because it is not edited.
   *
   * Empty input clears the note (null, not ''), so "no note" is one value everywhere and
   * `description ?? ''` is never a lie about what is stored.
   */
  const setCategoryDescription = useCallback(async (id: string, description: string) => {
    const d = description.trim()
    const value = d.length ? d : null
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, description: value } : c)))
    const { error } = await supabase.from('look_categories').update({ description: value }).eq('id', id)
    if (error) { console.error('setCategoryDescription:', error.message); await fetchAll() }
  }, [fetchAll])

  // ── assignment (junction insert/delete) ──
  const assignLook = useCallback(async (lookId: string, categoryId: string, on: boolean) => {
    setLooks((prev) => prev.map((l) => l.id !== lookId ? l : {
      ...l, categoryIds: on ? [...new Set([...l.categoryIds, categoryId])] : l.categoryIds.filter((c) => c !== categoryId),
    }))
    const q = on
      ? supabase.from('look_category_assignments').upsert({ look_id: lookId, category_id: categoryId })
      : supabase.from('look_category_assignments').delete().eq('look_id', lookId).eq('category_id', categoryId)
    const { error } = await q
    if (error) { console.error('assignLook:', error.message); await fetchAll() }
  }, [fetchAll])

  const assignCapsule = useCallback(async (boardId: string, categoryId: string, on: boolean) => {
    setCapsules((prev) => prev.map((c) => c.id !== boardId ? c : {
      ...c, categoryIds: on ? [...new Set([...c.categoryIds, categoryId])] : c.categoryIds.filter((x) => x !== categoryId),
    }))
    const q = on
      ? supabase.from('board_category_assignments').upsert({ board_id: boardId, category_id: categoryId })
      : supabase.from('board_category_assignments').delete().eq('board_id', boardId).eq('category_id', categoryId)
    const { error } = await q
    if (error) { console.error('assignCapsule:', error.message); await fetchAll() }
  }, [fetchAll])

  // ── publish / archive (unchanged columns) ──
  const setLookPublished = useCallback(async (id: string, published: boolean) => {
    setLooks((prev) => prev.map((l) => (l.id === id ? { ...l, published } : l)))
    const { error } = await supabase.from('gp_looks').update({ published }).eq('id', id)
    if (error) { console.error('setLookPublished:', error.message); await fetchAll() }
  }, [fetchAll])
  const setCapsulePublished = useCallback(async (id: string, published: boolean) => {
    setCapsules((prev) => prev.map((c) => (c.id === id ? { ...c, published } : c)))
    const { error } = await supabase.from('gp_boards').update({ published }).eq('id', id)
    if (error) { console.error('setCapsulePublished:', error.message); await fetchAll() }
  }, [fetchAll])
  const archiveLook = useCallback(async (id: string) => {
    setLooks((prev) => prev.map((l) => (l.id === id ? { ...l, archived: true, published: false } : l)))
    const { error } = await supabase.from('gp_looks').update({ archived: true, published: false }).eq('id', id)
    if (error) { console.error('archiveLook:', error.message); await fetchAll() }
  }, [fetchAll])
  const archiveCapsule = useCallback(async (id: string) => {
    setCapsules((prev) => prev.map((c) => (c.id === id ? { ...c, archived: true, published: false } : c)))
    const { error } = await supabase.from('gp_boards').update({ is_deleted: true, published: false }).eq('id', id)
    if (error) { console.error('archiveCapsule:', error.message); await fetchAll() }
  }, [fetchAll])
  const restoreLook = useCallback(async (id: string) => {
    setLooks((prev) => prev.map((l) => (l.id === id ? { ...l, archived: false, published: false } : l)))
    const { error } = await supabase.from('gp_looks').update({ archived: false, published: false }).eq('id', id)
    if (error) { console.error('restoreLook:', error.message); await fetchAll() }
  }, [fetchAll])
  // ── manual display order (drives the client lookbook's Looks gallery) ──
  // orderedIds is the full published set in the stylist's desired order; we
  // persist each look's index as gp_looks.sort_order. Optimistic + reconciling.
  const reorderLooks = useCallback(async (orderedIds: string[]) => {
    const pos = new Map(orderedIds.map((id, i) => [id, i]))
    setLooks((prev) =>
      prev
        .map((l) => (pos.has(l.id) ? { ...l, sort_order: pos.get(l.id)! } : l))
        .sort((a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9)),
    )
    const results = await Promise.all(
      orderedIds.map((id, i) => supabase.from('gp_looks').update({ sort_order: i }).eq('id', id)),
    )
    const failed = results.find((r) => r.error)
    if (failed) { console.error('reorderLooks:', failed.error?.message); await fetchAll() }
  }, [fetchAll])

  // Same as reorderLooks but for capsules → gp_boards.sort_order (the lookbook's
  // getBoards already orders by it, so this drives the client's Capsules gallery).
  const reorderCapsules = useCallback(async (orderedIds: string[]) => {
    const pos = new Map(orderedIds.map((id, i) => [id, i]))
    setCapsules((prev) =>
      prev
        .map((c) => (pos.has(c.id) ? { ...c, sort_order: pos.get(c.id)! } : c))
        .sort((a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9)),
    )
    const results = await Promise.all(
      orderedIds.map((id, i) => supabase.from('gp_boards').update({ sort_order: i }).eq('id', id)),
    )
    const failed = results.find((r) => r.error)
    if (failed) { console.error('reorderCapsules:', failed.error?.message); await fetchAll() }
  }, [fetchAll])

  const restoreCapsule = useCallback(async (id: string) => {
    setCapsules((prev) => prev.map((c) => (c.id === id ? { ...c, archived: false, published: false } : c)))
    const { error } = await supabase.from('gp_boards').update({ is_deleted: false, published: false }).eq('id', id)
    if (error) { console.error('restoreCapsule:', error.message); await fetchAll() }
  }, [fetchAll])

  // Rename a look (any source — the client lookbook renders gp_looks.name directly, so the
  // new name shows everywhere immediately). Optimistic, like the other mutators here.
  const renameLook = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setLooks((prev) => prev.map((l) => (l.id === id ? { ...l, name: trimmed } : l)))
    const { error } = await supabase.from('gp_looks').update({ name: trimmed }).eq('id', id)
    if (error) { console.error('renameLook:', error.message); await fetchAll() }
  }, [fetchAll])

  // Rename a capsule. The twin of renameLook — gp_boards.name is what the client's Capsules
  // page renders, so the new name is live the moment this returns.
  //
  // Until now the ONLY way to change a capsule's title was Canvas -> Update Capsule, which
  // rewrites the whole row (image, canvas_state, closet_item_ids) to change one string, and
  // is unavailable entirely for capsules built with "Capsule from Looks" (no canvas_state) —
  // those could never be renamed at all.
  const renameCapsule = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setCapsules((prev) => prev.map((c) => (c.id === id ? { ...c, name: trimmed } : c)))
    const { error } = await supabase.from('gp_boards').update({ name: trimmed }).eq('id', id)
    if (error) { console.error('renameCapsule:', error.message); await fetchAll() }
  }, [fetchAll])

  return {
    loading, categories, looks, capsules, draftCount,
    createCategory, renameCategory, setCategoryDescription, deleteCategory, restoreCategory,
    assignLook, assignCapsule,
    setLookPublished, setCapsulePublished,
    archiveLook, archiveCapsule,
    restoreLook, restoreCapsule,
    reorderLooks, reorderCapsules,
    renameLook, renameCapsule,
    refetch: fetchAll,
  }
}

/**
 * Lightweight draft-queue count for a client (looks + capsules that are
 * unpublished and not archived) — drives the Categorize tab badge. The second
 * arg is any value that should force a refetch (e.g. the active style sub-tab).
 */
export function useDraftCount(clientId: string | null, refreshKey?: unknown): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let cancelled = false
    if (!clientId) { setCount(0); return }
    ;(async () => {
      const [looksRes, capsRes] = await Promise.all([
        supabase.from('gp_looks').select('id', { count: 'exact', head: true })
          .eq('client_id', clientId).eq('published', false).eq('archived', false),
        supabase.from('gp_boards').select('id', { count: 'exact', head: true })
          .eq('client_id', clientId).eq('published', false).eq('is_deleted', false),
      ])
      if (!cancelled) setCount((looksRes.count ?? 0) + (capsRes.count ?? 0))
    })()
    return () => { cancelled = true }
  }, [clientId, refreshKey])
  return count
}

/** Category vocabulary for a client (ID-based) — for the canvas Save dialog. */
export function useLookCategoryVocab(clientId: string | null) {
  const [categories, setCategories] = useState<LookCategory[]>([])
  const refetch = useCallback(async () => {
    if (!clientId) { setCategories([]); return }
    const { data } = await supabase.from('look_categories')
      .select('id, slug, label, sort_order, is_hidden, description')
      .eq('client_id', clientId).order('sort_order').order('label')
    setCategories((data ?? []) as LookCategory[])
  }, [clientId])
  useEffect(() => { refetch() }, [refetch])

  const createCategory = useCallback(async (label: string): Promise<LookCategory | null> => {
    const l = label.trim()
    if (!l || !clientId) return null
    const slug = l.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || `cat-${Date.now()}`
    const existing = categories.find((c) => c.label.toLowerCase() === l.toLowerCase() || c.slug === slug)
    if (existing) return existing
    const { data, error } = await supabase.from('look_categories')
      .insert({ client_id: clientId, slug, label: l, sort_order: categories.length })
      .select('id, slug, label, sort_order, is_hidden, description').single()
    if (error || !data) { console.error('vocab createCategory:', error?.message); return null }
    setCategories((prev) => [...prev, data as LookCategory])
    return data as LookCategory
  }, [clientId, categories])

  return { categories, createCategory, refetch }
}
