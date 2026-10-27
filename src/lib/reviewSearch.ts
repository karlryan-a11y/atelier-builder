import { searchPieces, type PieceSearchFields } from './pieceSearch.ts'

/**
 * SEARCH THE PIECES WAITING IN NEEDS REVIEW (Paige Berndt, 2026-10-26: Barbie had 1,338 waiting and
 * she scrolled them all to find the pieces for a look). Brand, color and style, through the one
 * matcher every stylist screen uses (ADR-0151).
 *
 * Every word typed must be found, so "black blazer" is narrower than "black": she is looking for
 * one piece to approve, and a near match would bury it. The guard is scripts/check-review-search.mjs.
 *
 * A color word finds only pieces of that color, never a detail in the description. Searching "black"
 * for Barbie returned 450 of 1,241, and 78 of them were red, burgundy, white or silver pieces whose
 * description mentioned a black tip or a black top-lift. A color the pieces are filed under ("black",
 * "red") is matched against the piece's colors only. A shade that is not one of those ("burgundy",
 * "camel") is filed as its family (burgundy as Red), so it is matched against the colors and the name.
 * Every other word goes through the shared matcher as before.
 */
export function searchReview<T>(items: T[], query: string, fieldsOf: (item: T) => PieceSearchFields): T[] {
  const words = wordsOf(query)
  const colors = words.filter((w) => FAMILIES.has(w) || SHADES.has(w))
  if (!colors.length) return searchPieces(items, query, fieldsOf, 'team').full
  const rest = words.filter((w) => !colors.includes(w)).join(' ')
  const found = rest ? searchPieces(items, rest, fieldsOf, 'team').full : items
  return found.filter((it) => {
    const f = fieldsOf(it)
    const inColors = new Set([...(f.colorFamilies ?? []), f.color].flatMap((c) => (c ? wordsOf(c) : [])))
    const inName = new Set([f.name, f.nameOverride].flatMap((c) => (c ? wordsOf(c) : [])))
    return colors.every((c) => inColors.has(c) || (SHADES.has(c) && inName.has(c)))
  })
}

/** The color families pieces are filed under (Confirmed color, the Filter Colors chips). */
const FAMILIES = new Set(['black', 'white', 'cream', 'gray', 'brown', 'tan', 'navy', 'blue', 'green', 'purple', 'pink',
  'red', 'orange', 'yellow', 'metallic', 'multi', 'multicolor'])
/** Shades a stylist types that are mostly filed under a family. */
const SHADES = new Set(['ivory', 'beige', 'olive', 'teal', 'lavender', 'blush', 'burgundy', 'gold', 'silver', 'camel'])
const wordsOf = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .split(/[^a-z0-9]+/).filter(Boolean).map((w) => (w === 'grey' ? 'gray' : w))

const str = (v: unknown) => (typeof v === 'string' ? v : null)

/** An upload card: what digitizing read off the photos and the label. */
export function intakeSearchFields(item: {
  extracted_name: string | null
  extracted_brand: string | null
  extracted_color: string | null
  extracted_color_family: string | null
  extracted_color_families: string[] | null
  extracted_category: string | null
  extracted_material: string | null
  extracted_metadata: Record<string, unknown> | null
}): PieceSearchFields {
  const meta = item.extracted_metadata ?? {}
  const capture = (meta.capture ?? {}) as Record<string, unknown>
  return {
    name: item.extracted_name,
    brand: item.extracted_brand,
    color: item.extracted_color,
    colorFamilies: [item.extracted_color_family, ...(item.extracted_color_families ?? [])],
    material: item.extracted_material,
    description: str(meta.description) ?? str(capture.description),
    categories: [item.extracted_category, str(meta.subcategory), str(capture.subcategory)],
  }
}

/**
 * A row of the camera pick list, as the frame reports it to the sidebar. `find` is every detail
 * captured for the piece as one text (Karl, 2026-10-27: size, material, description, notes), so any
 * of them finds it. `facets` is the piece's own name, brand, colors and type, so a color word is
 * matched against its colors only and never against a black tip in the description.
 */
export type CapFacets = { name?: string | null; brand?: string | null; colors?: string[]; category?: string | null; subcategory?: string | null; garment_type?: string | null }
export function capSearchFields(row: { title: string; sub: string; find?: string; facets?: CapFacets }): PieceSearchFields {
  const f = row.facets
  // A frame that sends no fields finds the piece by its title only. The subtitle starts with the
  // client's name, and her name is in every row, so it would match them all.
  if (!f) return { name: row.title, description: row.find }
  return {
    name: row.title,
    // What the photos read, when the title shown is still "Piece" (details not confirmed yet).
    nameOverride: f.name && f.name !== row.title ? f.name : null,
    brand: f.brand,
    colorFamilies: f.colors ?? [],
    description: row.find,
    categories: [f.category, f.subcategory, f.garment_type],
  }
}
