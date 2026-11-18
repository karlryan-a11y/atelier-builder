/**
 * Common care instructions, one tap each (same list as the client's sheet in atelier-looks). Edit Item
 * and Add Item share it (Cynthia Dada, 2026-11-18: "include the capability to add fabric notes and
 * washing/care instructions" when adding a piece), so the two windows can never offer different chips.
 */
export const CARE_CHIPS = ['Dry clean only', 'Hand wash cold', 'Machine wash cold', 'Lay flat to dry', 'Do not tumble dry', 'Steam, do not iron', 'Hand press only', 'Specialist clean']

/** The care text with one chip's instruction added to the end, once. */
export function addCare(cur: string, add: string): string {
  const t = cur.trim()
  if (t.toLowerCase().includes(add.toLowerCase())) return cur
  return t ? (/[.!?]$/.test(t) ? t + ' ' : t + '. ') + add + '.' : add + '.'
}
