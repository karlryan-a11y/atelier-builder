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
 * What a click on a card does.
 *
 * WITH TAGGING OFF, A CLICK PICKS THE LOOK. ADR-0138. Cynthia Dada, 2026-09-22, on the checkbox
 * that shipped that morning: "Would it be possible to just click anywhere on the look instead of
 * ticking the box". Until now this returned 'nothing' in that state, so the FIRST click on a card
 * did nothing at all and every click after the first one selected — the same invisible asymmetry
 * the checkbox was added to fix, one layer up. The tick box stays: it is what shows a card can be
 * picked, and it is the only way this works on an iPad.
 *
 * WITH TAGGING ON, A CLICK STILL FILES. That is ADR-0123 and it is not negotiable here: the rail
 * used to re-file any look clicked under it, silently, which is the defect Cynthia reported on
 * 2026-09-15. A stylist who deliberately turns the switch on is filing, not browsing.
 *
 * Shift-click, and any click while a selection is open, always selects. That is the muscle memory
 * and it outranks everything.
 */
export function cardClickAction(opts: {
  shiftKey: boolean
  selecting: boolean
  tagging: boolean
  categoryId: string | null
}): CardClick {
  if (opts.shiftKey || opts.selecting) return 'select'
  // Tagging on: file it, or do nothing until she has picked the category to file it into.
  if (opts.tagging) return opts.categoryId ? 'tag' : 'nothing'
  return 'select'
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

/**
 * "Select all" on the bar above the grid. It is how a whole category gets added to another
 * one: filter to FW Business Professional, select all 14, pick Business Professional on the
 * left, press "+ Business Professional".
 *
 * Cynthia Dada, on Janet Foutty, 2026-09-17: "I now need to create a Business Professional
 * category so that I can include all FW and SS looks in there." Without this the only way to
 * open a selection is shift-click, which does not exist on the tablet the builder is used on,
 * and which meant clicking all 14 by hand.
 *
 * It adds the looks in view WITHOUT touching a selection made outside the current filter, so
 * she can gather from two categories before applying. When everything in view is already
 * selected it takes those back out, and only those.
 */
export function selectAllToggle(visibleIds: string[], selected: Iterable<string>): string[] {
  const next = new Set(selected)
  const allIn = visibleIds.length > 0 && visibleIds.every((id) => next.has(id))
  for (const id of visibleIds) {
    if (allIn) next.delete(id)
    else next.add(id)
  }
  return [...next]
}

/**
 * Whether the bar offers "Select all", and what it says. Hidden while tagging is on: tagging
 * drops the filter (a grid of only the looks already in a category leaves nothing to add), so
 * there "all" means her entire gallery, which is never the thing she meant.
 */
export function selectAllLabel(opts: {
  mode: string
  tagging: boolean
  visibleCount: number
  selectedInViewCount: number
}): string | null {
  if (opts.mode !== 'looks' && opts.mode !== 'capsules') return null
  if (opts.tagging || opts.visibleCount === 0) return null
  return opts.selectedInViewCount === opts.visibleCount
    ? `Deselect all ${opts.visibleCount}`
    : `Select all ${opts.visibleCount}`
}
