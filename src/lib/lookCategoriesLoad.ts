/**
 * The Categorize read, as a plain function so it can be tested without React or a network.
 *
 * WHY IT RETURNS AN ERROR: the hook used to read `looksRes.data ?? []` and never look at
 * `looksRes.error`. A 500, a timeout or a dropped connection (the database fell over under load
 * on 2026-09-17) rendered as an EMPTY Categorize grid, which reads to a stylist as "her looks
 * are gone". Any failed read now comes back as `error`, and the grid shows "Couldn't load" with
 * a Retry instead of a confident nothing. scripts/check-load-errors.mjs holds this.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LookCategory, TaggableLook, TaggableCapsule } from '../hooks/useLookCategories.ts'
import type { LookCanvasState } from '../types/canvas.ts'
import { lookImageUrl } from './lookImage.ts'

export interface LookCategoriesData {
  categories: LookCategory[]
  looks: TaggableLook[]
  capsules: TaggableCapsule[]
}

type Res = { data?: unknown; error?: { message?: string } | null } | undefined

/** The first failed response's message, or null when every one of them succeeded. */
export function firstLoadError(...results: Res[]): string | null {
  for (const r of results) {
    if (r?.error) return r.error.message || 'load failed'
  }
  return null
}

export async function loadLookCategories(
  db: SupabaseClient,
  clientId: string,
): Promise<{ error: string; data: null } | { error: null; data: LookCategoriesData }> {
  let catsRes, looksRes, capsRes
  try {
    ;[catsRes, looksRes, capsRes] = await Promise.all([
      db.from('look_categories')
        .select('id, slug, label, sort_order, is_hidden, is_residence, description, parent_slug')
        .eq('client_id', clientId)
        .order('sort_order').order('label'),
      db.from('gp_looks')
        // thumbnail_url is never selected here: see lib/lookImage.ts.
        .select('id, name, raw, published, archived, sort_order, source, closet_item_ids')
        .eq('client_id', clientId)
        // Transitioned looks live in the Transitions tab, not the normal Looks/Queue grid. (migration 014)
        .is('transitioned_at', null)
        // Match the client lookbook's ordering so "On lookbook" == what she sees.
        // NULLS FIRST: a look nobody has arranged is a new look, and a new look goes to the
        // top. Mirrors atelier-looks/src/lib/lookOrder.ts -- change both or the stylist is
        // arranging a list the client never sees in that order. (ADR-0121)
        .order('sort_order', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: false, nullsFirst: false })
        .order('extracted_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true }),
      db.from('gp_boards')
        .select('id, name, raw, published, is_deleted, sort_order, closet_item_ids')
        .eq('client_id', clientId)
        // Match the client lookbook's ordering so "On lookbook" == what she sees.
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false }),
    ])
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'load failed', data: null }
  }
  const first = firstLoadError(catsRes, looksRes, capsRes)
  if (first) return { error: first, data: null }

  const lookIds = ((looksRes.data ?? []) as { id: string }[]).map((l) => l.id)
  const boardIds = ((capsRes.data ?? []) as { id: string }[]).map((b) => b.id)
  let laRes, baRes
  try {
    ;[laRes, baRes] = await Promise.all([
      lookIds.length
        ? db.from('look_category_assignments').select('look_id, category_id').in('look_id', lookIds)
        : Promise.resolve({ data: [] as { look_id: string; category_id: string }[], error: null }),
      boardIds.length
        ? db.from('board_category_assignments').select('board_id, category_id').in('board_id', boardIds)
        : Promise.resolve({ data: [] as { board_id: string; category_id: string }[], error: null }),
    ])
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'load failed', data: null }
  }
  // A failed assignment read would show every look as uncategorised: an error, not a result.
  const second = firstLoadError(laRes, baRes)
  if (second) return { error: second, data: null }

  const byLook = new Map<string, string[]>()
  for (const r of (laRes.data ?? []) as { look_id: string; category_id: string }[]) {
    if (!byLook.has(r.look_id)) byLook.set(r.look_id, [])
    byLook.get(r.look_id)!.push(r.category_id)
  }
  const byBoard = new Map<string, string[]>()
  for (const r of (baRes.data ?? []) as { board_id: string; category_id: string }[]) {
    if (!byBoard.has(r.board_id)) byBoard.set(r.board_id, [])
    byBoard.get(r.board_id)!.push(r.category_id)
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return {
    error: null,
    data: {
      categories: (catsRes.data ?? []) as LookCategory[],
      looks: ((looksRes.data ?? []) as any[]).map((l) => ({
        id: l.id,
        name: l.name ?? 'Untitled Look',
        image: lookImageUrl(l.raw),
        categoryIds: byLook.get(l.id) ?? [],
        published: !!l.published,
        archived: !!l.archived,
        sort_order: l.sort_order ?? null,
        source: l.source ?? 'goodpix',
        closetItemIds: (l.closet_item_ids as string[] | null) ?? [],
      })),
      capsules: ((capsRes.data ?? []) as any[]).map((b) => ({
        id: b.id,
        name: b.name ?? 'Untitled Capsule',
        image: b.raw?.image_url ?? b.raw?.image ?? null,
        categoryIds: byBoard.get(b.id) ?? [],
        published: !!b.published,
        archived: !!b.is_deleted,
        sort_order: b.sort_order ?? null,
        canvasState: (b.raw?.canvas_state as LookCanvasState | undefined) ?? null,
        source: (b.raw?.source as string | undefined) ?? 'goodpix',
        closetItemIds: (b.closet_item_ids as string[] | null) ?? [],
      })),
    },
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
