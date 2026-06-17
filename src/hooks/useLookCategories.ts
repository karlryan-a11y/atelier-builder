import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Categorize + publish queue, on the ID-BASED taxonomy (migration 008):
 *   - look_categories(id, client_id, slug, label, sort_order, is_hidden)  — per-client taxonomy
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
}
export interface TaggableLook {
  id: string
  name: string
  image: string | null
  categoryIds: string[]
  published: boolean
  archived: boolean
}
export interface TaggableCapsule {
  id: string
  name: string
  image: string | null
  categoryIds: string[]
  published: boolean
  archived: boolean
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
        .select('id, slug, label, sort_order, is_hidden')
        .eq('client_id', clientId)
        .order('sort_order').order('label'),
      supabase.from('gp_looks')
        .select('id, name, thumbnail_url, raw, published, archived')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false }),
      supabase.from('gp_boards')
        .select('id, name, raw, published, is_deleted')
        .eq('client_id', clientId)
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
    })))
    setCapsules((capsRes.data ?? []).map((b: any) => ({
      id: b.id,
      name: b.name ?? 'Untitled Capsule',
      image: b.raw?.image_url ?? b.raw?.image ?? null,
      categoryIds: byBoard.get(b.id) ?? [],
      published: !!b.published,
      archived: !!b.is_deleted,
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
      .select('id, slug, label, sort_order, is_hidden').single()
    if (error || !data) { console.error('createCategory:', error?.message); return null }
    setCategories((prev) => [...prev, data as LookCategory])
    return data as LookCategory
  }, [clientId, categories])

  const renameCategory = useCallback(async (id: string, label: string) => {
    const l = label.trim()
    if (!l) return
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, label: l } : c)))
    const { error } = await supabase.from('look_categories').update({ label: l }).eq('id', id)
    if (error) { console.error('renameCategory:', error.message); await fetchAll() }
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
  const restoreCapsule = useCallback(async (id: string) => {
    setCapsules((prev) => prev.map((c) => (c.id === id ? { ...c, archived: false, published: false } : c)))
    const { error } = await supabase.from('gp_boards').update({ is_deleted: false, published: false }).eq('id', id)
    if (error) { console.error('restoreCapsule:', error.message); await fetchAll() }
  }, [fetchAll])

  return {
    loading, categories, looks, capsules, draftCount,
    createCategory, renameCategory,
    assignLook, assignCapsule,
    setLookPublished, setCapsulePublished,
    archiveLook, archiveCapsule,
    restoreLook, restoreCapsule,
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
      .select('id, slug, label, sort_order, is_hidden')
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
      .select('id, slug, label, sort_order, is_hidden').single()
    if (error || !data) { console.error('vocab createCategory:', error?.message); return null }
    setCategories((prev) => [...prev, data as LookCategory])
    return data as LookCategory
  }, [clientId, categories])

  return { categories, createCategory, refetch }
}
