import { splitCategoryChoices, type CategoryChoice } from '@/lib/categoryChoices'

/**
 * The <option>s of a category dropdown: "Her categories" first, then "More categories"
 * (lib/categoryChoices.ts). For a client with no categories yet: the fixed list, then Custom.
 * `omit` drops slugs that should not be offered here (the current primary, ones already added).
 */
export function CategoryOptions({ custom, used, omit }: {
  custom: CategoryChoice[]
  used: Set<string> | null | undefined
  omit?: (slug: string) => boolean
}) {
  const { grouped, mine, more } = splitCategoryChoices(custom, used)
  const keep = (c: CategoryChoice) => !omit?.(c.slug)
  const opts = (list: CategoryChoice[]) => list.filter(keep).map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)
  if (!grouped) {
    return (
      <>
        {opts(more)}
        {mine.filter(keep).length > 0 && <optgroup label="Custom">{opts(mine)}</optgroup>}
      </>
    )
  }
  return (
    <>
      {mine.filter(keep).length > 0 && <optgroup label="Her categories">{opts(mine)}</optgroup>}
      {more.filter(keep).length > 0 && <optgroup label="More categories">{opts(more)}</optgroup>}
    </>
  )
}
