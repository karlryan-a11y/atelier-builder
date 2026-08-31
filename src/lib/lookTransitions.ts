import { supabase } from '@/lib/supabase'

/**
 * Bringing a transitioned look BACK — the half of migration 014 that was never built.
 *
 * A piece going out stamps every look styled with it (`gp_looks.transitioned_at` +
 * `transitioned_item_ids`) and pulls those looks from the client's lookbook. Until now the only
 * way back was restoring the PIECE. Restyling a look without it did nothing, because the save
 * path never touched the transition columns — so the Transitions tab's standing promise
 * ("a restyled look returns to the lookbook on its own") was a sentence, not a behaviour.
 *
 * TWO RULES THAT LOOK OPTIONAL AND ARE NOT:
 *
 * 1. THE BLOCK IS KEYED ON `transitioned_item_ids`, NEVER ON `closet_item_ids`.
 *    goodpix-scraper's `upsert_looks` (src/storage.py:161) rewrites `closet_item_ids` on every
 *    incremental sync. A rule that derived "is this look still broken?" from that column would
 *    be undone by the next sync, silently re-breaking a look a stylist had already fixed.
 *    `transitioned_item_ids` is not in the scraper's payload (migration 014), so it is durable.
 *    `closet_item_ids` is used here only as "what does the look contain right now", passed in
 *    from the save that just happened.
 *
 * 2. THE WRITE GOES TO `gp_looks`, NOT THE `looks` VIEW.
 *    useLooks reads gp_looks but saves through the `looks` view, and the view does not expose
 *    transitioned_at. A republish therefore cannot ride along on the save; it is a second,
 *    explicit write to the base table.
 */

/**
 * After a look is saved, drop any transition cause the look no longer contains. When the last
 * cause is gone the look is un-transitioned and returns to the client's lookbook exactly as it
 * was — same published state, same place. A look broken by two pieces stays down until both are
 * styled out, which is the same rule `restore` has always used.
 *
 * Returns true if this save is what brought the look back.
 */
export async function clearTransitionBlock(
  lookId: string,
  clientId: string,
  closetItemIds: string[],
): Promise<boolean> {
  const { data: look, error } = await supabase
    .from('gp_looks')
    .select('id, transitioned_at, transitioned_item_ids')
    .eq('id', lookId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error || !look?.transitioned_at) return false   // not a pulled look: nothing to clear

  const causes: string[] = look.transitioned_item_ids ?? []
  const stillPresent = causes.filter((id) => closetItemIds.includes(id))
  if (stillPresent.length === causes.length) return false   // nothing was styled out

  const { error: uErr } = await supabase
    .from('gp_looks')
    .update({
      transitioned_at: stillPresent.length ? look.transitioned_at : null,
      transitioned_item_ids: stillPresent.length ? stillPresent : null,
    })
    .eq('id', lookId)
    .eq('client_id', clientId)
  if (uErr) throw uErr

  return stillPresent.length === 0
}

/**
 * The GoodPix path. ADR-0076 decided that a GoodPix look is REBUILT as a new builder look and
 * never edited in place, because editing in place overwrites `raw` and loses the pointer to the
 * original composed image. That decision stands — so a rebuilt replacement cannot simply
 * un-transition the original, because the original is not the look the stylist fixed.
 *
 * Instead the new look TAKES THE ORIGINAL'S PLACE: it inherits the published state, the display
 * order and the category filing, and the original is archived and lifted out of the Transitions
 * queue. Nothing is overwritten, so 0076's zero-data-loss property holds — the original row is
 * recoverable via Restore, `raw` untouched.
 *
 * On inheriting `published`: this is not auto-publishing something new. The original was
 * published (that is why the client noticed it go), so carrying the flag across restores the
 * status quo the transition interrupted. A look that was a draft when it was pulled stays a
 * draft.
 */
export async function replaceTransitionedLook(
  originalId: string,
  newLookId: string,
  clientId: string,
): Promise<void> {
  const { data: original, error } = await supabase
    .from('gp_looks')
    .select('id, published, sort_order, transitioned_at')
    .eq('id', originalId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error || !original) return

  // Carry the filing across first: a look that reappears outside its category reads as lost.
  const { data: assignments } = await supabase
    .from('look_category_assignments')
    .select('category_id')
    .eq('look_id', originalId)
  if (assignments?.length) {
    await supabase
      .from('look_category_assignments')
      .upsert(assignments.map((a) => ({ look_id: newLookId, category_id: a.category_id })))
  }

  const { error: nErr } = await supabase
    .from('gp_looks')
    .update({ published: original.published ?? false, sort_order: original.sort_order ?? null })
    .eq('id', newLookId)
    .eq('client_id', clientId)
  if (nErr) throw nErr

  // Retire the original: out of the lookbook, out of the Transitions queue, still recoverable.
  const { error: oErr } = await supabase
    .from('gp_looks')
    .update({ archived: true, published: false, transitioned_at: null, transitioned_item_ids: null })
    .eq('id', originalId)
    .eq('client_id', clientId)
  if (oErr) throw oErr
}
