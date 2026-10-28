import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { closetTreeOf } from '@/lib/standardTree'

/**
 * Her Wardrobe's tree (Maegan's standard categories), from gp_clients.raw.closet_tree, read on its
 * own rather than widened into the client store's SELECT (ADR-0103). Null until the read lands and
 * for a client kept on today's closet, so the pickers offer exactly what they did before.
 */
export function useClosetTree(clientId: string | null) {
  const [state, setState] = useState<{ id: string | null; tree: ReturnType<typeof closetTreeOf> }>({ id: null, tree: null })
  useEffect(() => {
    let live = true
    if (!clientId) return
    supabase.from('gp_clients').select('closet_tree:raw->>closet_tree').eq('id', clientId).maybeSingle()
      .then(({ data, error }) => {
        if (!live || error || !data) return
        setState({ id: clientId, tree: closetTreeOf((data as { closet_tree?: string | null }).closet_tree) })
      })
    return () => { live = false }
  }, [clientId])
  return state.id === clientId ? state.tree : null
}
