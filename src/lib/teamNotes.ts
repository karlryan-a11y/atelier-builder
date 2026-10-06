import { supabase } from '@/lib/supabase'

/**
 * TEAM NOTES LIVE IN THEIR OWN TABLE (ADR-0165, migration 035).
 *
 * A team note ("Too low cut for work!") sat on the piece's own row, and a signed-in client may read
 * every column of her own rows: no page showed it, but her token could read it from the database
 * API. Karl, 2026-10-06: "team notes in own table only team accounts can read". The table's policy
 * lets only team accounts (and a scoped stylist, for her clients) see or write a note.
 *
 * Every builder save goes through updateClosetItem, so no screen can write a note onto the piece row
 * again. A database trigger also moves any note written the old way, so an old open tab cannot leak.
 */
export async function saveTeamNote(clientId: string, itemId: string, note: string | null | undefined) {
  const text = (note ?? '').trim()
  if (!text) {
    const { error } = await supabase.from('closet_item_team_notes').delete().eq('item_id', itemId)
    return { ok: !error, error: error?.message }
  }
  const { data, error } = await supabase
    .from('closet_item_team_notes')
    .upsert({ item_id: itemId, client_id: clientId, note: text, updated_at: new Date().toISOString() }, { onConflict: 'item_id' })
    .select('item_id')
  if (error) return { ok: false, error: error.message }
  // A write the policy refuses comes back empty, not as an error (ADR-0108).
  if (!data?.length) return { ok: false, error: 'The note was not saved (team accounts only).' }
  return { ok: true }
}

/** Update a piece; a `style_note` in the patch goes to the team table, never onto the piece row. */
export async function updateClosetItem(itemId: string, clientId: string, patch: Record<string, unknown>) {
  const { style_note, ...rest } = patch
  if (Object.keys(rest).length) {
    const { error } = await supabase.from('gp_closet_items').update(rest).eq('id', itemId)
    if (error) return { error }
  }
  if ('style_note' in patch) {
    const r = await saveTeamNote(clientId, itemId, style_note as string | null)
    if (!r.ok) return { error: { message: r.error ?? 'note not saved' } }
  }
  return { error: null }
}

/** Every team note for one client, item id -> note, paged past the 1,000-row cap. */
export async function fetchTeamNotes(clientId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('closet_item_team_notes').select('item_id, note').eq('client_id', clientId)
      .order('item_id').range(from, from + PAGE - 1)
    if (error) { console.error('teamNotes: read failed —', error.message); break }
    for (const r of data ?? []) out.set((r as any).item_id, (r as any).note)
    if (!data || data.length < PAGE) break
  }
  return out
}

/**
 * LOOKS AND CAPSULES (ADR-0166, migration 036). One team-only table, `team_notes`, keyed by kind and
 * id, under the same rule as the piece notes above. A look's "Internal Notes" used to sit on the
 * look row (gp_looks.notes_internal), which a client's login could read: measured 2026-10-06 on
 * Cynthia Lippe, 4 of 4. Capsules had no team note at all.
 */
export type TeamNoteKind = 'look' | 'capsule'

export async function saveTargetTeamNote(kind: TeamNoteKind, clientId: string, targetId: string, note: string | null | undefined) {
  const text = (note ?? '').trim()
  if (!text) {
    const { error } = await supabase.from('team_notes').delete().eq('kind', kind).eq('target_id', targetId)
    return { ok: !error, error: error?.message }
  }
  const { data, error } = await supabase
    .from('team_notes')
    .upsert({ kind, target_id: targetId, client_id: clientId, note: text, updated_at: new Date().toISOString() }, { onConflict: 'kind,target_id' })
    .select('target_id')
  if (error) return { ok: false, error: error.message }
  if (!data?.length) return { ok: false, error: 'The note was not saved (team accounts only).' }
  return { ok: true }
}

/** Every look or capsule team note for one client, id -> note, paged past the 1,000-row cap. */
export async function fetchTargetTeamNotes(clientId: string, kind: TeamNoteKind): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('team_notes').select('target_id, note').eq('client_id', clientId).eq('kind', kind)
      .order('target_id').range(from, from + PAGE - 1)
    if (error) { console.error('teamNotes: read failed —', error.message); break }
    for (const r of data ?? []) out.set((r as any).target_id, (r as any).note)
    if (!data || data.length < PAGE) break
  }
  return out
}

/** One look's or capsule's team note ('' when none). */
export async function fetchTargetTeamNote(kind: TeamNoteKind, targetId: string): Promise<string> {
  const { data, error } = await supabase
    .from('team_notes').select('note').eq('kind', kind).eq('target_id', targetId).maybeSingle()
  if (error) { console.error('teamNotes: read failed —', error.message); return '' }
  return (data as any)?.note ?? ''
}
