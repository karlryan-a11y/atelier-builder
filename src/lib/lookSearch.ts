/**
 * FINDING ONE LOOK BY NAME. ADR-0150.
 *
 * Cynthia Dada, 2026-09-24: "Can we please add the ability to search for look names? I need to
 * search for 182 and 175 to change the pants out because they were the wrong color."
 *
 * There was no search in Categorize at all. Her screenshot shows the workaround: Chrome's own
 * Find bar, reading "182 · 3/3" over the page. That only ever finds what is already rendered,
 * and it cannot tell a look name from a brand label inside a tile.
 *
 * WHY THE NAME IS THE RIGHT THING TO SEARCH: 12,770 of the 15,779 live looks carry a number in
 * their name (measured 2026-09-24). The number IS how the team refers to a look. Peyton Wheeler
 * has 373 live looks, Keil Cadieux Creekside 472, and 16 clients are over 200 — well past what
 * anyone scrolls.
 *
 * PLAIN SUBSTRING, AND THAT IS A DECISION. The obvious worry with a bare number is that "18"
 * drags in 182 and 189. Measured on Peyton: "1" -> 134 looks, "18" -> 13, "182" -> exactly 1.
 * The list converges as she types, which is what a live filter is for. Matching a number as a
 * WHOLE token instead would answer "1" with a single look (Look 1) and show her nothing useful
 * until the final keystroke, so it is worse at the only job this has.
 *
 * Every term must match, in any order, so "182 peyton" and "peyton 182" find the same look.
 */

/** Terms, lowercased, with runs of whitespace collapsed. Empty query = no terms = no filtering. */
export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean)
}

/** Does this name satisfy every term? An unnamed look matches nothing but an empty query. */
export function matchesSearch(name: string | null | undefined, terms: string[]): boolean {
  if (terms.length === 0) return true
  const n = (name ?? '').toLowerCase()
  return terms.every((t) => n.includes(t))
}

/**
 * The list, filtered by name. Order is preserved: the grid's order is the client's own gallery
 * order (ADR-0121), and a search must not quietly re-rank it into something she cannot act on
 * with the drag handles.
 */
export function searchByName<T extends { name: string | null }>(items: T[], query: string): T[] {
  const terms = searchTerms(query)
  if (terms.length === 0) return items
  return items.filter((i) => matchesSearch(i.name, terms))
}
