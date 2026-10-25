// Search and filters for Needs Review > Uploads (Paige, 2026-10-22: "search by brand, color, category, etc."). The camera's pieces are searched in
// the dashboard frame; these are the pieces from the Upload panel. The filters go into the database query, so a piece the screen has not loaded is found.

export type UploadSearch = { q: string; brand: string; color: string; category: string }
export const NO_UPLOAD_SEARCH: UploadSearch = { q: '', brand: '', color: '', category: '' }

// Commas, brackets, quotes, colons, stars and backslashes would change the meaning of the query's filter text, so typed words drop them.
const tidy = (v: string) => v.replace(/[,()"':*\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
// A menu value is matched exactly (ignoring case): a % or _ in it is a plain character, not a wildcard.
const exact = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`)

export const isSearching = (s: UploadSearch | null | undefined) => !!s && !!(tidy(s.q) || s.brand.trim() || s.color.trim() || s.category.trim())

type Filterable<Q> = { ilike: (column: string, pattern: string) => Q; or: (filters: string) => Q }

/** The search added to a Supabase query on intake_items. Every part must match; the words match the name, brand, category or color. */
export function applyUploadSearch<Q extends Filterable<Q>>(query: Q, s: UploadSearch): Q {
  let q = query
  if (s.brand.trim()) q = q.ilike('extracted_brand', exact(s.brand.trim()))
  if (s.category.trim()) q = q.ilike('extracted_category', exact(s.category.trim()))
  const groups: string[] = []
  const words = tidy(s.q)
  if (words) groups.push(['extracted_name', 'extracted_brand', 'extracted_category', 'extracted_color_family'].map((c) => `${c}.ilike.*${words}*`).join(','))
  const color = tidy(s.color)
  if (color) groups.push(`extracted_color_family.ilike.${color},extracted_color_families.cs.{${color}}`)
  // One "or" with both inside an "and", so the words AND the color must match.
  if (groups.length === 1) q = q.or(groups[0])
  else if (groups.length > 1) q = q.or(`and(${groups.map((g) => `or(${g})`).join(',')})`)
  return q
}

type FacetRow = { extracted_brand: string | null; extracted_category: string | null; extracted_color_family: string | null; extracted_color_families: string[] | null }

/** The brands, colors and categories in the Uploads list, for the menus, so each choice returns at least one piece. */
export function uploadFacets(rows: FacetRow[]): { brands: string[]; colors: string[]; categories: string[] } {
  const sets = { brands: new Map<string, string>(), colors: new Map<string, string>(), categories: new Map<string, string>() }
  const add = (m: Map<string, string>, v: string | null | undefined) => { const t = (v ?? '').trim(); if (t && !m.has(t.toLowerCase())) m.set(t.toLowerCase(), t) }
  for (const r of rows) {
    add(sets.brands, r.extracted_brand); add(sets.categories, r.extracted_category)
    add(sets.colors, r.extracted_color_family); for (const c of r.extracted_color_families ?? []) add(sets.colors, c)
  }
  const sorted = (m: Map<string, string>) => [...m.values()].sort((a, b) => a.localeCompare(b))
  return { brands: sorted(sets.brands), colors: sorted(sets.colors), categories: sorted(sets.categories) }
}
