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
