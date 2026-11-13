import { splitCategoryChoices, type CategoryChoice } from '@/lib/categoryChoices'
import { nameForCategory } from '@/lib/categoryNames'
import { collectionsFor, type ClosetTree } from '@/lib/standardTree'

/**
 * The <option>s of a category dropdown: "Her categories" first, then "More categories"
 * (lib/categoryChoices.ts). For a client with no categories yet: the fixed list, then Custom.
 * `omit` drops slugs that should not be offered here (the current primary, ones already added).
 * `names` is her own names for her categories (lib/categoryNames.ts), so a renamed one reads her way.
 *
 * `tree` (Maegan's standard categories, every new client): her Collections first, then each of the
 * 19 categories with its sub-categories, so a piece is filed where her Wardrobe shows it and tagged
 * into Eveningwear or Resort & Beach. Null for every existing client, whose list is unchanged.
 */
export function CategoryOptions({ custom, used, omit, names, tree }: {
  custom: CategoryChoice[]
  used: Set<string> | null | undefined
  omit?: (slug: string) => boolean
  names?: Record<string, string>
  tree?: ClosetTree | null
}) {
  const { grouped, mine, more } = splitCategoryChoices(custom, used)
  // A slug the tree already offers is not offered twice.
  const offered = new Set(tree ? [...collectionsFor(tree.kind), ...tree.categories, ...tree.subs].map((c) => c.slug) : [])
  const keep = (c: CategoryChoice) => !omit?.(c.slug) && !offered.has(c.slug)
  const opts = (list: CategoryChoice[]) => list.filter(keep)
    .map((c) => <option key={c.slug} value={c.slug}>{names ? nameForCategory(c.slug, names, c.label) : c.label}</option>)
  const stdOpts = (list: CategoryChoice[]) => list.filter((c) => !omit?.(c.slug))
    .map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)
  const standard = tree ? (
    <>
      <optgroup label="Collections">{stdOpts(collectionsFor(tree.kind))}</optgroup>
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
