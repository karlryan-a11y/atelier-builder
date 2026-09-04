/**
 * What a stylist has ALREADY paired, read back off her own pieces. (ADR-0113)
 *
 * Builder-only. The lookbook never shows this, so unlike `categoryNesting.ts` there is
 * no twin in atelier-looks to keep in step.
 *
 * Karl: "she already did the outerwear and then jackets so it should just show up here."
 * He is right, and it is not a guess. 44 of Danielle York's pieces carry BOTH Jackets and
 * Outerwear, because a stylist put both there. Reporting that is reporting her own data.
 * The screen still asks her to decide — nothing is pre-selected, which is the rule — but
 * it stops making her recall from memory what the closet can simply tell her.
 *
 * The distinction that matters, and the reason this is not the suggestion engine that was
 * turned down: this counts, it does not conclude. "44 of 44 pieces also say Outerwear" is
 * a fact. "Therefore Jackets belongs under Outerwear" is a judgement, and it stays hers.
 */

export interface Pairing {
  /** The other category found on the same pieces. */
  slug: string
  /** How many of this category's pieces also carry it. */
  count: number
}

export interface CategoryPairings {
  /** Total pieces in this category. */
  of: number
  /** Other categories on those same pieces, most frequent first. */
  with: Pairing[]
}

/**
 * For every category, which other categories appear on the same pieces.
 *
 * @param itemCategorySets one entry per piece: the categories that piece carries, as the
 *   stylist tagged them. Pass the RAW sets (no nesting applied) — the point is to show what
 *   was tagged, and rolled-up ancestors would make every child look paired with its parent
 *   whether a stylist ever wrote that or not.
 */
export function pairingsFrom(itemCategorySets: string[][]): Map<string, CategoryPairings> {
  const totals = new Map<string, number>()
  const pairs = new Map<string, Map<string, number>>()

  for (const raw of itemCategorySets) {
    // A piece tagged the same category twice must not count as a pair with itself.
    const cats = [...new Set(raw.map((c) => c.trim().toLowerCase()).filter(Boolean))]
    for (const a of cats) {
      totals.set(a, (totals.get(a) ?? 0) + 1)
      const row = pairs.get(a) ?? new Map<string, number>()
      for (const b of cats) {
        if (b === a) continue
        row.set(b, (row.get(b) ?? 0) + 1)
      }
      pairs.set(a, row)
    }
  }

  const out = new Map<string, CategoryPairings>()
  for (const [slug, of] of totals) {
    const withList = [...(pairs.get(slug) ?? new Map<string, number>()).entries()]
      .map(([s, count]) => ({ slug: s, count }))
      .sort((x, y) => y.count - x.count || x.slug.localeCompare(y.slug))
    out.set(slug, { of, with: withList })
  }
  return out
}

/**
 * How to describe a pairing to a stylist, in her words rather than a percentage.
 *
 * "all 44" when every piece agrees, "31 of 93" when they do not. The difference is the
 * whole signal: Jackets is 44 of 44 Outerwear and is an easy yes; Earrings is 31 of 93
 * Jewelry only because most of them were never tagged Jewelry at all, and 49ers is spread
 * across everything and should probably stay where it is.
 */
export function describePairing(p: Pairing, of: number): string {
  return p.count === of ? `all ${of}` : `${p.count} of ${of}`
}
