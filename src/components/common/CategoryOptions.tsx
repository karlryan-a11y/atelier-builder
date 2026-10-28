import { splitCategoryChoices, type CategoryChoice } from '@/lib/categoryChoices'
import { STANDARD_COLLECTIONS, type StdCategory, type StdSub } from '@/lib/standardTree'

/**
 * The <option>s of a category dropdown: "Her categories" first, then "More categories"
 * (lib/categoryChoices.ts). For a client with no categories yet: the fixed list, then Custom.
 * `omit` drops slugs that should not be offered here (the current primary, ones already added).
 *
 * `tree` (Maegan's standard categories, 2026-10-20): her Collections first, then each of the 19
 * categories with its sub-categories, so a piece is filed where her Wardrobe shows it and tagged
 * into Eveningwear or Resort & Beach. Everything offered before still follows.
 */
export function CategoryOptions({ custom, used, omit, tree }: {
  custom: CategoryChoice[]
  used: Set<string> | null | undefined
  omit?: (slug: string) => boolean
  tree?: { categories: StdCategory[]; subs: StdSub[] } | null
}) {
  const { grouped, mine, more } = splitCategoryChoices(custom, used)
  // A slug the tree already offers is not offered twice.
  const offered = new Set(tree ? [...STANDARD_COLLECTIONS, ...tree.categories, ...tree.subs].map((c) => c.slug) : [])
  const keep = (c: CategoryChoice) => !omit?.(c.slug) && !offered.has(c.slug)
  const keepStd = (c: CategoryChoice) => !omit?.(c.slug)
  const opts = (list: CategoryChoice[]) => list.filter(keep).map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)
  const stdOpts = (list: CategoryChoice[]) => list.filter(keepStd).map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)
  const standard = tree ? (
    <>
      <optgroup label="Collections">{stdOpts(STANDARD_COLLECTIONS)}</optgroup>
      {tree.categories.map((c) => (
        <optgroup key={c.slug} label={c.label}>{stdOpts([{ slug: c.slug, label: `${c.label} (any)` }, ...tree.subs.filter((s) => s.parent === c.slug)])}</optgroup>
      ))}
    </>
  ) : null
  if (!grouped) {
    return (
      <>
        {standard}
        {opts(more)}
        {mine.filter(keep).length > 0 && <optgroup label="Custom">{opts(mine)}</optgroup>}
      </>
    )
  }
  return (
    <>
      {standard}
      {mine.filter(keep).length > 0 && <optgroup label="Her categories">{opts(mine)}</optgroup>}
      {more.filter(keep).length > 0 && <optgroup label="More categories">{opts(more)}</optgroup>}
    </>
  )
}
