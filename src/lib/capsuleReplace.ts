import { supabase } from '@/lib/supabase'

/**
 * Hand a GoodPix capsule's place on the client's site over to the rebuild that replaces it.
 *
 * WHY THIS EXISTS AT ALL. A GoodPix capsule is one flat scraped image plus `closet_item_ids`;
 * the scrape never captured per-piece layout, so the original cannot be reopened. Rebuild lays
 * its pieces out on a fresh canvas instead. The original must NOT be edited in place — the
 * same rule ADR-0076 set for looks — because saving rewrites `raw`, and `raw.image_url` is the
 * picture the client is looking at right now. Overwrite it and a mid-rebuild save destroys the
 * live capsule.
 *
 * So the rebuild is a NEW gp_boards row, and this hands the original's place over to it:
 * its filing, its published state, its slot in her lookbook. Then the original retires.
 * Without the handover a rebuild appears as an unfiled draft while the old one stays live —
 * exactly the "original left dark with a duplicate beside it" failure the looks version was
 * written to prevent.
 *
 * NOTE the two different columns for the same idea: a look retires via `archived`, a capsule
 * via `is_deleted`. gp_boards has no `archived` column (checked against production). The
 * Categorize grid reads `is_deleted` as "archived", so a retired capsule lands in ARCHIVED and
 * stays recoverable.
 */
export async function replaceGoodPixCapsule(
  originalId: string,
  newCapsuleId: string,
  clientId: string,
): Promise<void> {
  const { data: original, error } = await supabase
    .from('gp_boards')
    .select('id, published, sort_order')
    .eq('id', originalId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error || !original) return

  // Filing first: a capsule that reappears outside its category reads as lost. Only three of
  // Maegan's 26 capsules are filed at all, so this is usually a no-op — but the one that IS
  // filed is the one a stylist is most likely to rebuild.
  const { data: assignments } = await supabase
    .from('board_category_assignments')
    .select('category_id')
    .eq('board_id', originalId)
  if (assignments?.length) {
    await supabase
      .from('board_category_assignments')
      .upsert(assignments.map((a) => ({ board_id: newCapsuleId, category_id: a.category_id })))
  }

  const { error: nErr } = await supabase
    .from('gp_boards')
    .update({ published: original.published ?? false, sort_order: original.sort_order ?? 0 })
    .eq('id', newCapsuleId)
    .eq('client_id', clientId)
  if (nErr) throw nErr

  // Retire the original: off her site, into ARCHIVED, still recoverable. Never deleted — the
  // scraped composite is the only record of how GoodPix had laid it out.
  const { error: oErr } = await supabase
    .from('gp_boards')
    .update({ is_deleted: true, published: false })
    .eq('id', originalId)
    .eq('client_id', clientId)
  if (oErr) throw oErr
}
