import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { closetTreeOf, wearsWomens } from '@/lib/standardTree'

/** Whether her live pieces hold a women-only one (read in pages, stopping at the first hit). */
async function closetIsWomens(clientId: string): Promise<boolean> {
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('gp_closet_items').select('name, name_override, category, custom_categories')
      .eq('client_id', clientId).eq('is_deleted', false).is('transitioned_at', null).order('id').range(from, from + 999)
    if (error) return true
    if (wearsWomens(data ?? [])) return true
    if (!data || data.length < 1000) return false
  }
}

/**
 * Her Wardrobe's tree (Maegan's standard categories), from gp_clients.raw.closet_tree, read on its
 * own rather than widened into the client store's SELECT (ADR-0103), and, when that is unset, from
 * whether her closet holds a women-only piece (a men's client keeps today's closet). Null until the
 * read lands and for a client kept on today's closet, so the pickers offer exactly what they did before.
 */
export function useClosetTree(clientId: string | null) {
  const [state, setState] = useState<{ id: string | null; tree: ReturnType<typeof closetTreeOf> }>({ id: null, tree: null })
  useEffect(() => {
    let live = true
    if (!clientId) return
    supabase.from('gp_clients').select('closet_tree:raw->>closet_tree').eq('id', clientId).maybeSingle()
      .then(async ({ data, error }) => {
        if (!live || error || !data) return
        const set = (data as { closet_tree?: string | null }).closet_tree ?? null
        const womens = set != null || await closetIsWomens(clientId)
        if (live) setState({ id: clientId, tree: closetTreeOf(set, womens) })
      })
    return () => { live = false }
  }, [clientId])
  return state.id === clientId ? state.tree : null
}
