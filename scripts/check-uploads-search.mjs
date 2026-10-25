#!/usr/bin/env node
/**
 * Needs Review search guard (Paige, 2026-10-22: "a search/filter feature for all items awaiting approval ... by brand, color, category").
 * The camera's pieces are searched inside the dashboard frame; this covers the other source, Needs Review > Uploads. The search must run in the
 * database query (so it finds pieces the screen has not loaded), combine with the client picker, and every menu choice must return a piece.
 * Exits non-zero on a break AND on inspecting nothing.
 */
import { readFileSync } from 'node:fs'
import { applyUploadSearch, uploadFacets, isSearching } from '../src/lib/uploadSearch.ts'

const failures = []
let checked = 0
const is = (name, got, want) => { checked++; const a = JSON.stringify(got), b = JSON.stringify(want); if (a !== b) failures.push(`${name}: expected ${b}, got ${a}`) }

// A stand-in query that records the filters it is given, the way Supabase's builder takes them.
const recorder = () => { const calls = []; const q = { ilike: (c, v) => { calls.push(['ilike', c, v]); return q }, or: (v) => { calls.push(['or', v]); return q }, calls }; return q }

is('no search adds no filter', applyUploadSearch(recorder(), { q: '', brand: '', color: '', category: '' }).calls, [])
is('no search is not searching', isSearching({ q: ' ', brand: '', color: '', category: '' }), false)
is('a brand is matched exactly, ignoring case, in the query', applyUploadSearch(recorder(), { q: '', brand: 'Khaite', color: '', category: '' }).calls, [['ilike', 'extracted_brand', 'Khaite']])
is('a category likewise', applyUploadSearch(recorder(), { q: '', brand: '', color: '', category: 'Knitwear' }).calls, [['ilike', 'extracted_category', 'Knitwear']])
is('a color matches the main color or one of the others', applyUploadSearch(recorder(), { q: '', brand: '', color: 'Blue', category: '' }).calls, [['or', 'extracted_color_family.ilike.Blue,extracted_color_families.cs.{Blue}']])
is('typed words search name, brand, category and color', applyUploadSearch(recorder(), { q: 'silk', brand: '', color: '', category: '' }).calls,
  [['or', 'extracted_name.ilike.*silk*,extracted_brand.ilike.*silk*,extracted_category.ilike.*silk*,extracted_color_family.ilike.*silk*']])
is('words and a color combine: both must match (one or, nested)', applyUploadSearch(recorder(), { q: 'silk', brand: '', color: 'Blue', category: '' }).calls,
  [['or', 'and(or(extracted_name.ilike.*silk*,extracted_brand.ilike.*silk*,extracted_category.ilike.*silk*,extracted_color_family.ilike.*silk*),or(extracted_color_family.ilike.Blue,extracted_color_families.cs.{Blue}))']])
is('characters that would break the query are dropped; a % or _ in a brand is literal', applyUploadSearch(recorder(), { q: 'a,b(c)', brand: '100%_x', color: '', category: '' }).calls,
  [['ilike', 'extracted_brand', '100\\%\\_x'], ['or', 'extracted_name.ilike.*abc*,extracted_brand.ilike.*abc*,extracted_category.ilike.*abc*,extracted_color_family.ilike.*abc*']])

const rows = [
  { extracted_brand: 'Khaite', extracted_category: 'Knitwear', extracted_color_family: 'Cream', extracted_color_families: ['Brown'] },
  { extracted_brand: 'khaite', extracted_category: 'Tops', extracted_color_family: null, extracted_color_families: null },
  { extracted_brand: null, extracted_category: '', extracted_color_family: 'Black', extracted_color_families: [] },
]
is('menus list what the Uploads list holds, once each', uploadFacets(rows), { brands: ['Khaite'], colors: ['Black', 'Brown', 'Cream'], categories: ['Knitwear', 'Tops'] })

const hook = readFileSync(new URL('../src/hooks/useIntakeItems.ts', import.meta.url), 'utf8')
const inbox = readFileSync(new URL('../src/components/intake/IntakeInbox.tsx', import.meta.url), 'utf8')
for (const [file, src, what, re] of [
  ['useIntakeItems.ts', hook, 'the search goes into the database query, Needs Review only', /if \(filter === 'pending_review' && search\) query = applyUploadSearch\(query, search\)/],
  ['useIntakeItems.ts', hook, 'the menus come from the unsearched list', /if \(filter === 'pending_review' && !isSearching\(search\)\) setFacets\(uploadFacets\(items\)\)/],
  ['IntakeInbox.tsx', inbox, 'the hook gets the search with the client', /useIntakeItems\(hookFilter, selectedClientId, filter === 'pending_review' \? uploadSearch : null\)/],
  ['IntakeInbox.tsx', inbox, 'a search box at the top of Uploads', /aria-label="Search uploaded pieces waiting for approval"/],
  ['IntakeInbox.tsx', inbox, 'brand, color and category menus', /\['brand', 'Brand', 'All brands', facets\.brands\], \['color', 'Color', 'All colors', facets\.colors\], \['category', 'Category', 'All categories', facets\.categories\]/],
  ['IntakeInbox.tsx', inbox, 'an empty search says so', /No uploaded piece waiting for approval matches this search\./],
]) { checked++; if (!re.test(src)) failures.push(`${file}: ${what} is missing`) }

if (checked === 0) { console.error('check-uploads-search: inspected nothing'); process.exit(1) }
if (failures.length) { console.error('check-uploads-search FAILED:\n  ' + failures.join('\n  ')); process.exit(1) }
console.log(`check-uploads-search OK (${checked} checks)`)
