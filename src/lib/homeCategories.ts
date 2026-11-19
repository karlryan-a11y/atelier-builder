/**
 * THE CATEGORIES A HOME'S PIECES USE. (Cynthia Dada for Keil Cadieux, 2026-11-19)
 *
 * "When adding new items to a specific residence under a client's site, I should only be able to
 * see the categories under that residence." Keil's homes share one set of categories, so a home
 * has no list of its own: its list is what its pieces are filed under. Pick Carlton Landing in
 * Add Item and the dropdowns offer only those; nothing has to be set up per home.
 *
 * Built from the per-piece categories the Collection rail counts (CollectionTab categoriesByItem,
 * homes added by useItemHomes), so a piece is "at Carlton Landing" here exactly when the rail's
 * Carlton Landing row counts it. Her homes themselves always stay offered so she can switch, and a
 * home with no pieces yet offers everything, so she is never left with an empty list.
 */

/** Home slug -> every category (not a home) at least one of that home's pieces is filed under. */
export function categoriesByHome(
  categoriesByItem: Map<string, string[]>,
  homes: Map<string, string>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  if (homes.size === 0) return out
  for (const cats of categoriesByItem.values()) {
    const at = cats.filter((c) => homes.has(c))
    if (at.length === 0) continue
    const garment = cats.filter((c) => !homes.has(c) && !c.startsWith('__'))
    for (const h of at) {
      const s = out.get(h) ?? new Set<string>()
      for (const c of garment) s.add(c)
      out.set(h, s)
    }
  }
  return out
}

/** The homes picked in the dialog, under Category (moved to Also in on save) or under Also in. */
export function homesPickedIn(category: string, alsoIn: string[], homes: Map<string, string> | undefined): string[] {
  if (!homes || homes.size === 0) return []
  return [...new Set([category, ...alsoIn].filter((s) => s && homes.has(s)))]
}

/**
 * Which slugs a dropdown may offer for the picked homes, or null for "everything, as before":
 * no home picked, or the picked homes have no pieces yet.
 */
export function categoriesForHomes(
  picked: string[],
  byHome: Map<string, Set<string>> | undefined,
  homes: Map<string, string> | undefined,
): ((slug: string) => boolean) | null {
  if (!picked.length || !byHome || !homes) return null
  const used = new Set<string>()
  for (const h of picked) for (const c of byHome.get(h) ?? []) used.add(c)
  if (used.size === 0) return null
  return (slug) => used.has(slug) || homes.has(slug)
}
