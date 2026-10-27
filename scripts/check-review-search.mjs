#!/usr/bin/env node
/**
 * SEARCH THE PIECES WAITING IN NEEDS REVIEW, ON BOTH LISTS, OUT OF ALL OF THEM.
 *
 * Paige Berndt, 2026-10-26, Barbie: "Currently for Barbie I have to scroll through over 1,000 pieces
 * to find items for the looks she's wearing." Barbie had 1,338 pieces waiting. She asked to search
 * by brand, color and style ("Chanel", "black", "blazer"), approve the match, and style with it.
 *
 * WHAT IS GUARDED
 *
 *   1. ONE RULE. Needs Review searches through the shared matcher (pieceSearch, ADR-0151), and every
 *      word typed must be found: "black blazer" is narrower than "black".
 *   2. BOTH LISTS. The camera pick screen (the sidebar rows the frame reports) and the older upload
 *      cards each go through searchReview in IntakeInbox.
 *   3. THE CAMERA ROWS CARRY WHAT SHE SEARCHES. The light index the frame reads holds every waiting
 *      piece; it must send brand, color and type, and the frame must pass them to the sidebar,
 *      or "black" can only ever find a piece whose title says black.
 *   4. OUT OF ALL OF THEM. The upload cards read page by page, so a client past 1,000 waiting
 *      pieces is searched in full (Supabase answers at most 1,000 rows a time).
 *
 * Exits non-zero on failure and on inspecting nothing (ADR-0106).
 */
import { readFileSync, existsSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
// REVIEW_SEARCH_DASHBOARD: the dashboard checkout, when it is not beside this one.
const DASH = process.env.REVIEW_SEARCH_DASHBOARD
  ? process.env.REVIEW_SEARCH_DASHBOARD.replace(/\/?$/, '/')
  : `${ROOT}../wsg-dashboard/`
const problems = []
const fail = (m) => { problems.push(m); console.error(`   ❌ ${m}`) }
let checks = 0
let ran = 0

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : (fail(`${path.replace(ROOT, '')}: file not found`), ''))

// ── the rule itself ──────────────────────────────────────────────────────────────────────────
const LIB = `${ROOT}src/lib/reviewSearch.ts`
let RS = null
if (existsSync(LIB)) RS = await import(LIB)
else fail('src/lib/reviewSearch.ts: there is no search for the pieces in Needs Review, only the client picker')

if (RS) {
  const { searchReview, intakeSearchFields, capSearchFields } = RS
  const card = (o) => ({ extracted_name: null, extracted_brand: null, extracted_color: null, extracted_color_family: null, extracted_color_families: null, extracted_category: null, extracted_material: null, extracted_metadata: null, ...o })
  const CARDS = [
    card({ id: 'a', extracted_name: 'Boucle Tweed Blazer', extracted_brand: 'Chanel', extracted_color_family: 'Black', extracted_category: 'jackets' }),
    card({ id: 'b', extracted_name: 'Silk Blouse', extracted_brand: 'Chanel', extracted_color_family: 'White', extracted_category: 'tops' }),
    card({ id: 'c', extracted_name: 'Wool Single Breasted Jacket', extracted_brand: 'Saint Laurent', extracted_color_family: 'Black', extracted_category: 'blazers' }),
    card({ id: 'd', extracted_name: 'Leather Ankle Boot', extracted_brand: 'Gianvito Rossi', extracted_color: 'black', extracted_category: 'shoes' }),
    card({ id: 'e', extracted_name: 'Pleated Midi Skirt', extracted_brand: 'Prada', extracted_color_family: 'Navy', extracted_color_families: ['Black'], extracted_category: 'skirts' }),
    card({ id: 'f', extracted_name: 'Cashmere Crewneck', extracted_brand: 'Loro Piana', extracted_color_family: 'Beige', extracted_category: 'sweaters', extracted_metadata: { description: 'Relaxed fit, ribbed hem' } }),
    // A red shoe whose description mentions a black tip is not a black piece (the judge, 2026-10-27: 78 of
    // Barbie's 450 "black" results were red, burgundy, white or silver pieces with a black detail).
    card({ id: 'g', extracted_name: 'Patent Slingback', extracted_brand: 'Prada', extracted_color_family: 'Red', extracted_category: 'shoes', extracted_metadata: { description: 'Red patent slingback with a black tip and gold buckle' } }),
  ]
  const ids = (xs) => (xs ?? []).map((x) => x.id).sort().join(',')
  for (const [q, want] of [
    ['black', 'a,c,d,e'], // the color chip, the second color, and the color text
    ['chanel', 'a,b'],
    ['blazer', 'a,c'], // the name, and the type
    ['black blazer', 'a,c'], // two words narrow it
    ['chanel blazer', 'a'],
    ['black chanel', 'a'],
    ['ribbed', 'f'], // the description
    ['gold', ''], // a color word only finds pieces of that color, never a detail in the description
    ['red', 'g'],
    ['prada black', 'e'],
    ['', 'a,b,c,d,e,f,g'], // nothing typed is no filter
    ['zebra', ''],
  ]) {
    ran++
    const got = ids(searchReview(CARDS, q, intakeSearchFields))
    if (got !== want) fail(`upload cards, "${q}": expected ${want || 'nothing'}, got ${got || 'nothing'}`)
  }
  // The camera rows: what the frame reports to the sidebar. `find` is every captured detail as one text (Karl, 2026-10-27:
  // "search by every captured detail", e.g. size 8); `facets` is the piece's own brand, colors and type, for the color rule.
  const ROWS = [
    { id: '1', title: 'Boucle Tweed Blazer', sub: 'Barbie · Chanel', find: 'boucle tweed blazer chanel black jackets blazers size 38', facets: { brand: 'Chanel', colors: ['Black'], category: 'Jackets', subcategory: 'Blazers' } },
    { id: '2', title: 'Silk Blouse', sub: 'Barbie · Chanel', find: 'silk blouse chanel ivory tops size 8', facets: { brand: 'Chanel', colors: ['Ivory'], category: 'Tops', subcategory: '' } },
    { id: '3', title: 'Leather Belt', sub: 'Barbie · Hermès', find: 'leather belt hermès black gold accessories belts', facets: { brand: 'Hermès', colors: ['Black', 'Gold'], category: 'Accessories', subcategory: 'Belts' } },
    { id: '4', title: 'Piece', sub: 'Barbie' }, // a row from a frame that sends nothing extra still searches its title
    // No subcategory, but the photos read it as a blazer (the garment type).
    { id: '5', title: 'Wool Jacket', sub: 'Barbie · Saint Laurent', find: 'wool jacket saint laurent navy jackets', facets: { brand: 'Saint Laurent', colors: ['Navy'], category: 'Jackets', subcategory: null, garment_type: 'Blazer' } },
    // Details not confirmed yet: no captured text, and the facets carry what the photos read.
    { id: '6', title: 'Piece', sub: 'Barbie', find: '', facets: { name: 'Cropped Tweed Jacket', brand: 'Chanel', colors: ['Black'], category: null, subcategory: null, garment_type: null } },
    { id: '7', title: 'Silk Scarf', sub: 'Barbie · Hermès' }, // an older frame: title only, never the client's name
    // Barbie's real pieces: a burgundy pump with a black top-lift, and a burgundy dress with black lace trim.
    { id: '8', title: 'Burgundy Patent Leather Pointed-Toe Stiletto Pump', sub: 'Barbie · Saint Laurent', find: 'burgundy patent leather pointed toe stiletto pump saint laurent shoes pumps glossy with a black top lift', facets: { brand: 'Saint Laurent', colors: ['Burgundy'], category: 'Shoes', subcategory: 'Pumps' } },
    { id: '9', title: 'Burgundy Black Eyelash-Lace Trim Halter Maxi Dress', sub: 'Barbie', find: 'burgundy black eyelash lace trim halter maxi dress self portrait dresses', facets: { brand: 'Self-Portrait', colors: ['Burgundy'], category: 'Dresses', subcategory: 'Maxi' } },
  ]
  for (const [q, want] of [
    ['black', '1,3,6'], // only pieces whose color is black: not the burgundy pump or dress with a black detail
    ['burgundy', '8,9'],
    ['lace', '9'], // a style word still reads every captured detail
    ['glossy', '8'],
    ['chanel', '1,2,6'],
    ['blazer', '1,5'],
    ['black blazer', '1'],
    ['hermes', '3'],
    ['tweed', '1,6'],
    ['silk', '2,7'],
    ['size 8', '2'], // the hint in the box: any captured detail, not a size 38
    ['black silk', ''],
    ['barbie', ''], // the client's name in the subtitle is not a piece word
    ['scarf', '7'],
    ['', '1,2,3,4,5,6,7,8,9'],
  ]) {
    ran++
    const got = ids(searchReview(ROWS, q, capSearchFields))
    if (got !== want) fail(`camera rows, "${q}": expected ${want || 'nothing'}, got ${got || 'nothing'}`)
  }
}

// ── the surfaces ─────────────────────────────────────────────────────────────────────────────
const INBOX = read(`${ROOT}src/components/intake/IntakeInbox.tsx`)
checks++
if (!/searchReview\(cap\.items, pieceQ, capSearchFields\)/.test(INBOX)) fail('IntakeInbox.tsx: the camera pick list in the sidebar is not searched')
checks++
if (!/searchReview\(items, pieceQ, intakeSearchFields\)/.test(INBOX)) fail('IntakeInbox.tsx: the upload cards are not searched')
checks++
if (!/aria-label="Search pieces"/.test(INBOX)) fail('IntakeInbox.tsx: no search box for pieces in Needs Review')
// One box (Karl's camera search of 2026-10-27 and Paige's search are the same box): a second one would give her two.
checks++
if ((INBOX.match(/aria-label="Search pieces"/g) ?? []).length !== 1 || /setCapSearch|searchOk\(/.test(INBOX)) fail('IntakeInbox.tsx: Needs Review has more than one piece search box')
// A ticked card the search hides must not be approved or rejected with the ones she can see.
const setQ = INBOX.match(/const searchFor = \(v: string\) => \{([^}]*)\}/)
checks++
if (!setQ || !/setSelectedIds\(new Set\(\)\)/.test(setQ[1]) || !/setPieceQ\(v\)/.test(setQ[1])) fail('IntakeInbox.tsx: changing the search keeps the ticked cards, so bulk Approve or Reject acts on pieces the search hides')
checks++
if (/setPieceQ\((e\.target\.value|'')\)/.test(INBOX) || !/onChange=\{\(e\) => searchFor\(e\.target\.value\)\}/.test(INBOX) || !/onClick=\{\(\) => searchFor\(''\)\}/.test(INBOX)) fail('IntakeInbox.tsx: the search box or its Clear button changes the search without clearing the ticked cards')
// Picking another client clears the search, so her list does not open filtered by the last client's word.
checks++
if (!/useEffect\(\(\) => \{ searchFor\(''\) \}, \[selectedClientId\]\)/.test(INBOX)) fail('IntakeInbox.tsx: the search stays when she picks another client, so that client opens as "No pieces match"')
// No match: the pick screen must not keep showing the last piece and its Approve button.
checks++
if (!/noCamMatch/.test(INBOX) || !/className=\{`flex-1 overflow-y-auto\$\{noCamMatch \? ' hidden' : ''\}`\}/.test(INBOX)) fail('IntakeInbox.tsx: a camera search with no match still shows the last open piece and its Approve button')

const HOOK = read(`${ROOT}src/hooks/useIntakeItems.ts`)
checks++
if (!/\.range\(from, from \+ 999\)/.test(HOOK)) fail('useIntakeItems.ts: the upload cards stop at 1,000 rows, so a search misses every piece past them')

if (existsSync(DASH)) {
  const IMAGES = read(`${DASH}src/app/api/capture/images/route.ts`)
  checks++
  if (!/find: findText\(r\.confirmed\), facets: facetsOf\(r, c\)/.test(IMAGES) || !/name: s\(c\.title\)/.test(IMAGES) || !/garment_type: s\(c\.garment_type\)/.test(IMAGES)) fail('wsg-dashboard api/capture/images: the camera index does not send every captured detail plus the name, brand, colors and type (with the garment type) to search')
  checks++
  if (!/g_color:result->garment->>color_family/.test(IMAGES) || !/g_type:result->garment->>garment_type/.test(IMAGES)) fail('wsg-dashboard api/capture/images: a piece whose details are not confirmed yet sends no color or type, so "black" cannot find it')
  const REVIEW = read(`${DASH}src/components/dashboard/capture-review.tsx`)
  checks++
  if (!/find: i\.find, facets: i\.facets/.test(REVIEW)) fail('wsg-dashboard capture-review.tsx: the frame does not pass the search fields to the sidebar')
} else {
  console.log('   wsg-dashboard not beside this checkout, the camera index not inspected')
}

console.log(`   rules: ${ran} case(s) run, source: ${checks} check(s)`)
if (problems.length) { console.error(`\n❌ review-search: ${problems.length} failure(s).\n`); process.exit(1) }
if (checks === 0) { console.error('\n❌ review-search: inspected nothing.\n'); process.exit(1) }
console.log('\n✅ review-search: Needs Review searches every waiting piece by brand, color and type, on both lists.\n')
