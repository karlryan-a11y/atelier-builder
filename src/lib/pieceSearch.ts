/**
 * ONE SEARCH, ONE RULE, EVERY SURFACE. ADR-0151, extended by ADR-0155.
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
 * ADR-0155. Maegan again, 2026-09-25, same closet: "I searched for plaid rosie dress which there
 * are way more plaid rosie dresses I'm trying to figure out why they're not showing up." The page
 * showed 2. Run over her 1,099 live pieces, the rule of the day found 2 exact matches and hid 13
 * more (every other plaid dress, every other Rosie Assoulin dress, including Rosie's "Sleeveless
 * Belted Checkered Cotton Dress") because near matches only appeared when nothing matched exactly.
 * Karl, 2026-09-28: "it should show all the possible options and be accurate", and the closest
 * match first, with no separate heading. The audit that followed, over all 88,742 live pieces:
 *
 *   - a colour word on her page searched the colour FAMILY only, and 64,513 pieces have none:
 *     13,831 of 20,018 black pieces never came up for "black" (Caroline Smith: 184 of 184);
 *   - accents split words: "Chloé" was stored as "chlo", so "chloe" found none of 537 pieces;
 *   - "with", "and", "in" counted as words a piece had to contain;
 *   - "plaid" never found "checkered", "tee" never found "t-shirt", "dress" never "shirtdress";
 *   - one typo found nothing;
 *   - retailer and material were on the piece and never searched.
 *
 * THE RULES
 *
 * 1. EVERY FIELD. Name, rename, brand, colour text, colour families, description, material,
 *    retailer, categories, tags. The team also searches the internal note, the size and the old
 *    GoodPix description (mostly retailer sales copy, so it ranks last and a client never sees it).
 *
 * 2. EVERY POSSIBLE MATCH, CLOSEST FIRST. A piece is IN the results when it matches every word but
 *    one (or, on a one- or two-word search, any word). One list, ranked: all the words before
 *    fewer words, an exact word before a synonym before a typo, the name and designer before a tag.
 *    Ties keep the list's own order (her wardrobe's recency), so the ranking never shuffles things
 *    that are equally good.
 *
 * 3. WORDS, NOT CHARACTERS. Accents fold ("chloe" = "Chloé"), filler words drop, a typed word
 *    prefixes a stored one ("red" finds "red" and never "embroideRED"), a plural or a past tense
 *    finds its stem ("boots"/"boot", "striped"/"stripe"), a garment word finds the compound it ends
 *    ("dress" finds "shirtdress", "bag" finds "handbag"), a small set of synonyms find each other,
 *    and a word of five letters or more tolerates one typo, ranked below every real match.
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
  /** The free-text colour ("Blue, Red, Plaid", "Multi-color tartan ..."). */
  color?: string | null
  /** The colour set: color_family + color_families. 64,513 pieces have none, so never alone. */
  colorFamilies?: (string | null | undefined)[]
  /** Client-visible description (gp_closet_items.description, migration 028). */
  description?: string | null
  /** raw.material, where GoodPix had it. */
  material?: string | null
  retailer?: string | null
  /** Category slugs AND their human labels: "high-top-sneakers" and "High Top Sneakers". */
  categories?: (string | null | undefined)[]
  /** Content-tag names, resolved. */
  tags?: (string | null | undefined)[]
  /** gp_closet_items.style_note. TEAM ONLY — never in the client's token set. */
  internalNote?: string | null
  /** TEAM ONLY. A client does not need "m" to match every medium. */
  size?: string | null
  /** raw.description from GoodPix. TEAM ONLY: mostly retailer sales copy ("free shipping"). */
  legacyDescription?: string | null
}

/** How much a hit in each field is worth. The name and designer are what she means. */
const WEIGHT = {
  name: 3, brand: 3,
  colorChip: 2.5, color: 2, colorLong: 1, description: 2, material: 2, retailer: 2,
  category: 1.5, tag: 1.5,
  note: 1, size: 1, legacy: 0.5,
} as const
type FieldKind = keyof typeof WEIGHT
/** Past this, a colour field is a description of the colours rather than a colour name. */
const LONG_COLOR_TEXT = 60

/** Words nobody means as a filter. Dropped from the query, unless they are all she typed. */
const STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'with', 'w', 'in', 'of', 'for', 'on', 'by', 'to', 'at', 'from'])

/** Palette words. On a brand ("Skarlett Blue") they count for little, so a blue piece ranks first. */
const COLOR_WORDS = new Set(['black', 'white', 'ivory', 'cream', 'grey', 'gray', 'beige', 'brown', 'navy',
  'blue', 'green', 'olive', 'teal', 'purple', 'lavender', 'pink', 'blush', 'red', 'burgundy', 'orange',
  'yellow', 'gold', 'silver', 'tan', 'camel', 'multicolor'])

/**
 * Words that mean the same thing to her. Each group finds every other member. Kept short on
 * purpose: a synonym that is only sometimes true ("navy" for "blue") makes results she cannot
 * trust. Multi-word spellings ("t-shirt", "v neck") are joined before this (see PHRASES).
 */
const SYNONYM_GROUPS: string[][] = [
  ['plaid', 'check', 'checked', 'checkered', 'checks', 'gingham', 'tartan', 'windowpane'],
  ['tshirt', 'tee'],
  ['pants', 'trousers', 'slacks'],
  ['sneaker', 'trainer'],
  ['handbag', 'purse'],
  ['sweater', 'jumper', 'pullover'],
  ['grey', 'gray'],
  ['ivory', 'cream', 'ecru', 'offwhite'],
  ['tan', 'camel'],
  ['leopard', 'cheetah'],
  ['polka', 'polkadot'],
]
const SYNONYMS = new Map<string, string[]>()
for (const g of SYNONYM_GROUPS) for (const w of g) SYNONYMS.set(w, g.filter((x) => x !== w))

/**
 * SHOPPING WORDS: the broad word she types finds the specific pieces it covers (ADR-0163).
 *
 * ONE WAY ONLY. "heels" finds a pump; "pump" does not find every heel. Measured over all 88,819
 * live pieces on 2026-10-02, typing the broad word missed these because the piece is named only
 * by the specific one: sweater 1,684 (cardigan, pullover, turtleneck), heels 1,484 (pump,
 * stiletto, slingback), jacket 620 (blazer, bomber), swimsuit 222 (bikini), coat 164 (trench,
 * puffer, parka), flats 124 (ballerina), necklace 119 (pendant, choker), sneakers 79 (trainer),
 * bag 44 (clutch, pouch). Words that are only sometimes the broad thing are left out on purpose:
 * "stud" is also a studded shoe, "ankle" is also an ankle jean, "denim" is also a jacket.
 * Keys are matched on the typed word or its stem, so "heel" and "heels" both work.
 */
const BROADER: Record<string, string[]> = {
  heel: ['pump', 'stiletto', 'slingback'],
  sweater: ['cardigan', 'pullover', 'turtleneck', 'jumper'],
  jacket: ['blazer', 'bomber', 'shacket'],
  coat: ['trench', 'parka', 'puffer', 'overcoat', 'peacoat'],
  swimsuit: ['bikini', 'tankini', 'swimwear', 'bathingsuit'],
  swim: ['bikini', 'tankini', 'swimsuit', 'swimwear', 'bathingsuit'],
  flat: ['ballerina', 'ballet'],
  necklace: ['pendant', 'choker', 'lariat'],
  sneaker: ['trainer'],
  bag: ['clutch', 'tote', 'crossbody', 'satchel', 'pouch', 'purse', 'handbag', 'backpack'],
  dress: ['gown', 'kaftan', 'caftan'],
  top: ['blouse', 'tank', 'cami', 'camisole', 'tee', 'tshirt', 'bodysuit'],
  earring: ['hoop', 'huggie'],
}
function narrowerOf(word: string): string[] {
  for (const w of [word, ...stems(word)]) if (BROADER[w]) return BROADER[w]
  return []
}

/** Spellings that are one word to her and two to a tokenizer. Joined on both sides. */
const PHRASES: [RegExp, string][] = [
  [/\bt[\s-]?shirts?\b/g, 'tshirt'],
  [/\bv[\s-]neck/g, 'vneck'],
  [/\boff[\s-]white\b/g, 'offwhite'],
  [/\bpolka[\s-]dots?\b/g, 'polkadot polka'],
]

/**
 * Garment words that end compounds. "dress" finds "shirtdress", "bag" finds "handbag", "neck"
 * finds "turtleneck". A closed list, because an open suffix rule would make "ring" find every
 * "earring".
 */
const COMPOUND_HEADS = new Set(['dress', 'shirt', 'coat', 'boot', 'neck', 'jacket', 'skirt', 'bag', 'suit', 'wear', 'top'])

/** Lowercase, accents folded, multi-word spellings joined. */
function normalize(text: string | null | undefined): string {
  let s = (text ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  for (const [re, to] of PHRASES) s = s.replace(re, to)
  return s
}

/** Words, lowercased and accent-folded, split on anything that is not a letter or a digit. */
export function tokenize(text: string | null | undefined): string[] {
  return normalize(text).split(/[^a-z0-9]+/).filter(Boolean)
}

/** The typed words that count: filler dropped, unless filler is all there is. */
export function queryWords(query: string): string[] {
  const words = tokenize(query)
  const kept = words.filter((w) => !STOP_WORDS.has(w))
  return kept.length ? kept : words
}

interface Token { t: string; w: number; kind: FieldKind }

/** The words a search may match against, for this audience, each with the field it came from. */
function weightedTokens(f: PieceSearchFields, audience: SearchAudience): Token[] {
  const out: Token[] = []
  const add = (text: string | null | undefined, kind: FieldKind) => {
    for (const t of tokenize(text)) out.push({ t, w: WEIGHT[kind], kind })
  }
  add(f.name, 'name'); add(f.nameOverride, 'name'); add(f.brand, 'brand')
  // The colour CHIPS are what the piece is. The free text can be a 200-character AI description
  // ("... overlaid with crimson red stripes, deep forest green, and black crossing lines") on half
  // of some closets (Danielle York: 465 of 936), so a colour named in passing ranks below a
  // colour the piece is (ADR-0155, measured 2026-10-02).
  for (const c of f.colorFamilies ?? []) add(c, 'colorChip')
  add(f.color, (f.color ?? '').length > LONG_COLOR_TEXT ? 'colorLong' : 'color')
  add(f.description, 'description'); add(f.material, 'material'); add(f.retailer, 'retailer')
  for (const c of f.categories ?? []) add(c, 'category')
  for (const t of f.tags ?? []) add(t, 'tag')
  if (audience === 'team') {
    add(f.internalNote, 'note'); add(f.size, 'size'); add(f.legacyDescription, 'legacy')
  }
  return out
}

/** The words a search may match against, for this audience. */
export function pieceTokens(f: PieceSearchFields, audience: SearchAudience): string[] {
  return weightedTokens(f, audience).map((x) => x.t)
}

/** The stems of a typed word: "boots" -> "boot", "dresses" -> "dress", "striped" -> "stripe". */
function stems(word: string): string[] {
  const out: string[] = []
  if (word.endsWith('es') && word.length >= 5) out.push(word.slice(0, -2))
  if (word.endsWith('s') && word.length >= 4) out.push(word.slice(0, -1))
  if (word.endsWith('ed') && word.length >= 6) out.push(word.slice(0, -2), word.slice(0, -1))
  return out.filter((s) => s.length >= 3)
}

/**
 * Does one typed word match one stored word, exactly (prefix, plural, tense)?
 *
 * Forwards: a typed word PREFIXES a stored one, so "red" finds "red" and never "embroideRED", and
 * the list narrows as she types. Backwards: only a stem. "france" does not find "Fran Skirt".
 */
export function wordHitsToken(word: string, token: string): boolean {
  if (token.startsWith(word)) return true
  if (token.length < 3) return false
  return stems(word).some((s) => token === s || (s.length >= 4 && token.startsWith(s)))
}

/** One edit apart (insert, delete, substitute, or swap two neighbours). */
function oneEditApart(a: string, b: string): boolean {
  if (a === b) return false
  const la = a.length, lb = b.length
  if (Math.abs(la - lb) > 1) return false
  let i = 0
  while (i < la && i < lb && a[i] === b[i]) i++
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true
    return i + 1 < la && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

/** How strongly one typed word matches one stored word. 0 is no match. */
function wordStrength(word: string, token: string, typos: boolean): number {
  if (wordHitsToken(word, token)) return 1
  for (const s of SYNONYMS.get(word) ?? []) if (wordHitsToken(s, token)) return 0.9
  for (const n of narrowerOf(word)) if (wordHitsToken(n, token)) return 0.85
  const base = stems(word)[0] ?? word
  for (const head of [word, base]) {
    if (COMPOUND_HEADS.has(head) && token.length > head.length && token.endsWith(head)) return 0.9
  }
  // Typos: long words only, the prefix she has typed so far or the whole word.
  if (typos && word.length >= 5 && token.length >= 5) {
    if (oneEditApart(word, token) || oneEditApart(word, token.slice(0, word.length))) return 0.5
  }
  return 0
}

export interface PieceMatch {
  /** How many of the typed words were found. */
  matched: number
  /** How many words were typed (filler dropped). */
  total: number
  /** Every word found. */
  full: boolean
  /** In the results but not a full match. */
  near: boolean
  /** In the results at all. */
  included: boolean
  /** Higher is closer. Only meaningful between pieces graded against the same query. */
  score: number
}

export const NO_QUERY: PieceMatch = { matched: 0, total: 0, full: true, near: false, included: true, score: 0 }

/** How many words a piece must match to be shown at all. */
function required(total: number): number {
  return total <= 2 ? 1 : total - 1
}

/**
 * Grade one piece against one query.
 *
 * An empty query matches everything (`full`), because a search box nobody has typed in is not a
 * filter.
 *
 * `typoWords` are the words allowed to match with one typo. searchPieces allows it only for a word
 * that finds NOTHING spelled as typed anywhere in the list: "plaid" is one letter from "plain",
 * and a closet full of plaid should not end in every plain tee. Graded alone, every word may.
 */
export function matchPiece(
  f: PieceSearchFields,
  query: string,
  audience: SearchAudience,
  typoWords?: Set<string>,
): PieceMatch {
  const words = queryWords(query)
  if (words.length === 0) return NO_QUERY
  const tokens = weightedTokens(f, audience)
  let matched = 0
  let score = 0
  for (const w of words) {
    let best = 0
    for (const { t, w: weight, kind } of tokens) {
      let s = wordStrength(w, t, typoWords ? typoWords.has(w) : true)
      if (!s) continue
      // "blue" on the brand "Skarlett Blue" is not what she meant.
      if (kind === 'brand' && COLOR_WORDS.has(w)) s *= 0.2
      if (s * weight > best) best = s * weight
    }
    if (best > 0) { matched++; score += best }
  }
  const full = matched === words.length
  const included = matched >= required(words.length)
  // Every word found always outranks fewer words found, whatever the fields.
  return { matched, total: words.length, full, near: included && !full, included, score: matched * 100 + score }
}

/**
 * A list, searched: every piece worth showing, closest first.
 *
 * `ranked` is what a surface shows. `full` and `near` are the same pieces split by whether every
 * word was found, for surfaces that need to say so. Ties keep the input order: on the client's
 * Collection that is her wardrobe's own recency.
 */
export function searchPieces<T>(
  items: T[],
  query: string,
  fieldsOf: (item: T) => PieceSearchFields,
  audience: SearchAudience,
): { ranked: T[]; full: T[]; near: T[] } {
  const words = queryWords(query)
  if (words.length === 0) return { ranked: items, full: items, near: [] }
  const fields = items.map(fieldsOf)
  // A word earns typo tolerance only if it matches nothing, spelled as typed, anywhere here.
  const typoWords = new Set(words.filter((w) => !fields.some((f) =>
    weightedTokens(f, audience).some(({ t }) => wordStrength(w, t, false) > 0))))
  const graded: { item: T; m: PieceMatch; i: number }[] = []
  items.forEach((item, i) => {
    const m = matchPiece(fields[i], query, audience, typoWords)
    if (m.included) graded.push({ item, m, i })
  })
  graded.sort((a, b) => b.m.score - a.m.score || a.i - b.i)
  const ranked = graded.map((g) => g.item)
  return {
    ranked,
    full: graded.filter((g) => g.m.full).map((g) => g.item),
    near: graded.filter((g) => !g.m.full).map((g) => g.item),
  }
}

/**
 * A CATEGORY IS A FILTER, AND A SEARCH INSIDE IT SEARCHES THAT CATEGORY (ADR-0163).
 *
 * Maegan Watson, 2026-10-02, Danielle York, her clip "Fashion Collection Search Function Issues":
 * in Rings, "chanel" "should only pull the Chanel in that category"; in Coats, "mcqueen": "even in
 * coats, it's not just searching coats, so that's the 1 issue". Earlier the same day a search inside
 * a category had been made to also show matches from every other category (so the Margaret dress,
 * filed under Summer Dresses, could be reached from Dresses). Live, Rings + "chanel" returned 65
 * pieces from everywhere and 0 rings. That was reverted here. A piece filed under a sibling
 * category is reached by the stylist's category map for that client (Summer Dresses inside
 * Dresses), not by search leaking across categories.
 *
 * `ranked` is the category's matches, closest first. `elsewhere` counts what matches outside the
 * category, so a surface whose category returns nothing can offer "See all N in All pieces" in one
 * tap rather than a dead end. It is never mixed into the results.
 */
export function searchInCategory<T>(
  items: T[],
  inScope: (item: T) => boolean,
  scoped: boolean,
  query: string,
  fieldsOf: (item: T) => PieceSearchFields,
  audience: SearchAudience,
): { ranked: T[]; elsewhere: number } {
  const ranked = searchPieces(scoped ? items.filter(inScope) : items, query, fieldsOf, audience).ranked
  if (!scoped || queryWords(query).length === 0) return { ranked, elsewhere: 0 }
  const elsewhere = searchPieces(items.filter((i) => !inScope(i)), query, fieldsOf, audience).ranked.length
  return { ranked, elsewhere }
}
