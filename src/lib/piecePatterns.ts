// Patterns & Textures on a client's Collection (Cynthia for Peyton Wheeler, 11/05). A piece can be
// Floral, Plaid, Stripes and so on, and the client filters by it the way she filters by colour.
//
// ONLY FOR A CLIENT WHO HAS IT TURNED ON: gp_clients.raw.patterns_on = true. Every other client's
// Collection and builder are exactly as before.
//
// WHERE A PIECE'S PATTERNS LIVE: markers in gp_closet_items.client_edited_fields ('pattern-floral').
// GoodPix's sync replaces `raw` on every refresh, so a pattern kept there would vanish; nothing
// rewrites client_edited_fields but the two edit screens, and both keep markers they don't own
// (the same place the lookbook keeps the "she picked this home" marker, residences.ts HOME_PICKED).
//
// This file is the same in atelier-looks and atelier-builder (scripts/check-piece-patterns.mjs).

export const PATTERNS_HEADING = 'Patterns & Textures';

export const PATTERNS = [
  { slug: 'floral', label: 'Floral' },
  { slug: 'plaid', label: 'Plaid' },
  { slug: 'brocade', label: 'Brocade' },
  { slug: 'tweed', label: 'Tweed' },
  { slug: 'houndstooth', label: 'Houndstooth' },
  { slug: 'herringbone', label: 'Herringbone' },
  { slug: 'jacquard', label: 'Jacquard' },
  { slug: 'stripes', label: 'Stripes' },
  { slug: 'animal-print', label: 'Animal Print' },
  { slug: 'geometric', label: 'Geometric' },
] as const;

export type PatternSlug = (typeof PATTERNS)[number]['slug'];

export const PATTERN_MARKER = 'pattern-';

const SLUGS = new Set<string>(PATTERNS.map((p) => p.slug));

/** Is Patterns & Textures on for this client (her gp_clients.raw)? */
export function patternsOn(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as Record<string, unknown>).patterns_on === true;
}

/** A client_edited_fields entry that is a pattern, not a field she edited. */
export function isPatternMarker(field: string): boolean {
  return field.startsWith(PATTERN_MARKER) && SLUGS.has(field.slice(PATTERN_MARKER.length));
}

/** A piece's patterns, in the order of PATTERNS. */
export function patternsOf(item: { client_edited_fields?: string[] | null }): PatternSlug[] {
  const have = new Set((item.client_edited_fields ?? []).filter(isPatternMarker).map((f) => f.slice(PATTERN_MARKER.length)));
  return PATTERNS.filter((p) => have.has(p.slug)).map((p) => p.slug);
}

/** client_edited_fields with the patterns replaced by `slugs`; every other entry kept. Empty is null. */
export function withPatterns(fields: string[] | null | undefined, slugs: readonly string[]): string[] | null {
  const kept = (fields ?? []).filter((f) => !isPatternMarker(f));
  const picked = PATTERNS.filter((p) => slugs.includes(p.slug)).map((p) => PATTERN_MARKER + p.slug);
  const next = [...kept, ...picked];
  return next.length ? next : null;
}

export function patternLabel(slug: string): string {
  return PATTERNS.find((p) => p.slug === slug)?.label ?? slug;
}

/**
 * The words her search finds a pattern by: its name, and the way a piece's own name says it
 * ("striped", "leopard"), so "plaid" finds a piece sorted Plaid from its photo.
 */
export const PATTERN_SEARCH_WORDS: Record<PatternSlug, string> = {
  floral: 'Floral flowers',
  plaid: 'Plaid check checked',
  brocade: 'Brocade',
  tweed: 'Tweed boucle',
  houndstooth: 'Houndstooth',
  herringbone: 'Herringbone',
  jacquard: 'Jacquard',
  stripes: 'Stripes striped stripe',
  'animal-print': 'Animal print',
  geometric: 'Geometric',
};

/**
 * THE FIRST SORT: the patterns a piece's own words name (its name, its colour text, its
 * description). A word that only sounds like a pattern is not one: "Rose Vivier" is a shoe line,
 * "cowl neck" is not cowhide, a snake chain is jewelry. Jewelry is never sorted. A piece whose
 * words name no pattern gets none: the photo sort and the stylist's check do the rest.
 */
export function patternsFromWords(text: string, isJewelry = false): PatternSlug[] {
  if (isJewelry) return [];
  const t = ` ${text.toLowerCase().replace(/[_/]+/g, ' ')} `;
  const out = new Set<PatternSlug>();
  const has = (re: RegExp) => re.test(t);
  // Floral: a print of flowers, not a single flower sewn on.
  const flowerDetail = /\b(floral|flowers?)\s+(detail|applique|appliqué|clip|pin|brooch|embellish\w*|trim)\b/;
  if ((has(/\bflorals?\b/) || has(/\bflowers?\b/) || has(/\bwildflowers?\b/) || has(/\brose (garden|print)\b/) || has(/\benglish rose\b/) || has(/\broses\b/) || has(/\bpeon(y|ies)\b/) || has(/\bbotanical\b/) || has(/\bfiorellino\b/) || has(/\bblossoms?\b/) || has(/\bdais(y|ies)\b/) || has(/\bhibiscus\b/)) && !flowerDetail.test(t)) out.add('floral');
  if (has(/\bhounds-?\s?tooth\b/) || has(/\bdogtooth\b/) || has(/\bpied[- ]de[- ]poule\b/)) out.add('houndstooth');
  // Plaid takes every kind of check, except houndstooth's own "check" and a checkerboard.
  const checkWord = /\b(checks?|checked|checkered|chequered)\b/;
  if (has(/\bplaids?\b/) || has(/\btartan\b/) || has(/\bgingham\b/) || has(/\bwindowpane\b/) || has(/\bmadras\b/) || (checkWord.test(t.replace(/hounds-?\s?tooth\s+check\w*/g, ' ')) && !has(/\bcheckerboard\b/))) out.add('plaid');
  if (has(/\bbrocades?\b/)) out.add('brocade');
  if (has(/\btweeds?\b/) || has(/\bboucl[eé](?![a-z])/)) out.add('tweed');
  if (has(/\bherringbone\b/)) out.add('herringbone');
  if (has(/\bjacquard\b/) || has(/\bdamask\b/) || has(/\bmatelass[eé](?![a-z])/)) out.add('jacquard');
  // Stripes, but a tiger's stripes are an animal print.
  if (/\b(pin)?strip(e|es|ed)\b|\bbreton\b/.test(t.replace(/\btiger[- ]stripes?\b/g, ' '))) out.add('stripes');
  if (has(/\banimal[- ]print\b/) || has(/\bleopard\b/) || has(/\bcheetah\b/) || has(/\bzebra\b/) || has(/\btiger\b/) || has(/\bgiraffe\b/) || has(/\bocelot\b/) || has(/\bjaguar\b/)
    || has(/\bsnake(skin)?\b/) || has(/\bpython\b/) || has(/\bcroc(odile)?\b/) || has(/\balligator\b/) || has(/\bostrich\b/) || has(/\bcow ?hide\b/) || has(/\bcow[- ]print\b/)) out.add('animal-print');
  if (has(/\bgeometric\b/) || has(/\bgeo\b/) || has(/\bchevron\b/) || has(/\bargyle\b/) || has(/\bzig-?\s?zag\b/) || has(/\bcheckerboard\b/) || has(/\bfair ?isle\b/) || has(/\bdiamond[- ]print\b/)) out.add('geometric');
  return PATTERNS.filter((p) => out.has(p.slug)).map((p) => p.slug);
}
