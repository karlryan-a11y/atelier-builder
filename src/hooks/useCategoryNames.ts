import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { supabase } from '@/lib/supabase'
import { categoryNamesOf, nameForCategory, withCategoryName } from '@/lib/categoryNames'

/**
 * Her own names for her closet categories (lib/categoryNames.ts), shared by every screen that lists
 * them: Nesting, the Collection rail and cards, the canvas closet and the pickers. One read per
 * client, kept here, so a rename in Nesting changes all of them at once without a reload.
 *
 * The write reads her raw fresh and changes only this one key, then asks for the row back: a write
 * RLS declines is HTTP 200 with an empty body (ADR-0108), so an empty answer is reported, never
 * shown as saved.
 */

type Entry = { names: Record<string, string>; loaded: boolean; error: string | null }
const EMPTY: Entry = { names: {}, loaded: false, error: null }
const store = new Map<string, Entry>()
const reading = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }
const set = (clientId: string, e: Entry) => { store.set(clientId, e); emit() }

function load(clientId: string) {
  if (store.get(clientId)?.loaded || reading.has(clientId)) return
  const p = Promise.resolve(supabase.from('gp_clients').select('raw').eq('id', clientId).maybeSingle())
    .then(({ data, error }) => {
      set(clientId, error
        ? { names: {}, loaded: true, error: error.message }
        : { names: categoryNamesOf((data as { raw?: unknown } | null)?.raw), loaded: true, error: null })
    })
    .finally(() => { reading.delete(clientId) })
  reading.set(clientId, p)
}

export function useCategoryNames(clientId: string | null) {
  const entry = useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => (clientId ? store.get(clientId) ?? EMPTY : EMPTY),
  )
  useEffect(() => { if (clientId) load(clientId) }, [clientId])

  /** Her name for this category, else `standard` (the name it already had). */
  const nameOf = useCallback((slug: string, standard: string) => nameForCategory(slug, entry.names, standard), [entry.names])

  /** Save her name for one category. An empty name is refused; the name it already had takes hers off. */
  const rename = useCallback(async (slug: string, name: string, standard: string): Promise<{ ok: boolean; message?: string }> => {
    if (!clientId) return { ok: false, message: 'No client selected.' }
    const { data: row, error: rErr } = await supabase.from('gp_clients').select('raw').eq('id', clientId).single()
    if (rErr || !row) return { ok: false, message: rErr?.message ?? 'The new name was not saved.' }
    const next = withCategoryName(row.raw, slug, name, standard)
    if (!next) return { ok: false, message: 'Type a name first. A category cannot be left without one.' }
    const { data, error: e } = await supabase.from('gp_clients').update({ raw: next }).eq('id', clientId).select('raw')
    if (e || !data || data.length === 0) {
      return { ok: false, message: e?.message ?? 'The database accepted the request but saved nothing. This usually means the write was refused.' }
    }
    set(clientId, { names: categoryNamesOf((data[0] as { raw?: unknown }).raw), loaded: true, error: null })
    return { ok: true }
  }, [clientId])

  return { names: entry.names, loaded: entry.loaded, error: entry.error, nameOf, rename }
}
