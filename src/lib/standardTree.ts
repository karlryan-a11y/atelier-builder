/**
 * Maegan's standard closet categories (2026-10-20), the tree every client's Wardrobe is filed in.
 *
 * KEEP IN STEP WITH THE TWINS: atelier-looks src/lib/standardTree.ts (which also reads each piece
 * into the tree for her Wardrobe page) and wsg-dashboard src/lib/captureV2/wgip.ts. This copy is
 * what the pickers offer: file a piece under a sub-category, or tag it into a Collection.
 */

export type TreeKind = 'women' | 'men'
export interface StdCategory { slug: string; label: string }
export interface StdSub { slug: string; label: string; parent: string }

const slugOf = (l: string) => l.toLowerCase().replace(/&/g, 'and').replace(/\//g, '-').replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

const WOMEN_LIST: [string, string[]][] = [
  ['Blazers & Tailored Jackets', ['Blazers', 'Suit Jackets', 'Evening & Formal Jackets', 'Other Tailored Jackets', 'Tailored Vests / Waistcoats']],
  ['Suits & Matching Sets', ['Pant Suits', 'Skirt Suits', 'Dress Suits', 'Matching Sets']],
  ['Dresses', ['Day Dresses', 'Work & Professional Dresses', 'Cocktail Dresses', 'Evening & Formal Gowns', 'Shirt Dresses', 'Knit Dresses', 'Specialty Dresses']],
  ['Skirts', ['Mini Skirts', 'Midi Skirts', 'Maxi Skirts']],
  ['Pants & Jeans', ['Tailored Trousers', 'Casual Pants', 'Chinos', 'Jeans', 'Leggings']],
  ['Tops & Blouses', ['Blouses & Dressy Tops', 'Button-Front Shirts', 'T-Shirts', 'Tank Tops & Camisoles', 'Bodysuits', 'Polo Shirts', 'Overshirts']],
  ['Sweaters & Knitwear', ['Pullover Sweaters', 'Turtlenecks & Mock Necks', 'Cardigans', 'Zip Sweaters', 'Sweater Vests', 'Knit Tops']],
  ['Outerwear', ['Coats', 'Jackets', 'Vests', 'Capes & Specialty Outerwear']],
  ['Shorts', ['Tailored Shorts', 'Casual Shorts', 'Denim Shorts']],
  ['Athletic', ['Performance Tops', 'Performance Bottoms', 'Training Shorts', 'Sports Bras', 'Compression & Base Layers', 'Sport-Specific Apparel']],
  ['Athleisure', ['Sweatshirts & Hoodies', 'Joggers & Sweatpants', 'Casual Leggings', 'Track Jackets & Pants', 'Matching Lounge Sets']],
  ['Swimwear', ['One-Piece Swimsuits', 'Bikinis', 'Tankinis & Swim Separates', 'Rash Guards']],
  ['Shoes', ['Heels', 'Flats', 'Loafers', 'Sneakers', 'Boots & Booties', 'Sandals & Slides', 'Espadrilles & Wedges', 'Performance Shoes', 'Slippers']],
  ['Handbags & Small Leather Goods', ['Totes', 'Shoulder Bags', 'Crossbody Bags', 'Top-Handle Bags', 'Clutches & Evening Bags', 'Backpacks & Travel Bags', 'Wallets & Small Leather Goods']],
  ['Belts', ['Dress Belts', 'Casual Belts', 'Statement Belts', 'Waist & Corset Belts']],
  ['Accessories', ['Scarves & Shawls', 'Hats', 'Gloves', 'Sunglasses & Eyewear', 'Hair Accessories', 'Other Accessories']],
  ['Lingerie, Hosiery & Sleepwear', ['Bras', 'Underwear', 'Shapewear', 'Slips & Camisoles', 'Tights & Hosiery', 'Socks', 'Pajamas & Robes']],
  ['Jewelry & Timepieces', ['Watches', 'Earrings', 'Necklaces & Pendants', 'Bracelets', 'Rings', 'Brooches & Pins', 'Other Jewelry']],
  ['Specialty Garments', ['Bridal & Wedding Attire', 'Traditional & Cultural Clothing', 'Costume & Theme Clothing', 'Other Specialty Clothing']],
]

export const WOMEN_CATEGORIES: StdCategory[] = WOMEN_LIST.map(([label]) => ({ slug: slugOf(label), label }))
export const WOMEN_SUBS: StdSub[] = WOMEN_LIST.flatMap(([label, subs]) => subs.map((s) => ({ slug: slugOf(s), label: s, parent: slugOf(label) })))

/** The trees by kind. The men's list is not in yet (her Google Doc), so a men's client keeps today's closet. */
export const TREES: Record<TreeKind, { categories: StdCategory[]; subs: StdSub[] } | null> = {
  women: { categories: WOMEN_CATEGORIES, subs: WOMEN_SUBS },
  men: null,
}

/** Collections every client can be tagged into, in this order, before any of her own. */
export const STANDARD_COLLECTIONS: StdCategory[] = [
  { slug: 'eveningwear', label: 'Eveningwear' },
  { slug: 'resort-and-beach', label: 'Resort & Beach' },
]

/** Which tree her Wardrobe uses: gp_clients.raw.closet_tree. Unset is the women's tree; 'men' and 'off' keep today's closet. */
export function closetTreeOf(closetTree: string | null | undefined): { kind: TreeKind; categories: StdCategory[]; subs: StdSub[] } | null {
  const v = String(closetTree ?? 'women').trim().toLowerCase()
  if (v !== 'women' && v !== 'men') return null
  const t = TREES[v]
  return t ? { kind: v, ...t } : null
}
