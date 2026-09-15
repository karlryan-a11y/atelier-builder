/**
 * The Looks and Capsules tabs of Categorize: what a category click SHOWS, and what a card
 * click DOES.
 *
 * Until 2026-09-15 a category click there picked a "brush": nothing on the grid changed, and
 * every card clicked afterwards had that category silently added or removed. Cynthia Dada, on
 * Janet Foutty: "When I click on a category in the back end, it doesn't populate the looks in
 * that category." The Collection tab next door filters on the same gesture, so that was the
 * reasonable thing to expect, and the brush was re-filing looks for anyone who expected it.
 *
 * Now a category click filters, and tagging is a switch she turns on. With the switch off a
 * card click never writes. Kept pure and in one place so scripts/check-look-category-filter.mjs
 * exercises the code that ships.
 */
import { parentMapFrom, ancestorsOf, type NestingRow } from './categoryNesting.ts'

export interface FilterCategory {
  id: string
  slug: string
  label: string | null
  parent_slug: string | null
}

/**
 * The category ids a filter on `categoryId` should match: the category itself plus every
 * category nested under it. A heading is a filter too (the Nesting tab promises exactly that).
 */
export function categoryIdsUnder(categoryId: string, categories: FilterCategory[]): Set<string> {
  const ids = new Set<string>([categoryId])
  const picked = categories.find((c) => c.id === categoryId)
  if (!picked) return ids
  const rows: NestingRow[] = categories.map((c) => ({ slug: c.slug, label: c.label, parent_slug: c.parent_slug, sort_order: 0 }))
  const parents = parentMapFrom(rows)
  const pickedSlug = picked.slug.trim().toLowerCase()
  for (const c of categories) {
    if (ancestorsOf(c.slug.trim().toLowerCase(), parents).includes(pickedSlug)) ids.add(c.id)
  }
  return ids
}

/**
 * The cards the grid shows. `null` means every card.
 *
 * While tagging is on the filter is NOT applied: tagging is how a look gets INTO a category,
 * and a grid showing only the looks already in it would leave nothing to add.
 */
export function filterByCategory<T extends { categoryIds: string[] }>(
  items: T[],
  categoryId: string | null,
  categories: FilterCategory[],
  tagging: boolean,
): T[] {
  if (!categoryId || tagging) return items
  const ids = categoryIdsUnder(categoryId, categories)
  return items.filter((i) => i.categoryIds.some((c) => ids.has(c)))
}

export type CardClick = 'select' | 'tag' | 'nothing'

/**
 * What a click on a card does. Shift-click, or any click while a selection is open, selects.
 * Otherwise it tags ONLY when the switch is on and a category is picked. Everything else is a
 * no-op, which is the point: a click made while browsing can never re-file a look.
 */
export function cardClickAction(opts: {
  shiftKey: boolean
  selecting: boolean
  tagging: boolean
  categoryId: string | null
}): CardClick {
  if (opts.shiftKey || opts.selecting) return 'select'
  if (opts.tagging && opts.categoryId) return 'tag'
  return 'nothing'
}

/**
 * The "On lookbook" grid saves its card order as the client's gallery order. Filtered, it is
 * holding a subset, and saving that subset as positions 0..n would stamp those looks over the
 * first n slots of her whole gallery.
 *
 * So the subset's new order is written back into the slots the subset already held, and every
 * other look keeps its place. With no filter the subset is the whole list and this returns it.
 */
export function mergeSubsetOrder(fullIds: string[], subsetOrderedIds: string[]): string[] {
  const inSubset = new Set(subsetOrderedIds)
  let next = 0
  return fullIds.map((id) => (inSubset.has(id) ? subsetOrderedIds[next++] : id))
}
