/**
 * ONE HOME'S COLLECTION, for the Residences tab (Paige Berndt, 2026-11-13): "view each client's
 * collections within their respective residences, along with the looks created from those
 * collections".
 *
 * The pieces are exactly the ones her Collection already puts at this home (homesByItem in
 * lib/residences.ts, the same answer her lookbook gives), so the two screens can never disagree.
 *
 * The looks are every look she still has (not archived) that is filed under this home OR uses
 * one of its pieces. Filed ones come first, because those are the ones her lookbook shows inside
 * the home; the rest are the other looks made with pieces from it. Danielle York's San Francisco
 * has 880 pieces and no look filed there yet, so "filed" alone would show an empty list.
 */
export interface HomeLook {
  id: string
  closetItemIds: string[]
  categoryIds: string[]
  archived: boolean
}

export interface HomeCollection<P, L> {
  pieces: P[]
  /** Looks filed under this home. */
  filed: L[]
  /** Looks not filed here that use at least one of this home's pieces. */
  madeWith: L[]
}

export function homeCollection<P extends { id: string }, L extends HomeLook>(
  home: { id: string; slug: string },
  pieces: P[],
  looks: L[],
  homesByItem: Map<string, Set<string>>,
): HomeCollection<P, L> {
  const here = pieces.filter((p) => homesByItem.get(p.id)?.has(home.slug))
  const ids = new Set(here.map((p) => p.id))
  const filed: L[] = []
  const madeWith: L[] = []
  for (const look of looks) {
    if (look.archived) continue
    if (look.categoryIds.includes(home.id)) filed.push(look)
    else if (look.closetItemIds.some((id) => ids.has(id))) madeWith.push(look)
  }
  return { pieces: here, filed, madeWith }
}
