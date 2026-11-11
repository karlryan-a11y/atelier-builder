// Her own name for a closet category (Cynthia Dada for Peyton Wheeler, 11/11): "Blazers & Tailored
// Jackets" can read "Blazers & Suiting" for one client, typed in Categorize > Nesting.
//
// Stored in gp_clients.raw.category_names as { slug: name }, like the Custom heading
// (lib/customHeading.ts): a per-client setting nothing else rewrites, so a rename never touches
// another client, a piece, the nesting or any count. Only the words on screen change. A category
// with no saved name reads exactly as it did before.
//
// The lookbook reads it with the twin of this file, atelier-looks src/lib/categoryNames.ts
// (scripts/check-category-names.mjs keeps them in step).
//
// No imports on purpose, so the check can run this file as it is.

export const CATEGORY_NAME_MAX = 40

/** The key a name is saved under. The same rule as categoryKey in lib/categoryNesting.ts. */
export function categoryNameKey(slug: string | null | undefined): string {
  return (slug ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** A typed name, tidied: spaces collapsed, capped. Empty means "no name typed". */
export function cleanCategoryName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, CATEGORY_NAME_MAX).trim()
}

/** Every name a stylist saved for this client, by category key. Blank ones are dropped. */
export function categoryNamesOf(raw: unknown): Record<string, string> {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const saved = r.category_names && typeof r.category_names === 'object' ? (r.category_names as Record<string, unknown>) : {}
  const out: Record<string, string> = {}
  for (const [slug, name] of Object.entries(saved)) {
    const key = categoryNameKey(slug)
    const clean = cleanCategoryName(name)
    if (key && clean) out[key] = clean
  }
  return out
}

/** What a category is called for her: her saved name, else the name it already had. */
export function nameForCategory(slug: string, names: Record<string, string>, standard: string): string {
  return names[categoryNameKey(slug)] ?? standard
}

/**
 * Her raw with one category's name set. Typing the name it already had takes the saved name off.
 * Returns null for an empty name: a category can never be saved with no name.
 * Nothing else in raw moves.
 */
export function withCategoryName(raw: unknown, slug: string, name: string, standard: string): Record<string, unknown> | null {
  const key = categoryNameKey(slug)
  const clean = cleanCategoryName(name)
  if (!key || !clean) return null
  const out = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}
  const names = { ...categoryNamesOf(out) }
  if (clean === cleanCategoryName(standard)) delete names[key]
  else names[key] = clean
  if (Object.keys(names).length) out.category_names = names
  else delete out.category_names
  return out
}
