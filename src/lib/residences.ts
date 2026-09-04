/**
 * Residences — the per-home scoping used by multi-residence clients (ADR-0070, ADR-0111).
 *
 * A residence is NOT a new concept in the schema: it is an ordinary row in
 * `look_categories`, so looks are filed by residence with the same junction table and the
 * same chips as any other category.
 *
 * WHICH ROWS ARE HOMES IS A FLAG ON THE ROW, NOT A LIST IN THIS FILE (ADR-0111).
 *
 * It used to be a list here: three slugs, `['new-york-city', 'hamptons', 'aspen']`, matched
 * with no client context, so "aspen" was a home for whoever happened to hold it. Adding a
 * home for a client meant editing this file and its twin in atelier-looks and deploying
 * both. Now `look_categories.is_residence` says so and a stylist ticks the box herself.
 *
 * KEEP IN STEP WITH THE TWIN: atelier-looks carries the client-facing half at
 * src/lib/residences.ts. Two repos, no shared package, same normalisation rules. If the
 * builder and the lookbook disagree about which spellings mean the same home, a stylist
 * files a piece somewhere the client never sees it.
 *
 * Item-level placement is messier, for a historical reason. Before the residence feature
 * existed, a stylist recorded "this piece lives in Aspen" the only way she could: by typing
 * it into the piece's garment-category field, producing pseudo categories like
 * `aspen-closet` and `chicago studio`. That is lossy -- it overwrites the garment type, so
 * the piece drops out of Tops/Shoes/Outerwear -- and it is being migrated to the
 * non-destructive `custom_categories[]` ("Also in") field. `residenceOfItem` reads BOTH
 * shapes so provenance keeps working across that migration.
 */

/** Two homes make a multi-residence client. One is a category with a place name on it. */
export const MIN_RESIDENCES = 2

/** The shape this module needs off a `look_categories` row. */
export interface ResidenceCategoryRow {
  slug: string
  label?: string | null
  is_residence?: boolean | null
}

/** The words a stylist appends when she writes a home into a garment-category field. */
const PLACE_SUFFIXES = ['closet', 'studio'] as const

/** Twin of normaliseResidence in atelier-looks. Keep the two identical. */
function normalise(raw: string): string {
  const base = String(raw)
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const stripped = base.replace(new RegExp(`-(${PLACE_SUFFIXES.join('|')})$`), '')
  return stripped || base
}

/** This client's home categories, in the order they were given. */
export function residencesFrom(rows: ResidenceCategoryRow[] | null | undefined): ResidenceCategoryRow[] {
  return (rows ?? []).filter((r) => r?.is_residence === true && !!r.slug)
}

/** Just the slugs, which is what most callers want to ask about. */
export function residenceSlugsOf(rows: ResidenceCategoryRow[] | null | undefined): Set<string> {
  return new Set(residencesFrom(rows).map((r) => r.slug))
}

/**
 * True when this client has homes configured -- two or more of her `look_categories` are
 * flagged. One alone is not a multi-residence client, so the review queue and the home
 * tiles stay hidden until the taxonomy actually says otherwise.
 */
export function hasResidences(rows: ResidenceCategoryRow[] | null | undefined): boolean {
  return residencesFrom(rows).length >= MIN_RESIDENCES
}

/**
 * Any spelling of one of THIS client's homes -> its slug, else null.
 *
 * Bound to her rows rather than to a global list, which is what makes renaming a home real:
 * rename "Chicago" to "Lake House" and a piece filed under "Lake House" resolves the same
 * second, with nothing here to update.
 */
export function residenceResolverFor(rows: ResidenceCategoryRow[] | null | undefined): (raw: string | null | undefined) => string | null {
  const aliases = new Map<string, string>()
  for (const r of residencesFrom(rows)) {
    // Slug last so it wins if two homes ever normalise to the same word -- it is the thing
    // the junction tables actually key on.
    for (const alias of [r.label ?? '', r.slug]) {
      const k = normalise(alias)
      if (k) aliases.set(k, r.slug)
    }
  }
  return (raw) => (raw ? aliases.get(normalise(raw)) ?? null : null)
}

/**
 * Which of this client's homes the stylist has placed this piece in, reading the current
 * (`custom_categories`) and legacy (`category` pseudo-slug) shapes alike. Returns [] for a
 * piece she has not placed -- the common case -- and for every client without homes.
 */
export function residenceOfItem(
  item: { category?: string | null; custom_categories?: string[] | null },
  rows: ResidenceCategoryRow[] | null | undefined,
): string[] {
  const resolve = residenceResolverFor(rows)
  const out = new Set<string>()
  const legacy = resolve(item.category)
  if (legacy) out.add(legacy)
  for (const c of item.custom_categories ?? []) {
    const slug = resolve(c)
    if (slug) out.add(slug)
  }
  return [...out]
}
