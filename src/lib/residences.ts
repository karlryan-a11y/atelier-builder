/**
 * Residences — the per-home scoping used by multi-residence clients (ADR-0070).
 *
 * A residence is NOT a new concept in the schema: it is an ordinary row in
 * `look_categories`, so looks are filed by residence with the same junction table
 * and the same chips as any other category. This file only names which slugs the
 * builder should TREAT as residences, so the review queue can be gated to clients
 * who actually have homes configured and stay invisible for everyone else.
 *
 * Item-level placement is messier, for a historical reason. Before the residence
 * feature existed, a stylist recorded "this piece lives in Aspen" the only way she
 * could: by typing it into the piece's garment-category field, producing pseudo
 * categories like `aspen-closet`. That is lossy — it overwrites the garment type,
 * so the piece drops out of Tops/Shoes/Outerwear — and it is being migrated to the
 * non-destructive `custom_categories[]` ("Also in") field. `residenceOfItem` reads
 * BOTH shapes so provenance keeps working across that migration.
 */

export const RESIDENCE_SLUGS = ['new-york-city', 'hamptons', 'aspen'] as const
export type ResidenceSlug = (typeof RESIDENCE_SLUGS)[number]

export function isResidenceSlug(slug: string): slug is ResidenceSlug {
  return (RESIDENCE_SLUGS as readonly string[]).includes(slug)
}

/** Legacy item-level placement: the residence was typed into the garment-category field. */
const PSEUDO_CATEGORY: Record<string, ResidenceSlug> = {
  'aspen-closet': 'aspen',
  'hamptons-closet': 'hamptons',
  'new-york-closet': 'new-york-city',
  'new-york-city-closet': 'new-york-city',
}

/**
 * Which residence(s) the stylist has placed this piece in, reading the current
 * (`custom_categories`) and legacy (`category` pseudo-slug) shapes alike.
 * Returns [] for a piece she hasn't placed — the common case.
 */
export function residenceOfItem(item: {
  category?: string | null
  custom_categories?: string[] | null
}): ResidenceSlug[] {
  const out = new Set<ResidenceSlug>()
  const legacy = PSEUDO_CATEGORY[(item.category ?? '').trim().toLowerCase()]
  if (legacy) out.add(legacy)
  for (const c of item.custom_categories ?? []) {
    const slug = String(c).trim().toLowerCase()
    if (isResidenceSlug(slug)) out.add(slug)
  }
  return [...out]
}

/**
 * True when this client has homes configured — i.e. two or more of her
 * `look_categories` are residences. One alone isn't a multi-residence client, it's
 * a stylist who happens to have made a category called "Aspen", so the review queue
 * stays hidden until the taxonomy actually says otherwise.
 */
export function hasResidences(categories: { slug: string }[]): boolean {
  return categories.filter((c) => isResidenceSlug(c.slug)).length >= 2
}
