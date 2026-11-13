import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { supabase } from '@/lib/supabase'
import { closetTreeOf, type ClosetTree, type TreeKind } from '@/lib/standardTree'

/**
 * Her Wardrobe's tree (Maegan's standard categories), from gp_clients.raw.closet_tree, read on its
 * own rather than widened into the client store's SELECT (ADR-0103). One read per client, shared by
 * every picker, so switching her between Women's and Men's in Nesting changes them all at once.
 * Null until the read lands and for every existing client (unset), so their pickers offer exactly
 * what they did before.
 */

type Entry = { value: string | null; loaded: boolean }
const EMPTY: Entry = { value: null, loaded: false }
const store = new Map<string, Entry>()
const reading = new Set<string>()
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }

function load(clientId: string) {
  if (store.get(clientId)?.loaded || reading.has(clientId)) return
  reading.add(clientId)
  void Promise.resolve(supabase.from('gp_clients').select('closet_tree:raw->>closet_tree').eq('id', clientId).maybeSingle())
    .then(({ data }) => {
      store.set(clientId, { value: (data as { closet_tree?: string | null } | null)?.closet_tree ?? null, loaded: true })
      emit()
    })
    .finally(() => { reading.delete(clientId) })
}

export function useClosetTree(clientId: string | null): ClosetTree | null {
  return useClosetTreeSwitch(clientId).tree
}

export function useClosetTreeSwitch(clientId: string | null) {
  const entry = useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => (clientId ? store.get(clientId) ?? EMPTY : EMPTY),
  )
  useEffect(() => { if (clientId) load(clientId) }, [clientId])

  /**
   * Switch a client who is ON the standard categories between Women's and Men's. Only a client
   * already on a tree can be switched: turning an existing client on waits for Karl (11/12).
   * The write reads her raw fresh and changes only this key; an empty answer is a refused write.
   */
  const setKind = useCallback(async (kind: TreeKind): Promise<{ ok: boolean; message?: string }> => {
    if (!clientId) return { ok: false, message: 'No client selected.' }
    const { data: row, error: rErr } = await supabase.from('gp_clients').select('raw').eq('id', clientId).single()
    if (rErr || !row) return { ok: false, message: rErr?.message ?? 'Not saved.' }
    const raw = (row.raw ?? {}) as Record<string, unknown>
    if (!closetTreeOf(raw.closet_tree as string | null)) return { ok: false, message: 'This client keeps her own categories.' }
    const { data, error } = await supabase.from('gp_clients').update({ raw: { ...raw, closet_tree: kind } }).eq('id', clientId).select('id')
    if (error || !data || data.length === 0) return { ok: false, message: error?.message ?? 'The database accepted the request but saved nothing.' }
    store.set(clientId, { value: kind, loaded: true })
    emit()
    return { ok: true }
  }, [clientId])

  return { tree: closetTreeOf(entry.value), loaded: entry.loaded, setKind }
}
