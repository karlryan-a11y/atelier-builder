/**
 * TAKE PIECES OUT OF ONE CATEGORY (Cynthia Dada for Peyton Wheeler, 2026-11-11: "How can I remove all
 * 71 items out of the accessories category at once?"). Set category and Also add to only ever put a
 * piece IN; this is the way out, for the selected pieces, in one step.
 *
 * A piece can be in a category two ways, and each is undone on its own:
 *   - as an "Also in" (custom_categories): that one entry comes off, every other one stays;
 *   - as its main category: it moves to No category ('other', the rail's "No category" row), so she
 *     can re-file it. Left empty instead, the name would file it again: "The Fish Bag Charm" would
 *     land in Handbags and "Faux Fur Trim Collar" in Outerwear.
 * A piece in the category only through her nesting (filed under a subcategory) is not changed.
 *
 * No imports, so scripts/check-remove-from-category.mjs runs it as it is.
 */

/** The rail's "No category" row (CategorizePanel, data-no-category). */
export const NO_CATEGORY = 'other'

export type RemovalPatch = { category?: string; custom_categories?: string[] | null }

/**
 * What to write on one piece to take it out of `slug`, or null when it is not filed there directly.
 * `primary` is its main category as the screen resolves it (primaryCategoryOf); `also` its
 * custom_categories as slugs (slugifyCategory). Its other categories are never touched.
 */
export function removalFrom(slug: string, piece: { primary: string; also: string[] }): RemovalPatch | null {
  if (!slug || slug === NO_CATEGORY) return null
  const patch: RemovalPatch = {}
  if (piece.also.includes(slug)) {
    const kept = piece.also.filter((c) => c !== slug)
    patch.custom_categories = kept.length ? kept : null
  }
  if (piece.primary === slug) patch.category = NO_CATEGORY
  return Object.keys(patch).length ? patch : null
}

/**
 * What the confirm and the note say. A category can be a heading with others inside it (Peyton made
 * Accessories one over Hats, Tights and Headbands, 2026-11-11 17:28): picking it selects those pieces
 * too, and a piece filed in Tights still shows under Accessories after its own Accessories filing comes
 * off. So the words say how many still show under the heading, and why.
 *   inside:     selected pieces in it only through a category inside it (nothing to take off)
 *   keptInside: pieces taken off that still show under it through a category inside it
 */
export function removalWords(label: string, counts: { changed: number; toNone: number; inside: number; keptInside: number }, insideLabels: string[]): { confirm: string; note: string } {
  const n = (k: number) => `${k} piece${k === 1 ? '' : 's'}`
  const where = insideLabels.length ? ` (${insideLabels.join(', ')})` : ''
  const still = counts.inside + counts.keptInside
  const stay = still
    ? `${n(still)} filed in the categories inside ${label}${where} still show under it` +
      (counts.keptInside ? `, ${counts.keptInside} of these ${counts.changed} among them` : '') + '.'
    : ''
  const confirm = `Take ${n(counts.changed)} out of ${label}?\n\n` +
    (counts.changed - counts.toNone ? `${n(counts.changed - counts.toNone)} keep their other categories.\n` : '') +
    (counts.toNone ? `${n(counts.toNone)} had ${label} as their only category and move to No category, for you to re-file.\n` : '') +
    (stay ? stay + '\n' : '') +
    `Nothing is deleted.`
  const note = `Took ${n(counts.changed)} out of ${label}.` +
    (counts.toNone ? ` ${counts.toNone} moved to No category.` : '') +
    (stay ? ' ' + stay : '')
  return { confirm, note }
}
