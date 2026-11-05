/**
 * WHAT THE SAVE BOX OPENS WITH, AND WHAT ITS SAVE COMPARES AGAINST. Two different things.
 *
 * Cynthia Dada, 2026-11-05, Janet Foutty's Look 401: she duplicated a look, ticked Fall/Winter and
 * Easy Professional in Save Look, saved, and Categorize showed the new look as UNCATEGORIZED. "It's
 * happening to looks not duplicated too." Look 393 the same morning was ticked both and filed in one.
 *
 * The box used ONE list for both jobs: the pills it showed ticked, and the BASELINE applyLookFiling
 * diffs against ("only the difference is written"). After a first save that list became the saved
 * look's categories, but the board stayed a new look, so the next new look (a duplicate or one
 * started from scratch) opened with those pills on AND a baseline saying it was already filed
 * there. Ticked = baseline, so nothing was written. A look with old `tags` and no filing did the
 * same: the tags were shown ticked and also taken as the baseline.
 *
 * The rule here: the baseline is only ever where the look IS filed. A look that has no row yet is
 * filed nowhere, whatever is ticked. The ticks may come from elsewhere (old tags, the look it was
 * duplicated from); the baseline never does.
 */

export interface SaveBoxStart {
  /** Labels shown ticked when the box opens. */
  shown: string[]
  /** Labels the look is really filed in. The save writes the difference from this. */
  baseline: string[]
  /** False when the filing read failed: the save may then add but never remove. */
  ok: boolean
}

export function saveBoxStart(opts: {
  /** The saved look this board edits or replaces; null for a look that has no row yet. */
  filedLookId: string | null
  /** Where that look is filed (labels), and whether the read worked. Ignored for a new look. */
  filed: { labels: string[]; ok: boolean }
  /** That look's old `gp_looks.tags`, shown when it is filed nowhere so the next save files it. */
  legacyTags: string[]
  /** For a duplicate: the categories of the look it was copied from, offered ticked. */
  copiedFrom: string[]
}): SaveBoxStart {
  if (!opts.filedLookId) return { shown: [...opts.copiedFrom], baseline: [], ok: true }
  const labels = opts.filed.labels
  return { shown: labels.length ? [...labels] : [...opts.legacyTags], baseline: [...labels], ok: opts.filed.ok }
}
