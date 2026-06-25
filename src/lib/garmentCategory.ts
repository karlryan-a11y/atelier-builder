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

/** Effective category for an item: stored override (fixed OR custom) wins; else resolve. */
export function categoryOf(item: ClosetItem, tagNames: string[] = []): string {
  const override = (item.category ?? '').trim().toLowerCase()
  if (override) return override
  return resolveCategory({ name: displayName(item), category: null }, tagNames)
}

/** Turn a typed label into a stable slug, e.g. "Rompers" -> "rompers". */
export function slugifyCategory(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Distinct custom categories (slug + label) actually used across a client's items. */
export function customCategoriesFromItems(items: ClosetItem[]): { slug: string; label: string }[] {
  const slugs = new Set<string>()
  for (const i of items) {
    const c = (i.category ?? '').trim().toLowerCase()
    if (c && !isFixedCategory(c)) slugs.add(c)
  }
  return [...slugs].sort().map((slug) => ({ slug, label: labelForCategory(slug) }))
}
