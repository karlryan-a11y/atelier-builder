import { supabase } from '@/lib/supabase'
import { editedFieldsLiteral, sameEditedFields } from '@/lib/editedFields'

/**
 * The one way the builder writes a piece's `client_edited_fields` (lib/editedFields.ts says why).
 * Reads the list the piece has now, applies `change` to it, and writes only if the list is still
 * what it read: if another screen or stylist wrote in between, it reads again and re-applies, so
 * neither change is lost. Names the client and asks for the row back: a refused write is a 200 with
 * nothing in it (ADR-0108) and must not read as saved.
 */
export async function saveEditedFields(
  itemId: string,
  clientId: string,
  change: (now: string[] | null) => string[] | null,
): Promise<{ fields: string[] | null } | { error: string }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: cur, error: rErr } = await supabase.from('gp_closet_items')
      .select('client_edited_fields').eq('id', itemId).eq('client_id', clientId).maybeSingle()
    if (rErr || !cur) return { error: rErr?.message ?? 'This piece could not be read.' }
    const now = (cur as { client_edited_fields?: string[] | null }).client_edited_fields ?? null
    const next = change(now)
    if (sameEditedFields(now, next)) return { fields: now }
    let q = supabase.from('gp_closet_items').update({ client_edited_fields: next })
      .eq('id', itemId).eq('client_id', clientId)
    q = now === null ? q.is('client_edited_fields', null) : q.filter('client_edited_fields', 'eq', editedFieldsLiteral(now))
    const { data, error } = await q.select('id, client_edited_fields')
    if (error) return { error: error.message }
    if (data?.length) return { fields: (data[0] as { client_edited_fields: string[] | null }).client_edited_fields }
    // Nothing written: either someone changed the list since the read (go round again) or the write
    // was refused, which the next read cannot tell apart, so it gives up after a few rounds.
  }
  return { error: 'The change was not saved.' }
}
