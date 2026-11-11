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
