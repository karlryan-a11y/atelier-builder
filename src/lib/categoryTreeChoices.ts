/**
 * The two-step category picker: one of her main categories, then a subcategory inside it.
 * (Paige Berndt, 2026-11-11: "select a main category and then choose a subcategory within it".)
 *
 * Built from her closet tree (client_categories, useClientCategories). A client with no nesting
 * gets null, and her dropdown stays the single list it is today (lib/categoryChoices.ts).
 *
 * The first box offers her main categories first, in the order her tree lists them ("Her
 * categories"), then everything else the single list offered ("More categories"), so a stylist
 * can still file a piece anywhere. A category that sits inside another moves to the second box
 * under its parent. A home is never offered: it is where a piece lives, not what it is.
 *
 * Picking a subcategory saves the subcategory alone. Her tree rolls it up to its main category
 * everywhere (lib/categoryNesting.ts withAncestors), which is also how Needs Review's approval
 * saves it (wsg-dashboard closetPatch: closet_sub, else closet_category).
 *
 * The Subcategory box also offers "＋ New subcategory…" under any main category, including one with
 * nothing inside it yet and for a client with no tree at all (planNewSubcategory below).
 */
import type { CategoryChoice } from '@/lib/categoryChoices'
import { categoryKey } from '@/lib/categoryNesting'
import { CATEGORY_LABELS } from '@/lib/categorize'

// garmentCategory's labelForCategory, kept here so this file runs on its own in its check.
const labelForCategory = (slug: string) => (CATEGORY_LABELS as Record<string, string>)[slug]
  ?? slug.replace(/-/g, ' ').replace(/(^|\s)(\w)/g, (_m, p: string, c: string) => p + c.toUpperCase())

export interface TreeChoiceRow {
  slug: string
  label: string | null
  parent_slug: string | null
  sort_order: number
  same_as?: string | null
  is_hidden?: boolean | null
}

export interface TreeChoices {
  /** Her main categories: top-level categories of her tree that have something inside them. */
  mains: CategoryChoice[]
  /** The rest of the single list, minus anything nested and any home. */
  others: CategoryChoice[]
  /** main slug -> its subcategories, in her order. */
  subsOf: Map<string, CategoryChoice[]>
  /** subcategory slug -> its main. */
  mainOf: Map<string, string>
}

export function treeChoices(
  rows: TreeChoiceRow[],
  single: { mine: CategoryChoice[]; more: CategoryChoice[] },
  homes: Iterable<string> = [],
): TreeChoices | null {
  const live = rows.filter((r) => r.slug && !r.is_hidden && !(r.same_as ?? '').trim())
  const home = new Set([...homes].map(categoryKey))
  const isHome = (slug: string) => home.has(categoryKey(slug))
  const rowOf = new Map(live.map((r) => [r.slug, r]))
  const label = (slug: string) => (rowOf.get(slug)?.label ?? '').trim() || labelForCategory(slug)
  const order = (a: string, b: string) => (rowOf.get(a)?.sort_order ?? 1e9) - (rowOf.get(b)?.sort_order ?? 1e9) || label(a).localeCompare(label(b))

  const mainOf = new Map<string, string>()
  const subsOf = new Map<string, CategoryChoice[]>()
  for (const r of live) {
    const parent = (r.parent_slug ?? '').trim().toLowerCase()
    if (!parent || parent === r.slug || isHome(r.slug) || isHome(parent)) continue
    mainOf.set(r.slug, parent)
  }
  if (mainOf.size === 0) return null
  // Two levels only, as her Collection draws them: a subcategory's own children sit beside it.
  const top = (slug: string) => { let s = slug; for (let i = 0; i < 8 && mainOf.has(s); i++) s = mainOf.get(s)!; return s }
  for (const [sub] of mainOf) mainOf.set(sub, top(sub))
  for (const [sub, main] of mainOf) subsOf.set(main, [...(subsOf.get(main) ?? []), { slug: sub, label: label(sub) }])
  for (const [main, list] of subsOf) subsOf.set(main, list.sort((a, b) => order(a.slug, b.slug)))

  const mainSlugs = new Set([...subsOf.keys()])
  const mains = [...mainSlugs].sort(order).map((slug) => ({ slug, label: label(slug) }))
  const seen = new Set([...mainSlugs, ...mainOf.keys()])
  const others: CategoryChoice[] = []
  for (const c of [...single.mine, ...single.more]) {
    if (seen.has(c.slug) || isHome(c.slug) || isHome(c.label)) continue
    seen.add(c.slug)
    others.push(c)
  }
  return { mains, others, subsOf, mainOf }
}

/**
 * "＋ New subcategory…" in Edit Item (Paige Berndt for Barbie Beltran, 2026-11-12: Bag Charms under
 * Handbags & Small Leather Goods). What adding `name` under her main category `main` does to her rows:
 *  - reuse: a subcategory of that name is already inside it (typed again, any spelling), so no second one
 *  - nest:  a top-level category of hers with that name and nothing inside it moves inside the main
 *  - add:   a new row, inside the main
 *  - no:    it can't go there, and `message` says why in her words
 * The piece is then filed under `slug`, and her tree rolls it up to the main everywhere.
 */
export type NewSubcategoryPlan =
  | { action: 'reuse' | 'nest' | 'add'; slug: string; label: string }
  | { action: 'no'; message: string }

export function planNewSubcategory(
  rows: TreeChoiceRow[],
  main: string,
  name: string,
  homes: Iterable<string> = [],
): NewSubcategoryPlan {
  const label = name.trim().replace(/\s+/g, ' ')
  const typed = categoryKey(label)
  const parent = categoryKey(main)
  if (!typed) return { action: 'no', message: 'Give the subcategory a name.' }
  if (!parent) return { action: 'no', message: 'Pick a main category first.' }
  // Her own row of that name, by slug or by its label ("Handbags & Small Leather Goods" is handbags-and-...).
  const same = rows.find((r) => r.slug === typed) ?? rows.find((r) => categoryKey(r.label) === typed)
  const slug = same?.slug ?? typed
  if (slug === parent) return { action: 'no', message: `A category can't sit inside itself.` }
  if (new Set([...homes].map(categoryKey)).has(slug)) {
    return { action: 'no', message: `"${label}" is one of her homes, not a kind of piece. Add it under "Also in" instead.` }
  }
  const nameOf = (r: TreeChoiceRow) => (r.label ?? '').trim() || labelForCategory(r.slug)
  const parentOf = (r: TreeChoiceRow) => (r.parent_slug ?? '').trim().toLowerCase()
  const inside = rows.find((r) => parentOf(r) === parent && (r.slug === slug || categoryKey(r.label) === typed))
  if (inside) return { action: 'reuse', slug: inside.slug, label: nameOf(inside) }
  const row = same
  if (!row) return { action: 'add', slug, label }
  const where = parentOf(row)
  if (where && where !== row.slug) {
    const mainRow = rows.find((r) => r.slug === where)
    return { action: 'no', message: `"${nameOf(row)}" is already inside ${mainRow ? nameOf(mainRow) : labelForCategory(where)}. Pick it there, or move it in Categorize > Nesting.` }
  }
  if (rows.some((r) => parentOf(r) === slug && r.slug !== slug)) {
    return { action: 'no', message: `"${nameOf(row)}" is already a main category with its own subcategories.` }
  }
  if ((row.same_as ?? '').trim() || row.is_hidden) {
    return { action: 'no', message: `"${nameOf(row)}" is set up in Categorize as hidden or the same as another category. Change it there first.` }
  }
  return { action: 'nest', slug, label: nameOf(row) }
}
