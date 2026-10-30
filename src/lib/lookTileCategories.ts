/**
 * What a tile on the Style page's Looks grid says about where the look is filed.
 *
 * Maegan Watson, Zoom clip 2026-09-29: "we need to be able to easily tell and easily select the
 * category from this particular view." The tile used to print `look.tags`, cut off after about
 * 15 characters. Tags are not filing (ADR-0149): on 2026-10-28, 16 of Janet Foutty's 99 tiles
 * named categories the look was not in, and Look 138 read "Easy Professional, ..." while filed
 * in nothing.
 *
 * So a tile reads `look_category_assignments`, the same filing Categorize and her look page use:
 *   - the categories she can see (hidden ones are off her site), in her order, seasons last,
 *     the way her look page lists them (atelier-looks lookFiledUnder.ts);
 *   - "No category" by the same rule as Categorize's Uncategorized row (a home or season alone
 *     does not count), so the two screens never disagree about which looks still need filing.
 * Kept pure so scripts/check-look-tile-categories.mjs runs the code that ships.
 */
import { byCategoryOrder } from './categoryOrder.ts'
import { isUncategorized } from './lookCategoryFilter.ts'

export interface TileCategory {
  id: string
  label: string
  sort_order?: number | null
  is_hidden?: boolean | null
  is_residence?: boolean | null
  season?: string | null
}

export interface TileFiling {
  /** The labels to show on the tile, in her order, seasons last. */
  labels: string[]
  /** True when Categorize would list this look under Uncategorized. */
  uncategorized: boolean
}

export function lookTileFiling(categoryIds: string[], categories: TileCategory[]): TileFiling {
  const ids = new Set(categoryIds)
  const filed = categories.filter((c) => ids.has(c.id) && !c.is_hidden).sort(byCategoryOrder)
  const plain = filed.filter((c) => !c.season)
  const seasons = filed.filter((c) => !!c.season)
  return {
    labels: [...plain, ...seasons].map((c) => c.label.trim()).filter(Boolean),
    uncategorized: isUncategorized(categoryIds, categories.map((c) => ({
      id: c.id, is_hidden: !!c.is_hidden, is_residence: !!c.is_residence, season: c.season ?? null,
    }))),
  }
}

/** The categories the tile's picker offers: every one she can see, in her order. */
export function tilePickerCategories<T extends TileCategory>(categories: T[]): T[] {
  return categories.filter((c) => !c.is_hidden).sort(byCategoryOrder)
}
