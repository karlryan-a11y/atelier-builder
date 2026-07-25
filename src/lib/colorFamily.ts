// Canonical primary-color palette (mirrors the lookbook + intake pipeline). Used by the
// Colors audit tab dropdown. Order = display order.
export const COLOR_ORDER = [
  'Black', 'Grey', 'White', 'Ivory', 'Beige', 'Brown',
  'Red', 'Burgundy', 'Orange', 'Yellow', 'Gold', 'Silver',
  'Pink', 'Blush', 'Purple', 'Lavender',
  'Navy', 'Blue', 'Light Blue', 'Teal', 'Green', 'Olive',
  'Multicolor',
] as const

export type ColorFamily = (typeof COLOR_ORDER)[number]

// Small dot color for the current/suggested chips in the audit rows.
export const COLOR_SWATCH: Record<string, string> = {
  Black: '#1A1A1A', Grey: '#8A8A8A', White: '#FFFFFF', Ivory: '#F3EEE3',
  Beige: '#C8B99C', Brown: '#6B4A2F', Red: '#B22222', Burgundy: '#5E1A28',
  Orange: '#D2692E', Yellow: '#E3C245', Gold: '#C9A544', Silver: '#BFC1C4',
  Pink: '#E48BB0', Blush: '#E8C5C8', Purple: '#6B4A8A', Lavender: '#B9A7D6',
  Navy: '#1F2A44', Blue: '#3A5FA8', 'Light Blue': '#A9C6E0', Teal: '#2E8A8A',
  Green: '#3C7A4E', Olive: '#7A7A45', Multicolor: '',
}
export const MULTI_SWATCH = 'conic-gradient(from 90deg, #B22222, #E3C245, #3C7A4E, #3A5FA8, #6B4A8A, #B22222)'

// Neutral fallback dot for off-palette (custom) color names that aren't in COLOR_SWATCH.
export const CUSTOM_SWATCH = '#C9C4BC'

/** Title-case a free-typed custom color name so "hot pink" stores as "Hot Pink". */
export function normalizeColorName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

/** Effective color set for an item: primary color_family first, then any additional
 *  color_families, de-duplicated. Empty strings/nulls dropped. */
export function colorsOf(item: { color_family?: string | null; color_families?: string[] | null }): string[] {
  const all = [item.color_family ?? '', ...(item.color_families ?? [])]
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of all) {
    const v = (c ?? '').trim()
    if (v && !seen.has(v)) { seen.add(v); out.push(v) }
  }
  return out
}
