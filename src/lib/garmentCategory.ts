// Garment-category helpers that layer CUSTOM (per-client) categories on top of the
// fixed taxonomy in `categorize.ts` — without modifying the shared resolver.
//
// Model: gp_closet_items.category holds ONE slug. A stored override wins outright
// (fixed slug like "dresses" OR a custom slug like "rompers"); only when there's no
// override do we fall back to tag/name detection. Custom categories are "created"
// simply by assigning an item to a new slug — no separate registry table needed.
import { CATEGORY_LABELS, resolveCategory } from './categorize'
import { displayName, type ClosetItem } from './images'

/** A fixed-taxonomy slug (in categorize.ts), e.g. 'dresses', 'hats'. */
export function isFixedCategory(slug: string): boolean {
  return slug in CATEGORY_LABELS
}

/** Display label for any slug — fixed label if known, else Title-Cased custom slug. */
export function labelForCategory(slug: string): string {
  return (CATEGORY_LABELS as Record<string, string>)[slug]
    ?? slug.replace(/(^|[\s-])(\w)/g, (_m, p: string, c: string) => p + c.toUpperCase())
}

/**
 * The item's PRIMARY category only: stored override (fixed OR custom) wins, else resolved from
 * tags/name.
 *
 * Use this for DISPLAY (a card's one-line label, preselecting the edit dropdown). Do NOT use it
 * to decide whether an item belongs to a category the user picked — an item can be in several
 * (its garment type plus any "Also in" in custom_categories[]), and this returns only the first.
 * For filtering and for counts, use `categoriesOf`.
 *
 * Named `primaryCategoryOf` deliberately: it was `categoryOf`, one letter from `categoriesOf`,
 * and the canvas closet panel filtered on it for six weeks. Margaux's "New-York-City" read 50
 * pieces in Collection and 4 on the canvas, because 46 carried it as an "Also in".
 */
export function primaryCategoryOf(item: ClosetItem, tagNames: string[] = []): string {
  const override = (item.category ?? '').trim().toLowerCase()
  if (override) return override
  return resolveCategory({ name: displayName(item), category: null }, tagNames)
}

/**
 * ALL categories an item belongs to: its primary garment category first, then any
 * additional "Also in" groupings from `custom_categories[]` (e.g. an item that is a
 * Top AND in the client's "49ers" custom category). Deduped; empties dropped.
 */
export function categoriesOf(item: ClosetItem, tagNames: string[] = []): string[] {
  const out: string[] = []
  const primary = primaryCategoryOf(item, tagNames)
  if (primary) out.push(primary)
  for (const c of item.custom_categories ?? []) {
    const slug = slugifyCategory(String(c))
    if (slug && !out.includes(slug)) out.push(slug)
  }
  return out
}

/** Turn a typed label into a stable slug, e.g. "Rompers" -> "rompers". */
export function slugifyCategory(label: string): string {
  return label.trim().toLowerCase()
    // Strip accents/diacritics first (è→e, é→e, ñ→n) so "Brassières" → "brassieres",
    // not "brassi-res" — otherwise accented letters get turned into stray dashes.
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Distinct custom categories (slug + label) actually used across a client's items —
 *  from BOTH the primary `category` slug and the `custom_categories[]` "Also in" groupings. */
export function customCategoriesFromItems(items: ClosetItem[]): { slug: string; label: string }[] {
  const slugs = new Set<string>()
  for (const i of items) {
    const c = (i.category ?? '').trim().toLowerCase()
    if (c && !isFixedCategory(c)) slugs.add(c)
    for (const cc of i.custom_categories ?? []) {
      const s = slugifyCategory(String(cc))
      if (s && !isFixedCategory(s)) slugs.add(s)
    }
  }
  return [...slugs].sort().map((slug) => ({ slug, label: labelForCategory(slug) }))
}
