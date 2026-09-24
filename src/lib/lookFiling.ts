import { supabase } from '@/lib/supabase'

/**
 * WHERE A LOOK IS FILED — the one thing the Save box was not writing. ADR-0149.
 *
 * Cynthia Dada, 2026-09-24, on the Rebuild fix shipped the day before: "When I go to update, it
 * asks me to add to a category. This look was already in a category but I'm not sure what. Can it
 * just stay in the categories it was in?"
 *
 * She found two defects in one sentence.
 *
 * 1. THE BOX OPENED BLANK ON A REPLACEMENT. `initialTags` came from `currentLook?.tags`, and on a
 *    Rebuild or a Restyle there is no `currentLook` — the save inserts a new row (ADR-0076). So a
 *    look that was already filed asked to be filed again, by a stylist who could not see where it
 *    had been. Its filing was in fact carried over by lookTransitions.ts, so the honest answer to
 *    her question was "yes, it already does" — but nothing on screen said so, and an unticked pill
 *    beside the word CATEGORIES reads as "this look is in none".
 *
 * 2. THE PILLS WROTE TO A COLUMN NOTHING FILES BY. They set `gp_looks.tags`, a text array. Every
 *    surface that files a look — Categorize, the client's Looks page, the season work — reads
 *    `look_category_assignments`. Measured on production the same morning: 219 live looks carry
 *    tags, and 72 of them are in NO category at all. That is why looks she had ticked read
 *    UNCATEGORIZED back to her (Peyton Wheeler's screenshot, 2026-09-24).
 *
 * THE RULE THIS FILE HOLDS: the pills in the Save box mean the same thing as the pills in
 * Categorize. Ticking one files the look; unticking one she was shown unfiles it; and a category
 * she was never shown is never touched.
 *
 * That last clause is the safety property, and it is why `apply` takes a BASELINE rather than
 * diffing against the database. If the baseline read fails, the baseline is empty, so the save
 * can only ADD. A read that failed must never be able to strip a look out of the categories the
 * client browses by.
 *
 * `tags` is still written, unchanged, by useLooks. It is left alone deliberately: it is the older
 * of the two systems, it is what these 72 rows are recoverable from, and nothing reads it for
 * filing, so it cannot disagree with anything.
 */

export interface LookFiling {
  /** Category ids this look is assigned to. */
  ids: string[]
  /** Their labels, which is what the Save box's pills are keyed by. */
  labels: string[]
  /** False when a read failed. The caller must then treat the baseline as unknown, not as empty. */
  ok: boolean
}

const EMPTY: LookFiling = { ids: [], labels: [], ok: false }

/**
 * The categories a look is currently filed in. Used to open the Save box with its filing already
 * ticked, so "can it just stay in the categories it was in" is answered by the screen.
 *
 * Scoped to the client's own taxonomy, so a category id that belongs to somebody else can never
 * come back and be re-written under her name.
 */
export async function readLookFiling(lookId: string | null, clientId: string | null): Promise<LookFiling> {
  if (!lookId || !clientId) return { ids: [], labels: [], ok: true }   // nothing to read is not a failure

  const { data: assignments, error: aErr } = await supabase
    .from('look_category_assignments')
    .select('category_id')
    .eq('look_id', lookId)
  if (aErr) { console.error('readLookFiling assignments:', aErr.message); return EMPTY }

  const ids = [...new Set((assignments ?? []).map((a) => (a as { category_id: string }).category_id))]
  if (!ids.length) return { ids: [], labels: [], ok: true }

  const { data: cats, error: cErr } = await supabase
    .from('look_categories')
    .select('id, label')
    .eq('client_id', clientId)
    .in('id', ids)
  if (cErr) { console.error('readLookFiling categories:', cErr.message); return EMPTY }

  const rows = (cats ?? []) as { id: string; label: string }[]
  return { ids: rows.map((c) => c.id), labels: rows.map((c) => c.label), ok: true }
}

/** Case-insensitive, because the pills are labels and createCategory dedupes the same way. */
const key = (s: string) => s.trim().toLowerCase()

export interface FilingChange {
  added: string[]
  removed: string[]
  /** Labels with no category row, left alone rather than guessed at. */
  unresolved: string[]
}

/**
 * File the look where the stylist just said it goes.
 *
 * `baseline` is what the box was OPENED with — see the safety note above. `selected` is what she
 * left ticked. Only the difference is written, so a save that changed nothing writes nothing.
 *
 * Runs AFTER the row is saved, and after lookTransitions has carried a replacement's filing
 * across, so this is the last word and the two cannot fight.
 */
export async function applyLookFiling(
  lookId: string,
  clientId: string,
  baseline: string[],
  selected: string[],
): Promise<FilingChange> {
  const change: FilingChange = { added: [], removed: [], unresolved: [] }

  const want = new Set(selected.map(key))
  const had = new Set(baseline.map(key))
  const toAdd = [...want].filter((k) => !had.has(k))
  const toRemove = [...had].filter((k) => !want.has(k))
  if (!toAdd.length && !toRemove.length) return change

  const { data: cats, error } = await supabase
    .from('look_categories')
    .select('id, label')
    .eq('client_id', clientId)
  if (error) { console.error('applyLookFiling categories:', error.message); return change }

  const byLabel = new Map<string, string>()
  for (const c of (cats ?? []) as { id: string; label: string }[]) byLabel.set(key(c.label), c.id)

  const addIds: string[] = []
  for (const k of toAdd) {
    const id = byLabel.get(k)
    // The dialog persists a brand-new category before it hands the labels back, so a miss here
    // means the category was renamed or deleted between opening and saving. Named, not guessed.
    if (id) addIds.push(id); else change.unresolved.push(k)
  }
  const removeIds: string[] = []
  for (const k of toRemove) {
    const id = byLabel.get(k)
    if (id) removeIds.push(id)   // a label with no row is already not filed: nothing to remove
  }

  if (addIds.length) {
    const { error: iErr } = await supabase
      .from('look_category_assignments')
      .upsert(addIds.map((category_id) => ({ look_id: lookId, category_id })))
    if (iErr) console.error('applyLookFiling add:', iErr.message)
    else change.added = addIds
  }
  if (removeIds.length) {
    const { error: dErr } = await supabase
      .from('look_category_assignments')
      .delete()
      .eq('look_id', lookId)
      .in('category_id', removeIds)
    if (dErr) console.error('applyLookFiling remove:', dErr.message)
    else change.removed = removeIds
  }
  return change
}
