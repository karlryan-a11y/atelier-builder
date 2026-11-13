/**
 * Maegan's standard closet categories, women's (2026-10-20) and men's (11/12), the trees a client's
 * Wardrobe is filed in once she is switched on (every new client).
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

// Maegan's men's list (her Google Doc "Garment classification- Men's Clothing 2026", read 11/12).
const MEN_LIST: [string, string[]][] = [
  ['Blazers & Suit Jackets', ['Blazers & Sport Coats', 'Suit Jackets', 'Black Tie & Formal Jackets', 'Other Tailored Jackets', 'Tailored Vests / Waistcoats']],
  ['Suits', ['Two-Piece Suits', 'Three-Piece Suits', 'Tuxedos & Formal Suits', 'Coordinated Sets']],
  ['Pants', ['Tailored Trousers', 'Chinos', 'Casual Pants', 'Jeans']],
  ['Shirts', ['Dress Shirts', 'Casual Button-Front Shirts', 'Polo Shirts', 'T-Shirts', 'Henleys', 'Overshirts']],
  ['Sweaters & Knitwear', ['Pullover Sweaters', 'Turtlenecks & Mock Necks', 'Cardigans', 'Zip Sweaters', 'Sweater Vests']],
  ['Outerwear', ['Coats', 'Jackets', 'Vests', 'Capes & Specialty Outerwear']],
  ['Shorts', ['Tailored Shorts', 'Casual Shorts', 'Denim Shorts']],
  ['Athletic', ['Performance Tops', 'Performance Bottoms', 'Training Shorts', 'Compression & Base Layers', 'Sport-Specific Apparel']],
  ['Athleisure', ['Sweatshirts & Hoodies', 'Joggers & Sweatpants', 'Casual Track Jackets', 'Casual Track Pants', 'Matching Lounge Sets']],
  ['Swimwear', ['Swim Trunks', 'Swim Briefs', 'Board Shorts', 'Rash Guards']],
  ['Shoes', ['Dress Shoes', 'Loafers', 'Sneakers', 'Boots', 'Sandals & Slides', 'Slippers', 'Performance Shoes']],
  ['Belts', ['Dress Belts', 'Casual Belts', 'Statement Belts']],
  ['Ties & Neckwear', ['Neckties', 'Bow Ties', 'Ascots & Dress Scarves']],
  ['Pocket Squares & Handkerchiefs', ['Pocket Squares', 'Handkerchiefs']],
  ['Cufflinks & Formal Accessories', ['Cufflinks', 'Tie Bars & Clips', 'Collar Accessories', 'Stud Sets']],
  ['Accessories', ['Hats', 'Gloves', 'Scarves', 'Sunglasses & Eyewear', 'Bags & Small Leather Goods']],
  ['Underwear, Socks & Sleepwear', ['Underwear', 'Undershirts', 'Dress Socks', 'Casual Socks', 'Athletic Socks', 'Pajamas & Robes']],
  ['Jewelry & Timepieces', ['Watches', 'Bracelets', 'Rings', 'Necklaces & Chains', 'Earrings', 'Brooches & Lapel Pins', 'Other Jewelry']],
  ['Specialty Garments', ['Traditional & Cultural Clothing', 'Costume & Theme Clothing', 'Other Specialty Clothing']],
]

export const MEN_CATEGORIES: StdCategory[] = MEN_LIST.map(([label]) => ({ slug: slugOf(label), label }))
export const MEN_SUBS: StdSub[] = MEN_LIST.flatMap(([label, subs]) => subs.map((s) => ({ slug: slugOf(s), label: s, parent: slugOf(label) })))

export const TREES: Record<TreeKind, { categories: StdCategory[]; subs: StdSub[] }> = {
  women: { categories: WOMEN_CATEGORIES, subs: WOMEN_SUBS },
  men: { categories: MEN_CATEGORIES, subs: MEN_SUBS },
}

/** Collections every client can be tagged into (Maegan's lists), before any of her own. */
export const STANDARD_COLLECTIONS: StdCategory[] = [
  { slug: 'eveningwear', label: 'Eveningwear' },
  { slug: 'resort-and-beach', label: 'Resort & Beach' },
]
export const MEN_COLLECTIONS: StdCategory[] = [
  { slug: 'eveningwear', label: 'Eveningwear & Black Tie' },
  { slug: 'resort-and-beach', label: 'Resort & Beach' },
  { slug: 'golf', label: 'Golf' },
  { slug: 'tennis', label: 'Tennis' },
  { slug: 'fur-and-shearling', label: 'Fur & Shearling' },
  { slug: 'ski', label: 'Ski & Snow' },
  { slug: 'travel', label: 'Travel' },
  { slug: 'workwear', label: 'Workwear' },
]
export const collectionsFor = (kind: TreeKind) => (kind === 'men' ? MEN_COLLECTIONS : STANDARD_COLLECTIONS)

export type ClosetTree = { kind: TreeKind; categories: StdCategory[]; subs: StdSub[] }

/**
 * Which tree her Wardrobe uses: gp_clients.raw.closet_tree, 'women' or 'men'. Every new client is
 * switched on when her site is made (wsg-dashboard provisionClientSite); existing clients are unset
 * and keep today's closet and pickers (Karl, 11/12: he decides on existing clients separately).
 */
export function closetTreeOf(closetTree: string | null | undefined): ClosetTree | null {
  const v = String(closetTree ?? '').trim().toLowerCase()
  if (v !== 'women' && v !== 'men') return null
  return { kind: v, ...TREES[v] }
}

/**
 * The tree as closet-tree rows (slug, label, parent_slug, sort_order), the shape Edit Item's
 * two-step picker reads (lib/categoryTreeChoices.ts): her main category, then a sub-category in it.
 */
export function standardTreeRows(tree: ClosetTree) {
  return [
    ...tree.categories.map((c, i) => ({ slug: c.slug, label: c.label, parent_slug: null as string | null, sort_order: i + 1 })),
    ...tree.subs.map((s, i) => ({ slug: s.slug, label: s.label, parent_slug: s.parent as string | null, sort_order: 100 + i })),
  ]
}
