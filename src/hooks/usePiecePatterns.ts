import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { patternsOn, withPatterns } from '@/lib/piecePatterns'
import { saveEditedFields } from '@/lib/saveEditedFields'

/**
 * Patterns & Textures for one client (lib/piecePatterns.ts). `on` is false until her row is read,
 * and stays false for every client who does not have it turned on, so nothing shows for them.
 */
export function usePatternsOn(clientId: string | null): boolean {
  const [state, setState] = useState<{ id: string | null; on: boolean }>({ id: null, on: false })
  useEffect(() => {
    let live = true
    if (!clientId) return
    supabase.from('gp_clients').select('raw').eq('id', clientId).maybeSingle()
      .then(({ data }) => { if (live) setState({ id: clientId, on: patternsOn((data as { raw?: unknown } | null)?.raw) }) })
    return () => { live = false }
  }, [clientId])
  return state.id === clientId && state.on
}

/**
 * Save one piece's patterns. Replaces only the pattern markers on the list the piece has now, so a
 * season or a change the client made a minute ago is kept, and a write that lands between the read
 * and the save is not undone (lib/saveEditedFields.ts asks for the row back, ADR-0108).
 */
export async function savePiecePatterns(itemId: string, clientId: string, slugs: readonly string[]): Promise<{ fields: string[] | null } | { error: string }> {
  return saveEditedFields(itemId, clientId, (now) => withPatterns(now, slugs))
}
