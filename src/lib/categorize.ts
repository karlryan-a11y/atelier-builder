/**
 * Detect the clothing category of a closet item from its name.
 *
 * GoodPix items follow a "category-brand-description" naming convention
 * for ~43% of items (31,806 of 73,742). For the rest, we keyword-match
 * against the full name.
 *
 * Returns a category compatible with the compose layout engine.
 */

import type { ExtractedItem } from './compose'

type Category = ExtractedItem['category']

/** Prefix patterns from GoodPix naming convention (e.g., "dress-brand-color") */
const PREFIX_MAP: Record<string, Category> = {
  dress: 'dress',
  gown: 'dress',
  jumpsuit: 'dress',
  romper: 'dress',

  top: 'top',
  blouse: 'top',
  tee: 'top',
  shirt: 'top',
  tank: 'top',
  cami: 'top',
  sweater: 'top',
  turtleneck: 'top',
  bodysuit: 'top',
  polo: 'top',
  hoodie: 'top',

  pant: 'bottom',
  pants: 'bottom',
  jean: 'bottom',
  jeans: 'bottom',
  shorts: 'bottom',
  skirt: 'bottom',
  legging: 'bottom',
  leggings: 'bottom',
  trouser: 'bottom',
  trousers: 'bottom',

  jacket: 'outerwear',
  blazer: 'outerwear',
  coat: 'outerwear',
  cardigan: 'outerwear',
  vest: 'outerwear',
  puffer: 'outerwear',
  cape: 'outerwear',
  poncho: 'outerwear',
  shacket: 'outerwear',

  heels: 'shoes',
  boots: 'shoes',
  boot: 'shoes',
  sneakers: 'shoes',
  sandals: 'shoes',
  sandal: 'shoes',
  loafer: 'shoes',
  loafers: 'shoes',
  pumps: 'shoes',
  pump: 'shoes',
  flats: 'shoes',
  flat: 'shoes',
  mules: 'shoes',
  mule: 'shoes',
  slides: 'shoes',
  slide: 'shoes',
  espadrille: 'shoes',
  shoes: 'shoes',
  shoe: 'shoes',
  booties: 'shoes',
  bootie: 'shoes',
  wedge: 'shoes',

  bag: 'bag',
  tote: 'bag',
  clutch: 'bag',
  purse: 'bag',
  handbag: 'bag',
  crossbody: 'bag',
  backpack: 'bag',
  satchel: 'bag',

  earrings: 'jewelry',
  earring: 'jewelry',
  necklace: 'jewelry',
  bracelet: 'jewelry',
  ring: 'jewelry',
  pendant: 'jewelry',
  brooch: 'jewelry',
  cuff: 'jewelry',
  watch: 'jewelry',
  chain: 'jewelry',

  belt: 'belt',

  scarf: 'scarf',
  wrap: 'scarf',
  shawl: 'scarf',
  stole: 'scarf',

  hat: 'hat',
  cap: 'hat',
  beanie: 'hat',
  beret: 'hat',
  fedora: 'hat',

  sunglasses: 'accessory',
  glasses: 'accessory',
  gloves: 'accessory',
  accessories: 'accessory',
}

/** Keyword patterns to match in the full name when prefix fails */
const KEYWORD_PATTERNS: [RegExp, Category][] = [
  // Dresses
  [/\b(dress|gown|jumpsuit|romper|caftan|kaftan|shirtdress)\b/i, 'dress'],
  // Shoes (before bottoms — "boot" must match before "bottom" patterns)
  [/(boots|boot|bootie|booties|heel|heels|sneaker|sneakers|sandal|sandals|loafer|loafers|pump|pumps|flat|flats|mule|mules|slide|slides|espadrille|shoe|shoes|wedge|slingback|oxford|derby|kitten)/i, 'shoes'],
  // Bottoms
  [/\b(pants?|trousers?|jeans?|denim|skirt|shorts?|leggings?|culottes?|chinos?|joggers?|wide[- ]leg)\b/i, 'bottom'],
  // Tops
  [/\b(top|blouse|shirt|tee|tank|cami|sweater|turtleneck|pullover|henley|bodysuit|tunic|polo|hoodie|sweatshirt|shell)\b/i, 'top'],
  // Outerwear
  [/\b(jacket|blazer|coat|cardigan|vest|puffer|cape|poncho|trench|anorak|parka|shacket|overcoat|peacoat)\b/i, 'outerwear'],
  // Bags
  [/\b(bag|tote|clutch|purse|handbag|crossbody|backpack|satchel)\b/i, 'bag'],
  // Jewelry
  [/(earrings?|necklace|bracelet|pendant|brooch|cuff|choker|bangle|studs?|hoops?)\b/i, 'jewelry'],
  // Belt
  [/\b(belt)\b/i, 'belt'],
  // Scarf
  [/\b(scarf|shawl|stole)\b/i, 'scarf'],
  // Hat
  [/\b(hat|cap|beanie|beret|fedora|visor)\b/i, 'hat'],
  // Accessories
  [/\b(sunglasses|glasses|gloves|umbrella)\b/i, 'accessory'],
]

/**
 * Detect category from item name. Returns the compose-compatible category string.
 *
 * Strategy:
 * 1. Try prefix match (first word before dash) — works for GoodPix format
 * 2. Try keyword match in full name — catches natural-language names
 * 3. Default to 'other'
 */
export function detectCategory(name: string): Category {
  if (!name) return 'other'

  const lower = name.toLowerCase().trim()

  // Strategy 1: GoodPix prefix (e.g., "dress-brand-description")
  if (lower.includes('-')) {
    const prefix = lower.split('-')[0].trim()
    if (PREFIX_MAP[prefix]) return PREFIX_MAP[prefix]
  }

  // Also check first word even without dash
  const firstWord = lower.split(/[\s\-,]+/)[0]
  if (PREFIX_MAP[firstWord]) return PREFIX_MAP[firstWord]

  // Strategy 2: Keyword match in full name
  for (const [pattern, category] of KEYWORD_PATTERNS) {
    if (pattern.test(lower)) return category
  }

  return 'other'
}
