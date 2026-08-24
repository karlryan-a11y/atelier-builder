/**
 * Closet categorization for the client lookbook sidebar.
 *
 * Resolves every closet item to ONE garment category (Bergdorf-aligned
 * taxonomy). Resolution precedence:
 *   1. stylist override   — Phase B (gp_closet_items.category), not yet present
 *   2. GoodPix content_tag — the ~32% of items the stylist tagged in GoodPix
 *   3. name detection      — fills the ~68% GoodPix left untagged
 *   4. 'other'
 *
 * This deliberately keeps GoodPix's categories (normalized + deduped) and only
 * generates a category where GoodPix had none. NON-garment tags (occasion,
 * season, one-offs like "university of texas") are intentionally NOT categories
 * here — they stay searchable via the search index, never lost.
 */

export type Category =
  | 'dresses' | 'tops' | 'skirts' | 'pants' | 'jeans' | 'shorts' | 'outerwear' | 'swim' | 'activewear'
  | 'shoes' | 'bags' | 'jewelry'
  | 'belts' | 'scarves' | 'hats' | 'sunglasses'
  | 'other'

/** Display labels for each category slug. */
export const CATEGORY_LABELS: Record<Category, string> = {
  dresses: 'Dresses',
  tops: 'Tops',
  skirts: 'Skirts',
  pants: 'Pants',
  jeans: 'Denim', // slug stays `jeans` (internal); client-facing label is Denim. `denim`/`jean` both fold into this bucket.
  shorts: 'Shorts',
  outerwear: 'Outerwear',
  swim: 'Swim',
  activewear: 'Activewear',
  shoes: 'Shoes',
  bags: 'Handbags',
  jewelry: 'Jewelry',
  belts: 'Belts',
  scarves: 'Scarves',
  hats: 'Hats',
  sunglasses: 'Sunglasses',
  other: 'Other',
}

/**
 * Sidebar structure (Bergdorf Goodman / Neiman's pattern): grouped section
 * headers with the split-out categories nested under them. Standalone entries
 * (Shoes, Handbags, Jewelry) are their own top-level filter. Empty buckets are
 * hidden at render time.
 */
export type SidebarNode =
  | { kind: 'standalone'; slug: Category; label: string }
  | { kind: 'group'; label: string; children: Category[] }

export const SIDEBAR_STRUCTURE: SidebarNode[] = [
  { kind: 'group', label: 'Clothing', children: ['dresses', 'tops', 'skirts', 'pants', 'jeans', 'shorts', 'outerwear', 'swim', 'activewear'] },
  { kind: 'standalone', slug: 'shoes', label: 'Shoes' },
  { kind: 'standalone', slug: 'bags', label: 'Handbags' },
  { kind: 'standalone', slug: 'jewelry', label: 'Jewelry' },
  { kind: 'group', label: 'Accessories', children: ['belts', 'scarves', 'hats', 'sunglasses'] },
  { kind: 'standalone', slug: 'other', label: 'Other' },
]

/** Map a GoodPix content_tag NAME to a garment category (null = not a garment tag). */
const CONTENT_TAG_TO_CATEGORY: Record<string, Category> = {
  // dresses
  dress: 'dresses', dresses: 'dresses', gown: 'dresses', gowns: 'dresses',
  jumpsuit: 'dresses', jumpsuits: 'dresses', romper: 'dresses', rompers: 'dresses',
  // tops
  top: 'tops', tops: 'tops', blouse: 'tops', tee: 'tops', tank: 'tops', cami: 'tops',
  sweater: 'tops', sweaters: 'tops', turtleneck: 'tops', bodysuit: 'tops', bodysuits: 'tops',
  polo: 'tops', shell: 'tops', tunic: 'tops', dickey: 'tops', dickeys: 'tops',
  'tanks and short sleeve tees': 'tops', 'long sleeve tops': 'tops',
  // bottoms (split: skirts / pants / jeans / shorts)
  pant: 'pants', pants: 'pants', trouser: 'pants', trousers: 'pants', leggings: 'pants',
  tights: 'pants', chino: 'pants', chinos: 'pants', joggers: 'pants', slacks: 'pants',
  jean: 'jeans', jeans: 'jeans', denim: 'jeans',
  skirt: 'skirts', skirts: 'skirts', skort: 'skirts', skorts: 'skirts',
  short: 'shorts', shorts: 'shorts', 'shorts and skorts': 'shorts',
  // outerwear
  jacket: 'outerwear', jackets: 'outerwear', blazer: 'outerwear', blazers: 'outerwear',
  'jackets/blazers': 'outerwear', coat: 'outerwear', coats: 'outerwear',
  cardigan: 'outerwear', cardigans: 'outerwear', vest: 'outerwear', vests: 'outerwear',
  furs: 'outerwear', 'fur collar': 'outerwear', outerwear: 'outerwear', puffer: 'outerwear',
  cape: 'outerwear', poncho: 'outerwear',
  // swim / activewear
  swim: 'swim', swimwear: 'swim',
  activewear: 'activewear', 'athletic vests': 'activewear', 'athletic pants': 'activewear',
  // shoes / bags / jewelry
  shoe: 'shoes', shoes: 'shoes',
  bag: 'bags', bags: 'bags', handbag: 'bags', handbags: 'bags',
  jewelry: 'jewelry',
  // accessories (split out)
  belt: 'belts', belts: 'belts',
  scarf: 'scarves', scarves: 'scarves',
  hat: 'hats', hats: 'hats',
  sunglasses: 'sunglasses',
}

/** First-word / prefix patterns (GoodPix "category-brand-color" naming). */
const PREFIX_MAP: Record<string, Category> = {
  dress: 'dresses', gown: 'dresses', jumpsuit: 'dresses', romper: 'dresses',
  top: 'tops', blouse: 'tops', tee: 'tops', shirt: 'tops', tank: 'tops', cami: 'tops',
  sweater: 'tops', turtleneck: 'tops', bodysuit: 'tops', polo: 'tops', hoodie: 'tops',
  pant: 'pants', pants: 'pants', trouser: 'pants', trousers: 'pants', legging: 'pants', leggings: 'pants',
  chino: 'pants', chinos: 'pants', jogger: 'pants', joggers: 'pants', slacks: 'pants',
  jean: 'jeans', jeans: 'jeans',
  skirt: 'skirts', skort: 'skirts',
  short: 'shorts', shorts: 'shorts',
  jacket: 'outerwear', blazer: 'outerwear', coat: 'outerwear', cardigan: 'outerwear',
  vest: 'outerwear', puffer: 'outerwear', cape: 'outerwear', poncho: 'outerwear', shacket: 'outerwear',
  heels: 'shoes', boots: 'shoes', boot: 'shoes', sneakers: 'shoes', sandals: 'shoes', sandal: 'shoes',
  loafer: 'shoes', loafers: 'shoes', pumps: 'shoes', pump: 'shoes', flats: 'shoes', flat: 'shoes',
  mules: 'shoes', mule: 'shoes', slides: 'shoes', slide: 'shoes', espadrille: 'shoes',
  shoes: 'shoes', shoe: 'shoes', booties: 'shoes', bootie: 'shoes', wedge: 'shoes',
  bag: 'bags', tote: 'bags', clutch: 'bags', purse: 'bags', handbag: 'bags',
  crossbody: 'bags', backpack: 'bags', satchel: 'bags',
  earrings: 'jewelry', earring: 'jewelry', necklace: 'jewelry', bracelet: 'jewelry',
  ring: 'jewelry', pendant: 'jewelry', brooch: 'jewelry', cuff: 'jewelry', watch: 'jewelry', chain: 'jewelry',
  belt: 'belts',
  scarf: 'scarves', wrap: 'scarves', shawl: 'scarves', stole: 'scarves',
  hat: 'hats', cap: 'hats', beanie: 'hats', beret: 'hats', fedora: 'hats',
  sunglasses: 'sunglasses',
  swim: 'swim', swimsuit: 'swim', bikini: 'swim',
}

/** Keyword patterns matched against the full name when prefix fails. Order matters. */
const KEYWORD_PATTERNS: [RegExp, Category][] = [
  // Accessories / bags / shoes are matched FIRST, so "Top Handle Satchel" and
  // "Denim Tote Bag" resolve to bags (not tops/jeans) and "Faux Fur Beanie" to a
  // hat (not outerwear). Dresses also runs early so "wrap dress" beats "wrap" scarf.
  [/\b(dress|gown|jumpsuit|romper|caftan|kaftan|shirtdress)\b/i, 'dresses'],
  // Shoes. Every alternative is word-bounded and plural-tolerant, and this line is the reason why:
  // it used to be a bare substring match, so "Bootcut Jeans" filed as shoes (168 of them across the
  // roster), "rawedge" matched "wedge", and "AMULETTE" matched "mule". `[a-z]*boots?` still catches
  // rainboot/tallboot compounds while excluding "bootcut" (there is no word break after "boot"), and
  // `\d*` tolerates the trailing-digit names in the GoodPix data ("heels1", "sandals1").
  // KEEP IN STEP WITH THE TWIN: atelier-builder and atelier-looks each carry their own copy.
  [/\b([a-z]*boots?|booties?|[a-z]*heel(?:s|ed)?|sneakers?|sneakerinas?|sandals?|sanals?|loafers?|pumps?|flats?|mules?|slides?|espadrilles?|shoes?|wedges?|slingbacks?|oxfords?|derbys?|derbies|flip[- ]?flops?|kitten)\d*\b/i, 'shoes'],
  [/\b(bag|tote|clutch|purse|handbag|crossbody|cross-body|backpack|satchel|birkin|kelly|pochette|hobo|minaudiere|duffle|duffel|top handle)\b/i, 'bags'],
  [/(earrings?|necklace|bracelet|pendant|brooch|cuff|choker|bangle|studs?|hoops?|ring)\b/i, 'jewelry'],
  [/\b(belt)\b/i, 'belts'],
  [/\b(scarf|shawl|stole|wrap|foulard)\b/i, 'scarves'],
  [/\b(hat|cap|beanie|beret|fedora|visor)\b/i, 'hats'],
  [/\b(sunglasses|sunnies)\b/i, 'sunglasses'],
  [/\b(bikini|swimsuit|one[- ]piece|swim|swimwear)\b/i, 'swim'],
  [/\b(legging|leggings|sports bra|athletic)\b/i, 'activewear'],
  // Bottoms split into specifics; jeans/skirt/shorts before the generic "pants".
  [/\b(jeans?|denim)\b/i, 'jeans'],
  [/\b(skirt|skort)\b/i, 'skirts'],
  [/\b(shorts?)\b/i, 'shorts'],
  [/\b(pants?|trousers?|culottes?|chinos?|joggers?|wide[- ]leg|tights|slacks?|capris?)\b/i, 'pants'],
  [/\b(top|blouse|shirt|tee|tank|cami|sweater|turtleneck|pullover|henley|bodysuit|tunic|polo|hoodie|sweatshirt|shell)\b/i, 'tops'],
  [/\b(jacket|blazer|coat|cardigan|vest|puffer|cape|poncho|trench|anorak|parka|shacket|overcoat|peacoat|fur)\b/i, 'outerwear'],
]

/** Detect a garment category from an item name. Returns 'other' when nothing matches. */
export function detectCategory(name: string): Category {
  if (!name) return 'other'
  const lower = name.toLowerCase().trim()

  if (lower.includes('-')) {
    const prefix = lower.split('-')[0].trim()
    if (PREFIX_MAP[prefix]) return PREFIX_MAP[prefix]
  }
  const firstWord = lower.split(/[\s\-,]+/)[0]
  if (PREFIX_MAP[firstWord]) return PREFIX_MAP[firstWord]

  for (const [pattern, category] of KEYWORD_PATTERNS) {
    if (pattern.test(lower)) return category
  }
  return 'other'
}

/**
 * Resolve an item's garment category.
 * @param item       closet item (uses .category override if present, else .name)
 * @param tagNames   the item's content_tag names (resolved from content_tag_ids)
 */
export function resolveCategory(item: { name?: string; category?: string | null }, tagNames: string[]): Category {
  // 1. stylist override (Phase B) — a stored, valid category slug wins outright
  const override = (item.category ?? '').toLowerCase().trim()
  if (override && override in CATEGORY_LABELS) return override as Category

  // 2. GoodPix content_tag — first garment-type tag wins
  for (const raw of tagNames) {
    const hit = CONTENT_TAG_TO_CATEGORY[(raw ?? '').toLowerCase().trim()]
    if (hit) return hit
  }

  // 3. name detection
  return detectCategory(item.name ?? '')
}
