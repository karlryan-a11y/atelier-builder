/**
 * Category nesting: the per-client tree that turns a flat list of filters into
 * Outerwear > Jackets, Coats, Vests. (ADR-0113)
 *
 * KEEP IN STEP WITH THE TWIN: atelier-looks carries its own copy at
 * src/lib/categoryNesting.ts. Two repos, no shared package, same rules —
 * if the builder and the lookbook disagree about what is under Jewelry,
 * a stylist sets up a tree that the client never sees.
 *
 * The tree lives in `client_categories` (migration 006, given `parent_slug` by
 * migration 021). A row says "this slug sits under that slug". A slug with no
 * row, or a row with a null parent, is top level — which is every category on
 * every client today, so a client with no rows renders exactly as she does now.
 *
 * A PARENT IS A REAL CATEGORY, NOT A HEADING. 58 of Danielle York's pieces are
 * filed on Outerwear directly, alongside the 44 filed on Jackets. So the parent
 * is tappable, it is counted, and its count includes everything underneath it.
 * That rollup is the entire point: her Jewelry filter returns 41 today and she
 * owns 251 pieces of jewellery.
 *
 * A parent does NOT need a row of its own. Nesting `jackets` under `outerwear`
 * takes one row, because `outerwear` is already a category from the fixed
 * taxonomy. This is why parent_slug is not a foreign key.
 */

/** One row of a client's tree, as stored. */
export interface NestingRow {
  slug: string
  label: string | null
  parent_slug: string | null
  sort_order: number
  /** ADR-0163: this category is read AS that one ("handbags" -> "bags"). Wins over parent_slug. */
  same_as?: string | null
}

/**
 * A client's category map: slug -> parent (INSIDE), plus `sameAs`, slug -> the category it is
 * read as (SAME AS). Carried on the parent map so every caller that already passes the tree gets
 * the map too, with no second argument to forget (ADR-0163).
 */
export type CategoryTree = Map<string, string> & { sameAs?: Map<string, string> }

/**
 * How deep a chain may go before we stop walking it.
 *
 * The tree is typed by a stylist through a dropdown, so it is not guaranteed to
 * be a tree at all. A cycle (A under B under A) would spin forever inside a page
 * render, which on a client-facing route means a hung request, not an error
 * anybody sees. The visited-set below already breaks a cycle; this is the second
 * belt, and it also puts a bound on a chain long enough to be a mistake.
 */
const MAX_DEPTH = 8

/**
 * The key a category is matched on: lowercase, accents folded, every run of non-letters one dash.
 * The two apps spell the same category two ways ("summer dresses" as a primary, "summer-dresses"
 * as an Also in; 849 primaries on 33 clients carry spaces or symbols), and a map row a stylist
 * saves must apply to every spelling, in both apps. Only LOOKUPS use this key; the slugs pieces
 * resolve to are not changed, because homes are recognised by their exact spellings (ADR-0163).
 */
export function categoryKey(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** key -> parent slug, from stored rows, carrying the SAME AS map. Self-references are dropped. */
export function parentMapFrom(rows: NestingRow[]): CategoryTree {
  const m: CategoryTree = new Map<string, string>()
  const sameAs = new Map<string, string>()
  for (const r of rows) {
    const child = categoryKey(r.slug)
    if (!child) continue
    const as = (r.same_as ?? '').trim().toLowerCase()
    if (as && categoryKey(as) !== child) { sameAs.set(child, as); continue }
    const parent = (r.parent_slug ?? '').trim().toLowerCase()
    if (!parent || categoryKey(parent) === child) continue
    m.set(child, parent)
  }
  m.sameAs = sameAs
  return m
}

/**
 * THE STANDARD NESTING SET (2026-10-28). Every client's Collection starts nested this way, so
 * a stylist no longer sets up Jewelry > Earrings by hand for each one (5 of 996 had any).
 *
 * Karl's list wins: Outerwear (Jackets, Coats), Pants (Denim), Shoes (Heels, Sandals, Boots,
 * Sneakers, Flats), Tops (Sleeveless, Short Sleeve, Long Sleeve, Bodysuits), Sweaters
 * (Sweatshirts), Jewelry (Necklaces, Earrings, Rings, Pendants, Time Pieces, Brooches). Maegan's
 * Suits, Swimwear, Blazers, Athleisure and Underpinnings, and the rest of Julia and Paige's
 * "Standard Nesting Categories" doc (wsg-dashboard src/lib/captureV2/categories.ts), are merged in.
 * Blazers stay on their own (Maegan), not inside Suits.
 *
 * Parents are the slugs pieces are already filed under (`jeans` is the Denim chip, `swim` the
 * Swim chip, `bags` the Handbags chip), so a parent's chip is the one she already has.
 *
 * ONE LEVEL ONLY. The sidebar draws a heading and the chips inside it; a grandchild would have
 * no chip. So no parent here is ever a child, and a child whose parent a stylist nested goes to
 * the top group instead (withStandardNesting).
 *
 * A name matches in every spelling pieces use: singular or plural (heel, heels), with or
 * without spaces or dashes (shortsleeves, short-sleeve), and by its last word, so
 * "costume-earrings" is jewelry and "low-heel-jeans" is under Pants. A child that would be
 * ambiguous on its own (Mini, Denim under Shorts) is matched only that way ("mini-skirts").
 */
export const STANDARD_NESTING: Record<string, readonly string[]> = {
  outerwear: ['jackets', 'coats', 'vests', 'capes', 'trench-coats', 'puffers', 'parkas'],
  suits: ['suit-pants', 'suit-skirts', 'suit-jackets'],
  pants: ['jeans', 'denim', 'trousers', 'leather-pants', 'cargo-pants'],
  shorts: ['denim-shorts', 'non-denim-shorts', 'tailored-shorts', 'leather-shorts'],
  skirts: ['mini-skirts', 'midi-skirts', 'maxi-skirts', 'denim-skirts', 'leather-skirts'],
  dresses: ['cocktail-dresses', 'gowns', 'sweater-dresses', 'shirt-dresses', 'mini-dresses', 'midi-dresses', 'maxi-dresses'],
  tops: ['sleeveless', 'short-sleeve', 'long-sleeve', 'long-sleeve-tops', 'bodysuits', 'underpinnings', 'blouses', 'button-downs', 't-shirts', 'tees', 'cropped'],
  sweaters: ['sweatshirts', 'cardigans', 'knit-tops', 'knit-vests', 'sweater-vests'],
  shoes: ['heels', 'sandals', 'boots', 'sneakers', 'flats', 'loafers', 'mules', 'wedges'],
  swim: ['swimwear', 'bikinis', 'one-piece-swimsuits', 'cover-ups', 'coverups', 'swim-separates', 'bathing-suits'],
  athleisure: ['sweatpants', 'matching-sets', 'sweatsuits', 'sweat-suits', 'tracksuits'],
  activewear: ['leggings', 'sports-bras', 'athletic-tops', 'athletic-bottoms', 'athletic-vests', 'tennis-dresses'],
  sets: ['lounge-sets', 'travel-sets', 'knit-sets', 'skirt-sets', 'short-sets'],
  'one-pieces': ['jumpsuits', 'rompers'],
  bags: ['totes', 'shoulder-bags', 'crossbodies', 'crossbody', 'top-handles', 'top-handle-bags', 'clutches', 'evening-bags', 'travel-bags'],
  accessories: ['belts', 'scarves', 'scarf', 'shawls', 'wraps', 'hats', 'gloves', 'sunglasses', 'hair-accessories'],
  jewelry: ['necklaces', 'earrings', 'rings', 'pendants', 'time-pieces', 'watches', 'brooches', 'bracelets', 'anklets', 'charms', 'cuffs', 'body-jewelry'],
  hosiery: ['tights', 'stockings', 'socks', 'knee-high-socks'],
  intimates: ['bras', 'underwear', 'shapewear', 'slips', 'camisoles'],
  sleepwear: ['pajama-sets', 'pajamas', 'nightgowns', 'robes', 'sleep-separates'],
}
/** Other spellings of a parent that are read as inside it. */
const PARENT_ALIASES: Record<string, readonly string[]> = { jewelry: ['jewellery'], accessories: ['accessory'] }

/** A name with its dashes gone, and its singular forms: heels -> heels, heel; dresses -> dress. */
function forms(key: string): string[] {
  const k = key.replace(/-/g, '')
  const out = [k]
  if (k.endsWith('es') && k.length - 2 >= 3) out.push(k.slice(0, -2))
  if (k.endsWith('s') && k.length - 1 >= 3) out.push(k.slice(0, -1))
  return out
}
const STANDARD_BY_FORM = (() => {
  const parents = new Map<string, string>()
  const children = new Map<string, string>()
  for (const [parent, kids] of Object.entries(STANDARD_NESTING)) {
    for (const f of forms(parent)) parents.set(f, parent)
    for (const a of PARENT_ALIASES[parent] ?? []) for (const f of forms(a)) children.set(f, parent)
    for (const kid of kids) for (const f of forms(kid)) children.set(f, parent)
  }
  return { parents, children }
})()

/** The standard parent of a category, or null when it stays on top. */
export function standardParentOf(slug: string): string | null {
  const key = categoryKey(slug)
  if (!key) return null
  if (STANDARD_NESTING[key]) return null
  const whole = forms(key)
  for (const f of whole) { const p = STANDARD_BY_FORM.children.get(f); if (p) return p }
  // A singular of a parent ("sweater") reads inside it.
  for (const f of whole) { const p = STANDARD_BY_FORM.parents.get(f); if (p && p !== key) return p }
  // By its last word: costume-earrings, low-heel-jeans, travel-shoes.
  const words = key.split('-')
  if (words.length < 2) return null
  for (const f of forms(words[words.length - 1])) {
    const p = STANDARD_BY_FORM.children.get(f) ?? STANDARD_BY_FORM.parents.get(f)
    if (p) return p
  }
  return null
}

/** Is the standard set on for this client? Off only where `gp_clients.raw.standard_nesting` is false. */
export function standardNestingOn(raw: { standard_nesting?: unknown } | null | undefined): boolean {
  return raw?.standard_nesting !== false
}

/** A client's request for a group, stored beside her tree until a stylist applies it (never part of it). */
export const isRequestRow = (r: { slug?: string | null; kind?: string | null }) =>
  r.kind === 'request' || (r.slug ?? '').startsWith('request:')

/**
 * Her stored rows plus the standard set for every category she uses that she has no row for.
 * A row of hers always wins, including one that takes a category back out (parent null).
 * `slugsInUse` are the categories her pieces carry, as categoriesOf gives them with no tree.
 */
export function withStandardNesting(rows: NestingRow[], slugsInUse: Iterable<string>): NestingRow[] {
  const own = rows.filter((r) => !isRequestRow(r as any))
  const stored = new Set(own.map((r) => categoryKey(r.slug)))
  const storedParents = parentMapFrom(own)
  const out = [...own]
  const added = new Set<string>()
  for (const slug of slugsInUse) {
    const key = categoryKey(slug)
    if (!key || stored.has(key) || added.has(key)) continue
    const parent = standardParentOf(key)
    if (!parent) continue
    // One level only: if she put this parent inside another, go to the top of that chain.
    const above = ancestorsOf(parent, storedParents)
    const top = above.length ? above[above.length - 1] : parent
    if (categoryKey(top) === key) continue
    added.add(key)
    out.push({ slug: key, label: null, parent_slug: top, sort_order: 0 })
  }
  return out
}

/** Does this tree change anything? Nesting or a SAME AS row. */
export function treeIsEmpty(tree: CategoryTree | undefined | null): boolean {
  return !tree || (tree.size === 0 && !(tree.sameAs?.size))
}

/**
 * Every ancestor of `slug`, nearest first. Empty for a top-level category.
 *
 * Cycle-safe: a slug already visited ends the walk. Depth-capped independently,
 * so a chain that is merely absurd rather than circular also terminates.
 */
export function ancestorsOf(slug: string, parentBySlug: Map<string, string>): string[] {
  const out: string[] = []
  const seen = new Set<string>([slug])
  let cur = slug
  for (let i = 0; i < MAX_DEPTH; i++) {
    const parent = parentBySlug.get(categoryKey(cur))
    if (!parent || seen.has(parent)) break
    out.push(parent)
    seen.add(parent)
    cur = parent
  }
  return out
}

/**
 * The categories a piece should be findable under, given the tree: the ones it
 * carries, plus every ancestor of each. Order is preserved and the first entry
 * stays the piece's own primary category, because callers use `[0]` as the
 * display label.
 *
 * With an empty map this returns its input unchanged. That is what makes the
 * feature opt-in: a client with no tree gets byte-identical behaviour.
 */
export function withAncestors(slugs: string[], parentBySlug: CategoryTree): string[] {
  if (treeIsEmpty(parentBySlug)) return slugs
  // SAME AS first, one hop: "handbags" becomes "bags" before the tree is walked, so the piece is
  // counted, filtered and searched as Handbags and the stylist's spelling no longer has a chip.
  const as = parentBySlug.sameAs
  const mapped = as?.size ? slugs.map((s) => as.get(categoryKey(s)) ?? s) : slugs
  const out: string[] = []
  const seen = new Set<string>()
  const push = (s: string) => { if (s && !seen.has(s)) { seen.add(s); out.push(s) } }
  for (const s of mapped) {
    push(s)
    for (const a of ancestorsOf(s, parentBySlug)) push(a)
  }
  return out
}

/**
 * Would nesting `child` under `parent` create a cycle? Used to grey out the
 * options a stylist must not pick, rather than letting her save a tree that the
 * resolver then silently truncates.
 */
export function wouldCycle(child: string, parent: string, parentBySlug: Map<string, string>): boolean {
  if (!child || !parent) return false
  if (child === parent) return true
  // A cycle appears exactly when `child` is already somewhere above `parent`.
  return ancestorsOf(parent, parentBySlug).includes(child)
}

export interface TreeChild { slug: string; label: string; count: number }
export interface TreeNode { slug: string; label: string; count: number; children: TreeChild[] }

/**
 * Build the render tree for a sidebar.
 *
 * `counts` must already be ancestor-expanded (i.e. built from `withAncestors`),
 * so a parent's count is its own pieces plus everything underneath it.
 *
 * A category with a count of zero never appears, parent or child. That is the
 * ADR-0108 rule and it matters more here than it did there: the whole point of
 * this screen is that a stylist sets up a category before filling it, and an
 * empty new child ("Small Earrings", the day it is created) must not reach the
 * client as a filter that opens a blank page.
 *
 * A child whose parent has no pieces at all is promoted to top level rather than
 * dropped, so a piece can never become unreachable because of where it was filed.
 */
export function buildTree(
  counts: Map<string, number>,
  parentBySlug: Map<string, string>,
  labelFor: (slug: string) => string,
  order?: (slug: string) => number,
): TreeNode[] {
  const live = (s: string) => (counts.get(s) ?? 0) > 0
  const rank = (s: string) => order?.(s) ?? Number.MAX_SAFE_INTEGER

  const childrenOf = new Map<string, TreeChild[]>()
  const tops: string[] = []

  for (const [slug, count] of counts) {
    if (count <= 0) continue
    const parent = parentBySlug.get(categoryKey(slug))
    // Promote rather than drop: a parent with nothing in it is not rendered, so
    // hanging its children off it would take them off the page with it.
    if (parent && parent !== slug && live(parent)) {
      const list = childrenOf.get(parent) ?? []
      list.push({ slug, label: labelFor(slug), count })
      childrenOf.set(parent, list)
    } else {
      tops.push(slug)
    }
  }

  const sortByRankThenLabel = <T extends { slug: string; label: string }>(a: T, b: T) =>
    rank(a.slug) - rank(b.slug) || a.label.localeCompare(b.label)

  return tops
    .map((slug) => ({
      slug,
      label: labelFor(slug),
      count: counts.get(slug) ?? 0,
      children: (childrenOf.get(slug) ?? []).sort(sortByRankThenLabel),
    }))
    .sort(sortByRankThenLabel)
}
