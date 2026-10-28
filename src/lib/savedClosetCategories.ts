/**
 * Collection categories she made before filing anything in them. (Cynthia Dada, 2026-10-20)
 *
 * "Can you make a way to add categories without adding items to it? Like how you can add
 * categories in looks." A Collection category used to exist only because a piece said so
 * (`category` or `custom_categories` on gp_closet_items), so an empty one could not exist.
 *
 * The New category box on the Collection tab saves a `client_categories` row with
 * kind 'custom', the value migration 006 set aside for exactly this. Only those rows count
 * here. Rows the Nesting and Same as screens write are kind 'garment' and say something about
 * a category that already exists; they are not new categories and stay out of this list.
 *
 * Her site does not read this list. It builds its chips from piece counts and drops anything
 * at zero (ADR-0108: a filter she can tap returns something), so an empty category stays off
 * her closet until a piece is filed in it.
 */
import { CATEGORY_LABELS } from './categorize'

export interface SavedCategoryRow {
  slug: string
  label: string | null
  kind?: string | null
  same_as?: string | null
  is_hidden?: boolean | null
}

export interface CategoryChoice { slug: string; label: string }

/** Her own new categories: kind 'custom', not hidden, not read as another one, not a standard slug. */
export function savedCustomCategories(rows: SavedCategoryRow[]): CategoryChoice[] {
  const out: CategoryChoice[] = []
  for (const r of rows) {
    const slug = (r.slug ?? '').trim().toLowerCase()
    if (!slug || r.kind !== 'custom' || r.is_hidden || (r.same_as ?? '').trim()) continue
    if (slug in CATEGORY_LABELS || out.some((c) => c.slug === slug)) continue
    out.push({ slug, label: (r.label ?? '').trim() || slug })
  }
  return out
}

/**
 * The categories from her pieces plus her saved ones, each once, sorted by slug the way
 * customCategoriesFromItems sorts. A saved one keeps the name she typed, as the rail shows it.
 * Nothing saved returns the same list untouched.
 */
export function withSavedCategories(fromItems: CategoryChoice[], saved: CategoryChoice[]): CategoryChoice[] {
  if (saved.length === 0) return fromItems
  const bySlug = new Map(fromItems.map((c) => [c.slug, c]))
  for (const c of saved) bySlug.set(c.slug, c)
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug))
}

/**
 * The Custom rows of the Collection rail: every non-standard category her pieces are in, plus
 * her saved ones at 0. Homes have their own block above and stay out of this one.
 */
export function customRailSlugs(
  counts: Map<string, number>,
  savedSlugs: string[],
  keep: (slug: string) => boolean,
): string[] {
  const out = new Set<string>()
  for (const [s, n] of counts) if (s !== '__total__' && !(s in CATEGORY_LABELS) && keep(s) && n > 0) out.add(s)
  for (const s of savedSlugs) if (!(s in CATEGORY_LABELS) && keep(s)) out.add(s)
  return [...out].sort()
}

export interface RailRow { slug: string; depth: number }

/**
 * The Custom rows with each subcategory right under its category, indented by `depth`. (Cynthia
 * Dada for Chris Cadieux, 2026-10-16: Blazers & Suit Jackets over Blazers & Sport Coats, Suit
 * Jackets and Other Tailored Jackets.) His lookbook already nested them; this rail listed them
 * alphabetically among everything else.
 *
 * `parentOf` is the client's tree (Nesting). A category nests only when its parent is in this
 * list too; one whose parent is a standard category (Jackets inside Outerwear) stays at the top,
 * as before. Children follow `rank` (the order she saved them in), then the alphabet. With no tree
 * this returns the list it was given, in its order.
 */
export function nestRailSlugs(
  slugs: string[],
  parentOf: (slug: string) => string | undefined,
  rank: (slug: string) => number = () => 0,
): RailRow[] {
  const listed = new Set(slugs)
  const children = new Map<string, string[]>()
  const tops: string[] = []
  for (const s of slugs) {
    const p = parentOf(s)
    if (p && p !== s && listed.has(p)) children.set(p, [...(children.get(p) ?? []), s])
    else tops.push(s)
  }
  const out: RailRow[] = []
  const seen = new Set<string>()
  const walk = (s: string, depth: number) => {
    if (seen.has(s)) return
    seen.add(s)
    out.push({ slug: s, depth })
    const kids = [...(children.get(s) ?? [])].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    for (const k of kids) walk(k, depth + 1)
  }
  for (const s of tops) walk(s, 0)
  // A tree that loops (A inside B inside A) has no top: what is left is listed so nothing drops out.
  for (const s of slugs) walk(s, 0)
  return out
}
