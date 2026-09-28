import type { ClosetItem } from '@/lib/images'
import type { PieceSearchFields } from '@/lib/pieceSearch'
import { labelForCategory } from '@/lib/garmentCategory'

/**
 * EVERYTHING ON A PIECE THAT SEARCH MAY READ, in one place (ADR-0155).
 *
 * The canvas rail and the Collection tab each built this object by hand, and each had a field the
 * other did not: the colour families, the category labels, retailer and material were missing
 * from both. One builder here, so a field added to the piece is searchable on every stylist
 * screen at once.
 *
 * `categories` are the piece's resolved category slugs, and their human labels are added so
 * "high top sneakers" finds "high-top-sneakers". GoodPix stores an empty description as the
 * string "[]", which is not a word she typed.
 */
export function closetSearchFields(item: ClosetItem, categories: string[], tagNames: string[]): PieceSearchFields {
  const legacy = item.raw?.description
  return {
    name: item.name,
    nameOverride: item.name_override,
    brand: item.brand,
    color: item.color,
    colorFamilies: [item.color_family, ...(item.color_families ?? [])],
    description: item.description,
    material: item.raw?.material,
    retailer: item.retailer,
    categories: [...categories, ...categories.map(labelForCategory)],
    tags: tagNames,
    internalNote: item.style_note,
    size: item.size,
    legacyDescription: legacy && legacy !== '[]' ? legacy : null,
  }
}
