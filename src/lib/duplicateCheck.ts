import { queryWords } from '@/lib/pieceSearch'
import { detectCategory } from '@/lib/categorize'
import type { ClosetItem } from '@/lib/images'

/** The name she sees: the rename if there is one. Local, so the guard can load this file alone. */
const displayName = (i: Pick<ClosetItem, 'name' | 'name_override'>) => (i.name_override?.trim() || i.name) ?? ''

/**
 * IS THIS PIECE ALREADY IN HER CLOSET? (ADR-0164)
 *
 * 2026-09-24: Cynthia searched Peyton Wheeler's closet for "margaret satin sheath midi", found
 * nothing, and added "Margaret Satin Sheath Midi Shirt Dress" (Lena Hoschek). The closet already held
 * "Floral Margaret Satin Sheath Belted Shirt Dress" (Lena Hoschek), from November 2024. Maegan asked
 * for a guard that day; it was promised and not built until now.
 *
 * One rule, used by every place a piece is added (Add Item, and Digitize approval), built on the
 * same matcher as search so "is this the same piece" can never disagree with "would search find it":
 *
 *   - every word of the new name is in an existing piece's name, exactly, or all but one when the
 *     name has five or more words (the Margaret case: 5 of 6);
 *   - and the existing name has at most one word the new one lacks (two, on the all-but-one rule),
 *     so a short generic name never matches every longer one;
 *   - and no clash of colour words (a white cami and a black cami are two cami), nor of garment type
 *     as the name reader sees it (a suit jacket and a suit pant are two pieces);
 *   - and the designers agree when both are known (a "Black Wool Coat" by two designers is two coats);
 *   - and the name has at least three real words, so "Black Top" never stops anyone.
 *
 * It WARNS. The stylist decides: two of the same dress is sometimes true.
 */
const fold = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

const PLACEHOLDER_BRAND = new Set(['', 'none', 'unknown', 'n a', 'na'])

/** Colour words: two pieces named with different ones are two pieces (a white cami, a black cami). */
const COLOURS = new Set(['black', 'white', 'ivory', 'cream', 'grey', 'gray', 'beige', 'brown', 'navy', 'blue',
  'green', 'olive', 'teal', 'purple', 'lavender', 'pink', 'blush', 'red', 'burgundy', 'orange', 'yellow',
  'gold', 'silver', 'tan', 'camel', 'nude', 'khaki', 'rust', 'coral', 'mint', 'lilac', 'multi'])

/** Exact words, singular: "sandals" and "sandal" are one word here; "plaid" and "check" are not. */
const wordsOf = (s: string) => queryWords(s).map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))

export function possibleDuplicates(
  candidate: { name: string; brand?: string | null },
  existing: Pick<ClosetItem, 'id' | 'name' | 'name_override' | 'brand' | 'is_deleted'>[],
  limit = 3,
): Pick<ClosetItem, 'id' | 'name' | 'name_override' | 'brand'>[] {
  // EXACT WORDS ONLY (measured 2026-10-06 over 88,819 pieces). Built on search's synonyms, shopping
  // words and typo tolerance, this flagged 22% of every closet: a gingham skirt against a plaid one, a
  // suit jacket against a blazer. A duplicate is the same words, not the same idea.
  const mine = wordsOf(candidate.name)
  if (mine.length < 3) return []
  const brand = fold(candidate.brand)
  const myColours = new Set(mine.filter((w) => COLOURS.has(w)))
  const myType = detectCategory(candidate.name)
  const out: { item: (typeof existing)[number]; score: number }[] = []
  for (const item of existing) {
    if (item.is_deleted) continue
    const theirs = fold(item.brand)
    if (!PLACEHOLDER_BRAND.has(brand) && !PLACEHOLDER_BRAND.has(theirs) && brand !== theirs) continue
    const their = new Set(wordsOf(displayName(item as ClosetItem)))
    const theirColours = [...their].filter((w) => COLOURS.has(w))
    if (myColours.size && theirColours.length && !theirColours.some((c) => myColours.has(c))) continue
    // Two garment types are two pieces: a suit jacket and a suit pant share every word but one.
    const theirType = detectCategory(displayName(item as ClosetItem))
    if (myType !== 'other' && theirType !== 'other' && myType !== theirType) continue
    const found = mine.filter((w) => their.has(w)).length
    // And not a short name inside a long one: "Wool Midi Skirt" is not every wool midi skirt.
    const extra = their.size - found
    const close = (found === mine.length && extra <= 1) || (mine.length >= 5 && found >= mine.length - 1 && extra <= 2)
    if (close) out.push({ item, score: found * 10 - Math.abs(their.size - mine.length) })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.item)
}

/** "Floral Margaret Satin Sheath Belted Shirt Dress (Lena Hoschek)" */
export function describeDuplicate(item: Pick<ClosetItem, 'name' | 'name_override' | 'brand'>): string {
  const b = (item.brand ?? '').trim()
  return `${displayName(item as ClosetItem)}${b && !PLACEHOLDER_BRAND.has(fold(b)) ? ` (${b})` : ''}`
}
