/**
 * The category pills the Save Look box on the Canvas offers.
 *
 * Cynthia Dada, 2026-10-01, on Janet Foutty: "On Canvas, these FW categories shouldn't be available
 * to choose from because I got rid of those. They aren't visible on Janet's site." The box listed
 * every one of the client's look categories. Categorize hides a category (is_hidden) to take it off
 * her site, and the box never looked: 8 of Janet's 21 were hidden and all 8 were offered.
 *
 * So a hidden category is left out, unless this look already carries it (or she ticks or types it
 * here): then it stays, so she can see it and take it off. Seasons have their own row (ADR-0154).
 * Kept pure so scripts/check-save-look-hidden.mjs runs the code that ships.
 */
export interface PillCategory {
  label: string
  is_hidden?: boolean | null
  season?: string | null
}

/** `keep`: labels already on this look, ticked now, or made in this box. Always shown. */
export function saveLookPills(categories: PillCategory[], keep: string[]): string[] {
  const key = (s: string) => s.trim().toLowerCase()
  const seasons = new Set(categories.filter((c) => c.season).map((c) => key(c.label)))
  const kept = new Set(keep.map(key))
  const offered = categories.filter((c) => !c.is_hidden || kept.has(key(c.label))).map((c) => c.label)
  const seen = new Set<string>()
  return [...offered, ...keep].filter((l) => {
    const k = key(l)
    if (seasons.has(k) || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** The category's own spelling of a typed name, so "fw office denim" ticks "FW Office Denim". */
export function categoryLabelFor(categories: PillCategory[], typed: string): string {
  const k = typed.trim().toLowerCase()
  return categories.find((c) => c.label.trim().toLowerCase() === k)?.label ?? typed.trim()
}
