/**
 * ONE SEARCH, ONE RULE, EVERY SURFACE. ADR-0151.
 *
 * Maegan Watson, 2026-09-24, working through Peyton Wheeler's closet: "There's a major issue with
 * search in the closet. I'm searching for items and then not finding them ... everything that
 * should be populating with search criteria is not."
 *
 * Reproduced on the live site, on the exact dress she and Cynthia could not find:
 *
 *     "margaret satin sheath"        -> 1   Floral Margaret Satin Sheath Belted Shirt Dress
 *     "margaret satin sheath midi"   -> 0
 *
 * The stored name has no "midi" in it. EVERY typed word had to match, so a three-of-four query
 * returned an empty page with no hint that the dress was sitting right there. Cynthia concluded
 * it was not in the closet and added it again: `9a5230f2-…` "Margaret Satin Sheath Midi Shirt
 * Dress", created 2026-09-24, a duplicate of a row from November 2024.
 *
 * TWO RULES, AND BOTH ARE THE POINT:
 *
 * 1. EVERY FIELD, NOT THREE. Before this there were five different piece searches across the
 *    three apps, with five different field lists and two different matching rules — the canvas
 *    rail read name/brand/colour, the Collection tab read name/brand/colour, her Collection page
 *    read name/brand/colour/category/tags, the closet API read name/rename/brand, and the Looks
 *    page read tags/name/rename/brand. That is why search "works here and not there". One list
 *    now: name, rename, brand, colour, category, tags, description — plus the internal note for
 *    the team.
 *
 * 2. NEVER ANSWER "NOTHING" WHEN SOMETHING IS ONE WORD AWAY. A query that misses by a single
 *    word comes back as a NEAR match rather than an empty page. That is the whole Margaret
 *    incident, and an empty page is what makes someone create a duplicate.
 *
 * WHO MAY SEE WHAT. `audience` is load-bearing, not a nicety. A stylist writes things in the
 * internal note that are true and unkind — "she hates the neckline, keep it for resale". If that
 * text fed the client's search, typing "hates" would surface the piece. A client can only search
 * text a client can see. The team searches both.
 *
 * MIRRORED IN atelier-looks/src/lib/pieceSearch.ts, byte for byte. The builder and the lookbook
 * are separate deployments and this rule has to be the same in both, or "search" means two
 * different things depending which screen she is standing on — which is the bug. Each repo's
 * check-piece-search guard runs the same cases AND compares the two files when both checkouts
 * are on the machine.
 */

export type SearchAudience = 'client' | 'team'

export interface PieceSearchFields {
  name?: string | null
  /** The stylist's rename. This is what the client SEES, so it is searched first-class. */
  nameOverride?: string | null
  brand?: string | null
  color?: string | null
  /** Client-visible description (gp_closet_items.description, migration 028). */
  description?: string | null
  /** Category slugs AND their human labels: "high-top-sneakers" and "High Top Sneakers". */
  categories?: (string | null | undefined)[]
  /** Content-tag names, resolved. */
  tags?: (string | null | undefined)[]
  /** gp_closet_items.style_note. TEAM ONLY — never in the client's token set. */
  internalNote?: string | null
}

/** Words, lowercased, split on anything that is not a letter or a digit. */
export function tokenize(text: string | null | undefined): string[] {
  return (text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

/**
 * The words a search may match against, for this audience.
 *
 * The client's set and the team's set are the SAME apart from the internal note, so a stylist
 * searching her own collection finds what the client would find, plus her own notes.
 */
export function pieceTokens(f: PieceSearchFields, audience: SearchAudience): string[] {
  const parts = [
    f.name, f.nameOverride, f.brand, f.color, f.description,
    ...(f.categories ?? []), ...(f.tags ?? []),
  ]
  if (audience === 'team') parts.push(f.internalNote)
  const out: string[] = []
  for (const p of parts) for (const t of tokenize(p)) out.push(t)
  return out
}

/**
 * Does one typed word match one stored word?
 *
 * Forwards is the behaviour that already shipped: a typed word PREFIXES a stored one, so "red"
 * finds "red" and never "embroideRED", and the list narrows as she types.
 *
 * Backwards is new, and it is ONLY a plural. "boots" typed against a piece stored as "boot",
 * "dresses" against "dress". It was first written as a general prefix in the other direction and
 * that was too loose by a mile: "france" found "Fran Skirt", because "fran" prefixes it. A plural
 * is the entire reason this direction exists, so it is the entire rule.
 */
export function wordHitsToken(word: string, token: string): boolean {
  if (token.startsWith(word)) return true
  if (token.length < 3) return false
  return word === `${token}s` || word === `${token}es`
}

export interface PieceMatch {
  /** How many of the typed words were found. */
  matched: number
  /** How many words were typed. */
  total: number
  /** Every word found. */
  full: boolean
  /** All but one word found, and at least two found. Shown below the full matches. */
  near: boolean
}

export const NO_QUERY: PieceMatch = { matched: 0, total: 0, full: true, near: false }

/**
 * Grade one piece against one query.
 *
 * An empty query matches everything (`full`), because a search box nobody has typed in is not a
 * filter. A near match needs at least two words found AND at most one missed: on a two-word
 * query, one word out of two is not "nearly" — "lena houndstooth" would answer with all 184
 * Lena Hoschek pieces, which is noise wearing the costume of helpfulness.
 */
export function matchPiece(f: PieceSearchFields, query: string, audience: SearchAudience): PieceMatch {
  const words = tokenize(query)
  if (words.length === 0) return NO_QUERY
  const tokens = pieceTokens(f, audience)
  let matched = 0
  for (const w of words) if (tokens.some((t) => wordHitsToken(w, t))) matched++
  return {
    matched,
    total: words.length,
    full: matched === words.length,
    near: matched >= 2 && matched === words.length - 1,
  }
}

/**
 * A list, searched: the full matches in their original order, then the near ones.
 *
 * ORDER IS PRESERVED WITHIN EACH GROUP. On the client's Collection that order is her wardrobe's
 * own recency order; re-ranking inside a group would make "the third one along" mean something
 * different every time she searched.
 */
export function searchPieces<T>(
  items: T[],
  query: string,
  fieldsOf: (item: T) => PieceSearchFields,
  audience: SearchAudience,
): { full: T[]; near: T[] } {
  const words = tokenize(query)
  if (words.length === 0) return { full: items, near: [] }
  const full: T[] = []
  const near: T[] = []
  for (const item of items) {
    const m = matchPiece(fieldsOf(item), query, audience)
    if (m.full) full.push(item)
    else if (m.near) near.push(item)
  }
  return { full, near }
}
