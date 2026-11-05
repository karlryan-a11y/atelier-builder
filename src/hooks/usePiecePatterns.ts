import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { patternsOn, withPatterns } from '@/lib/piecePatterns'

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
 * Save one piece's patterns. Reads the piece's markers fresh, so a change the client made a minute
 * ago is kept, replaces only the pattern markers, and asks for the row back: a write that is refused
 * comes back empty, not as an error (ADR-0108), and must not read as saved.
 */
export async function savePiecePatterns(itemId: string, clientId: string, slugs: readonly string[]): Promise<{ fields: string[] | null } | { error: string }> {
  const { data: cur, error: rErr } = await supabase.from('gp_closet_items')
    .select('client_edited_fields').eq('id', itemId).eq('client_id', clientId).maybeSingle()
  if (rErr || !cur) return { error: rErr?.message ?? 'This piece could not be read.' }
  const next = withPatterns((cur as { client_edited_fields?: string[] | null }).client_edited_fields, slugs)
  const { data, error } = await supabase.from('gp_closet_items')
    .update({ client_edited_fields: next }).eq('id', itemId).eq('client_id', clientId).select('id, client_edited_fields')
  if (error) return { error: error.message }
  if (!data?.length) return { error: 'The change was not saved.' }
  return { fields: (data[0] as { client_edited_fields: string[] | null }).client_edited_fields }
}
