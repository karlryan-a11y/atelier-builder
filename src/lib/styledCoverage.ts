// "What percentage of collection items are styled?" — Maegan, 2026-09-04.
//
// STYLED MEANS PUBLISHED. Karl's call, and it is the only measure that means anything to a
// client: a look sitting in draft has not been delivered, so a piece in one has not been styled
// as far as she is concerned. Measured against live data on 2026-09-04, five active clients hold
// 88 looks between them that were never published — Shanna Preve 42, Jennifer Alleva 22,
// Lina Galvao 14, Laura Correnti 8, Jen Laurence 2. On the "any look" measure they read 75%, 40%,
// 59%, 24% and 10%. On this one they read 0%, which is what their clients actually see. That gap
// is the reason `draftOnly` is reported beside the headline rather than folded into it.
//
// Capsules are NOT counted. 7,258 of 7,863 gp_boards rows carry a null closet_item_ids, so
// counting capsule membership would add 3.7 points of coverage while silently missing 92% of
// capsules. Measuring badly is worse than not measuring; revisit if boards ever populate the column.
//
// Pure and synchronous by design. The Collection tab already holds every piece and every look on
// screen, so the number costs no read at all — ADR-0105 (a surface renders what it has, never the
// library).

/** The only thing this needs to know about a look. Matches LookLite from useItemLookUsage. */
export interface LookPublishState {
  published: boolean
}

export interface StyledCoverage {
  /** Pieces in the denominator (live, not deleted, not transitioned out). */
  total: number
  /** Pieces appearing in at least one PUBLISHED look. */
  styled: number
  /** Pieces appearing only in looks that were never published. Invisible to the client. */
  draftOnly: number
  /** Pieces in no look at all. */
  unstyled: number
  /** styled / total, rounded, 0 when there is nothing to divide. */
  percent: number
  /**
   * The line the stylist reads. Kept SHORT on purpose: it sits in a single-row flex header
   * beside "936 items" and "0/936 confirmed on Drive", and at 1024px — the iPad the stylists
   * actually work on — a 47-character label wrapped that row onto two lines. Measured in
   * WebKit, 2026-09-04. LABEL_MAX_CHARS is the budget that fits; the guard enforces it.
   */
  label: string
}

/**
 * @param itemIds  the pieces on screen, in whatever scope the stylist has filtered to
 * @param usage    piece id to the looks it appears in (published and draft alike)
 */
/**
 * What fits on one line at 1024px next to the counts already in that header. Verified in
 * WebKit at 1024x1366 and 1440x900. Raising this without re-measuring will wrap the header.
 */
export const LABEL_MAX_CHARS = 40

export function styledCoverage(
  itemIds: Iterable<string>,
  usage: Map<string, LookPublishState[]>,
): StyledCoverage {
  let total = 0
  let styled = 0
  let draftOnly = 0
  let unstyled = 0

  for (const id of itemIds) {
    total++
    const looks = usage.get(id) ?? []
    if (looks.length === 0) { unstyled++; continue }
    if (looks.some((l) => l.published)) styled++
    else draftOnly++
  }

  const percent = total === 0 ? 0 : Math.round((styled / total) * 100)

  let label: string
  if (total === 0) {
    label = 'No collection yet'
  } else {
    label = `${styled}/${total} styled (${percent}%)`
    if (draftOnly > 0) {
      label += ` · ${draftOnly} in drafts`
    }
  }

  return { total, styled, draftOnly, unstyled, percent, label }
}

/** The slug "All items" is filed under in a coverage map. Matches the rail's count map. */
export const TOTAL_SLUG = '__total__'

/**
 * The same measure, broken down the way the Collection rail is: one entry per garment category
 * plus TOTAL_SLUG for "All items". Maegan asked for the number; Karl asked to see it per
 * category, because "94% styled" across a whole wardrobe hides the fact that every unstyled
 * piece is a shoe.
 *
 * A piece belongs to every category `categoriesOf` gives it (garment type plus each "Also in"),
 * so it is counted under each — exactly like the rail's own counts, which is why the two
 * denominators agree row for row. TOTAL_SLUG counts DISTINCT pieces, so it is not the sum of
 * the rows.
 *
 * Delegates to styledCoverage per bucket rather than restating what "styled" means. There is one
 * definition and this is not a second one.
 */
export function coverageByCategory(
  items: Iterable<{ id: string; categories: readonly string[] }>,
  usage: Map<string, LookPublishState[]>,
): Map<string, StyledCoverage> {
  const buckets = new Map<string, string[]>()
  const all: string[] = []

  for (const item of items) {
    all.push(item.id)
    for (const slug of item.categories) {
      if (!slug || slug === TOTAL_SLUG) continue
      const b = buckets.get(slug)
      if (b) b.push(item.id)
      else buckets.set(slug, [item.id])
    }
  }

  const out = new Map<string, StyledCoverage>()
  out.set(TOTAL_SLUG, styledCoverage(all, usage))
  for (const [slug, ids] of buckets) out.set(slug, styledCoverage(ids, usage))
  return out
}
