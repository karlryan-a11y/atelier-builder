#!/usr/bin/env node
/**
 * ADR-0151. ONE SEARCH, ONE RULE, EVERY SURFACE — AND A DESCRIPTION SHE CAN READ.
 *
 * Maegan Watson, 2026-09-24: "There's a major issue with search in the closet. I'm searching for
 * items and then not finding them ... everything that should be populating with search criteria
 * is not." And: "Also under item details there's no spot to put a description of the items ... we
 * have to be able to search houndstooth and the dress shows up." Asked whether the description
 * was for the team or the client: "Both".
 *
 * Reproduced live before any of this was written, on the exact dress she and Cynthia lost:
 *     "margaret satin sheath"      -> 1   Floral Margaret Satin Sheath Belted Shirt Dress
 *     "margaret satin sheath midi" -> 0
 * One word of four missing, and the page said nothing was there. Cynthia added it again;
 * `9a5230f2-…` "Margaret Satin Sheath Midi Shirt Dress" was created that morning, a duplicate of
 * a row from November 2024.
 *
 * WHAT IS GUARDED
 *
 *   1. THE MATCHER IS SHARED, BYTE FOR BYTE. The builder and the lookbook are separate
 *      deployments. If the rule drifts, "search" means two different things depending which
 *      screen she is on, which is the bug this replaces. Compared directly when both checkouts
 *      are on the machine.
 *   2. NOBODY SEARCHES ON THEIR OWN ANY MORE. Five surfaces had five field lists and two
 *      matching rules. Each must now go through searchPieces/matchPiece.
 *   3. THE CLIENT NEVER SEARCHES THE INTERNAL NOTE. A stylist writes things that are true and
 *      unkind; if `style_note` fed her search, typing a word from it would surface the piece.
 *   4. THE FIELDS. Name, rename, brand, colour, description, categories and tags are all in the
 *      token set, or "everything is searchable" is a sentence rather than a behaviour.
 *   5. NEVER "NOTHING" WHEN SOMETHING IS ONE WORD AWAY, and a near miss is never folded silently
 *      into the results as though it matched.
 *   6. THE DESCRIPTION IS CLIENT-VISIBLE AND THE INTERNAL NOTE IS NOT, said on screen, on both
 *      dialogs — the caption pair is the only thing stopping the wrong text going in the wrong box.
 *
 * Then the rules themselves, over real cases including the Margaret query.
 *
 *
 * ADR-0155 (Maegan, 2026-09-25, Peyton Wheeler: "plaid rosie dress" showed 2 and hid 13; the audit
 * over 88,742 pieces that followed) adds: every possible match shown, closest first, in one list;
 * a colour word reads every colour field and the name; accents fold; filler words drop; synonyms,
 * compounds and one typo; retailer and material searched; a category tap clears the search.
 *
 * Exits non-zero on failure and on inspecting nothing (ADR-0106).
 */
import { readFileSync, existsSync } from 'node:fs'
import * as PS from '../src/lib/pieceSearch.ts'
const { matchPiece, searchPieces, pieceTokens, wordHitsToken } = PS
// Read off the namespace so a matcher that lacks it fails the cases below instead of the import.
const searchInCategory = PS.searchInCategory ?? (() => undefined)

const ROOT = new URL('..', import.meta.url).pathname
// PIECE_SEARCH_SIBLING: the other app's checkout, when it is not the usual folder (a worktree).
const SIBLING = process.env.PIECE_SEARCH_SIBLING
  ? process.env.PIECE_SEARCH_SIBLING.replace(/\/?$/, '/')
  : `${process.env.HOME}/Downloads/atelier-looks/`
const problems = []
const fail = (m) => { problems.push(m); if (problems.length <= 14) console.error(`   ❌ ${m}`) }
let checks = 0

const strip = (s) => s
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
// A missing file is a failure to report, not a crash that hides every other finding.
const read = (rel, root = ROOT) => {
  if (!existsSync(root + rel)) { fail(`${rel}: file not found`); return '' }
  return strip(readFileSync(root + rel, 'utf8'))
}

// ── 1. the matcher is shared, byte for byte ───────────────────────────────────────────────
checks++
const LIB = 'src/lib/pieceSearch.ts'
const mine = readFileSync(ROOT + LIB, 'utf8')
if (existsSync(SIBLING + LIB)) {
  if (readFileSync(SIBLING + LIB, 'utf8') !== mine) {
    fail(`${LIB} differs between atelier-builder and atelier-looks. One rule, or search means two different things depending which screen she is on (ADR-0151).`)
  } else {
    console.log('   matcher: byte-identical in atelier-builder and atelier-looks')
  }
} else {
  console.log('   matcher: atelier-looks not on this machine, drift not compared')
}

// ── 2 + 3 + 4. every surface goes through it, with the right audience ─────────────────────
const SURFACES = [
  ['src/components/layout/ClosetPanel.tsx', 'team', 'the canvas closet rail'],
  ['src/components/categorize/CollectionTab.tsx', 'team', 'the Collection tab'],
]
for (const [rel, audience, what] of SURFACES) {
  const src = read(rel)
  checks++
  if (!/searchPieces\(|searchInCategory\(/.test(src)) {
    fail(`${rel}: ${what} still filters with a search of its own. Five different field lists is why a piece findable on one screen was not findable on another (ADR-0151).`)
  }
  checks++
  if (!new RegExp(`'${audience}'`).test(src)) {
    fail(`${rel}: ${what} does not name its audience as '${audience}'.`)
  }
  checks++
  if (!/closetSearchFields\(/.test(src)) {
    fail(`${rel}: ${what} builds its own search fields instead of closetSearchFields, so a field added to the piece can be searchable on one stylist screen and not another (ADR-0155).`)
  }
  checks++
  if (!/\.ranked/.test(src)) {
    fail(`${rel}: ${what} does not show the ranked list. Every possible match, closest first, in one list (ADR-0155).`)
  }
  checks++
  if (/Nearly/.test(src)) {
    fail(`${rel}: ${what} still splits results under a "Nearly" heading. Karl, 2026-09-28: one list, closest first (ADR-0155).`)
  }
}

// Everything on the piece reaches search, through the one builder of fields.
const FIELDS = 'src/lib/closetSearchFields.ts'
const fieldsSrc = read(FIELDS)
for (const [needle, what] of [
  [/description: item\.description/, 'the description Maegan asked for'],
  [/internalNote: item\.style_note/, 'the internal note (team)'],
  [/colorFamilies:/, 'the colour families'],
  [/color: item\.color/, 'the colour text'],
  [/retailer: item\.retailer/, 'the retailer'],
  [/material: item\.raw\?\.material/, 'the material'],
  [/labelForCategory/, 'the category labels'],
]) {
  checks++
  if (!needle.test(fieldsSrc)) fail(`${FIELDS}: ${what} is not searched on stylist screens (ADR-0155).`)
}
const HOOK = 'src/hooks/useClosetItems.ts'
checks++
if (!/retailer, size, raw_material:raw->>material, raw_description:raw->>description/.test(read(HOOK))) {
  fail(`${HOOK}: the closet read does not select retailer, size and material, so searching them reads undefined for every piece (ADR-0103).`)
}

// A category tap starts a new search, on both stylist screens (Maegan, 2026-09-26).
const RAIL = read('src/components/layout/ClosetPanel.tsx')
checks++
if (!/function toggleCategory\(slug: string\) \{\s*setSearch\(''\)/.test(RAIL)) {
  fail('ClosetPanel.tsx: tapping a category chip keeps the search, so every category she taps is filtered by what she searched before (ADR-0155).')
}
checks++
if (!/onClick=\{\(\) => \{ setSearch\(''\); setActiveCategories\(new Set\(\)\) \}\}/.test(RAIL)) {
  fail('ClosetPanel.tsx: "All" keeps the search (ADR-0155).')
}
checks++
if (!/useEffect\(\(\) => \{ setQ\(''\) \}, \[filterKey\]\)/.test(read('src/components/categorize/CollectionTab.tsx'))) {
  fail('CollectionTab.tsx: choosing a category in the Categorize rail keeps the search (ADR-0155).')
}
// ADR-0163: a category is a filter on both stylist screens, and both apply her category map.
for (const rel of ['src/components/layout/ClosetPanel.tsx', 'src/components/categorize/CollectionTab.tsx']) {
  const src = read(rel)
  checks++
  if (!/searchInCategory\(/.test(src) || /searchInsideThenOutside|In \{homeLabel/.test(src)) {
    fail(`${rel}: a search inside a category shows pieces from other categories. Maegan, 2026-10-02: "it should only pull the Chanel in that category" (ADR-0163).`)
  }
  checks++
  if (!/categoriesOf\(i, tagNames, categoryTree\)/.test(src) || !/useClientCategories\(/.test(src)) {
    fail(`${rel}: resolves categories without her category map, so a stylist's Same as / Inside reaches her page and never this screen (ADR-0163).`)
  }
}
const PANEL = read('src/components/categorize/CategorizePanel.tsx')
checks++
if (!/searchPieces\(base\.filter\(\(l\) => !named\.has\(l\.id\)\), search, lookPieceFields, 'team'\)\.full/.test(PANEL)) {
  fail('CategorizePanel.tsx: the Looks list cannot find a look by a piece in it, which her Looks page can (ADR-0163).')
}
// The map itself: the panel, the save, and the stored column it writes.
checks++
if (!/<CategoryMapPanel/.test(read('src/components/categorize/NestingTab.tsx'))) fail('NestingTab.tsx: the Category map is not on the screen stylists use to set it (ADR-0163).')
checks++
if (!/same_as: as, group_label: null/.test(read('src/hooks/useClientCategories.ts'))) fail('useClientCategories.ts: Same as is not saved, or does not clear Inside when it is (ADR-0163).')
checks++
if (!/select\('slug, label, group_label, sort_order, same_as'\)/.test(read('src/hooks/useClientCategories.ts'))) fail('useClientCategories.ts: same_as is not read, so the map is saved and then ignored (ADR-0103).')
// The capsule's "add looks" box searched the whole phrase; it uses the Looks list's rule now.
checks++
if (!/searchByName\(addable, q\)/.test(read('src/components/canvas/AddLooksDialog.tsx'))) {
  fail('AddLooksDialog.tsx: the add-looks box matches the whole phrase, so "fall plaid" misses "Plaid Fall" (ADR-0155).')
}

// ── 5 + 6. the two boxes, and what each says about itself ─────────────────────────────────
for (const rel of ['src/components/layout/EditItemDialog.tsx', 'src/components/layout/AddItemDialog.tsx']) {
  const src = read(rel)
  checks++
  if (!/Description/.test(src)) fail(`${rel}: no Description field. This is the field Maegan asked for.`)
  checks++
  if (!/Shown to the client/i.test(src)) {
    fail(`${rel}: the Description does not say it is shown to the client, so nothing on screen distinguishes it from the internal note (ADR-0151).`)
  }
  checks++
  if (!/Team only/i.test(src)) {
    fail(`${rel}: the internal note no longer says it is team only. The caption PAIR is the only thing keeping the wrong text out of the box the client reads.`)
  }
  checks++
  if (!/description: description\.trim\(\) \|\| null|description,/.test(src)) {
    fail(`${rel}: the description is never saved.`)
  }
}

// The look's note to her — the same pattern, on a column that has existed and been empty forever.
const SAVE = 'src/components/canvas/SaveLookDialog.tsx'
const save = read(SAVE)
checks++
if (!/Note for her/.test(save)) fail(`${SAVE}: a look still has no client-facing note. gp_looks.notes_client exists on 15,785 live looks and is filled on 0 (ADR-0151).`)
checks++
if (!/clientNote/.test(save)) fail(`${SAVE}: the client note is not carried out of the dialog.`)
const CHAT = 'src/components/layout/ChatPanel.tsx'
checks++
if (!/notesClient: data\.clientNote/.test(read(CHAT))) fail(`${CHAT}: the look's client note is never saved.`)

console.log(`   source: ${checks} rule(s) checked`)

// ── the rules themselves ──────────────────────────────────────────────────────────────────
const MARGARET = {
  name: 'Floral Margaret Satin Sheath Belted Shirt Dress',
  brand: 'Lena Hoschek', color: 'whiskey',
  description: null, internalNote: 'she hates the neckline, keep for resale',
  categories: ['dresses', 'Dresses'], tags: ['dress'],
}
const HOUNDSTOOTH = {
  name: 'Longsleeve Squareneck Ruffle Hem Prayer Book Dress',
  brand: 'Lena Hoschek', color: 'whiskey',
  description: 'Whiskey houndstooth wool, three-quarter sleeve, ruffled hem at mid-calf',
  categories: ['dresses', 'Dresses'], tags: ['dress'],
}

const CASES = [
  // [fields, query, audience, expect]  expect: 'full' | 'near' | 'miss'
  [MARGARET, 'margaret satin sheath', 'client', 'full'],
  [MARGARET, 'margaret satin sheath midi', 'client', 'near'],   // THE INCIDENT
  // 4 of 5: "shirt" IS in "Belted Shirt Dress", so this is a near miss and not a miss.
  [MARGARET, 'margaret satin sheath midi shirt', 'client', 'near'],
  [MARGARET, 'margaret satin sheath midi shirt zebra', 'client', 'miss'],
  [MARGARET, '', 'client', 'full'],
  [MARGARET, '   ', 'client', 'full'],
  // the description is searched, by BOTH
  [HOUNDSTOOTH, 'houndstooth', 'client', 'full'],
  [HOUNDSTOOTH, 'houndstooth', 'team', 'full'],
  [HOUNDSTOOTH, 'lena houndstooth', 'client', 'full'],
  [HOUNDSTOOTH, 'mid-calf', 'client', 'full'],
  // the internal note is the team's alone
  [MARGARET, 'resale', 'team', 'full'],
  [MARGARET, 'resale', 'client', 'miss'],
  [MARGARET, 'hates', 'client', 'miss'],
  [MARGARET, 'neckline', 'client', 'miss'],
  // plurals and tenses, both directions
  [MARGARET, 'dresses', 'client', 'full'],
  [MARGARET, 'dress', 'client', 'full'],
  [{ name: 'Suede Boot' }, 'boots', 'client', 'full'],
  [{ name: 'Suede Boots' }, 'boot', 'client', 'full'],
  [{ name: 'Blue Stripe Shirt' }, 'striped', 'client', 'full'],
  // brand, colour, category and tag all still count
  [MARGARET, 'lena hoschek', 'client', 'full'],
  [MARGARET, 'whiskey', 'client', 'full'],
  [MARGARET, 'dresses lena', 'client', 'full'],
  // ADR-0155: on a TWO word search, one word found is IN the results (ranked below both words)
  [MARGARET, 'lena houndstooth', 'client', 'near'],
  [MARGARET, 'zebra', 'client', 'miss'],
  // a short token must not swallow a long query
  [{ name: 'Fran Skirt' }, 'france', 'client', 'miss'],

  // ── ADR-0155, every one measured on live data before it was written ──
  // A colour word reads the NAME and the colour text, not only the families (13,831 of 20,018
  // black pieces had no family and never came up for "black").
  [{ name: 'Black Leather Knee Boot', colorFamilies: [] }, 'black', 'client', 'full'],
  [{ name: 'Silk Blouse', color: 'Blue, Red, Plaid' }, 'plaid', 'client', 'full'],
  [{ name: 'Silk Blouse', colorFamilies: ['Navy'] }, 'navy', 'client', 'full'],
  // accents fold (537 pieces: Chloé, Hermès, Larroudé, Alaïa ...)
  [{ name: 'Cleia Heeled Sandal', brand: 'Chloé' }, 'chloe', 'client', 'full'],
  [{ name: 'Kelly Bag', brand: 'Hermès' }, 'hermes', 'client', 'full'],
  [{ name: 'Cleia Heeled Sandal', brand: 'Chloe' }, 'chloé', 'client', 'full'],
  // filler words are not words she needs the piece to contain
  [{ name: 'Black Bow Mini Dress' }, 'black dress with bow', 'client', 'full'],
  // synonyms: the plaid family, tee / t-shirt, pants / trousers
  [{ name: 'Sleeveless Belted Checkered Cotton Dress', brand: 'Rosie Assoulin' }, 'plaid rosie dress', 'client', 'full'],
  [{ name: 'Gingham Midi Skirt' }, 'plaid', 'client', 'full'],
  [{ name: 'Tartan Wool Scarf' }, 'check', 'client', 'full'],
  [{ name: 'Classic Crew T-Shirt' }, 'tee', 'client', 'full'],
  [{ name: 'Pima Cotton Tee' }, 't-shirt', 'client', 'full'],
  [{ name: 'Wool Trousers' }, 'pants', 'client', 'full'],
  // a garment word finds the compound it ends; an open suffix rule would not be safe
  [{ name: 'Midi Plaid Shirtdress' }, 'dress', 'client', 'full'],
  [{ name: 'Leather Handbag' }, 'bag', 'client', 'full'],
  [{ name: 'Cashmere Turtleneck' }, 'neck', 'client', 'full'],
  [{ name: 'Gold Hoop Earring' }, 'ring', 'client', 'miss'],
  // one typo on a long word, graded alone
  [{ name: 'Houndstooth Check Midi Skirt' }, 'houndstoth', 'client', 'full'],
  [{ name: 'Red Dress' }, 'rde', 'client', 'miss'],
  // retailer and material are hers to search; size and the old GoodPix blurb are the team's
  [{ name: 'Slip Dress', retailer: 'Net-a-Porter' }, 'net a porter', 'client', 'full'],
  [{ name: 'Slip Dress', material: '100% Silk' }, 'silk', 'client', 'full'],
  [{ name: 'Slip Dress', size: 'XS' }, 'xs', 'client', 'miss'],
  [{ name: 'Slip Dress', size: 'XS' }, 'xs', 'team', 'full'],
  [{ name: 'Slip Dress', legacyDescription: 'Members receive free shipping' }, 'shipping', 'client', 'miss'],
  [{ name: 'Slip Dress', legacyDescription: 'Members receive free shipping' }, 'shipping', 'team', 'full'],
]

let ran = 0
for (const [f, q, audience, expect] of CASES) {
  ran++
  const m = matchPiece(f, q, audience)
  const got = m.full ? 'full' : m.near ? 'near' : 'miss'
  if (got !== expect) fail(`"${q}" (${audience}) on "${(f.name ?? '').slice(0, 40)}": expected ${expect}, got ${got} (${m.matched}/${m.total})`)
}

// the audience split, said once more as a property rather than a list of cases
ran++
if (pieceTokens(MARGARET, 'client').includes('resale')) fail('the client token set contains a word from the internal note')
ran++
if (!pieceTokens(MARGARET, 'team').includes('resale')) fail('the team token set is missing the internal note')
ran++
if (!wordHitsToken('dress', 'dresses') || !wordHitsToken('dresses', 'dress')) fail('plural matching is one-directional')
ran++
if (wordHitsToken('france', 'fran')) fail('a 4-character token swallowed a longer query')

const names = (xs) => (xs ?? []).map((x) => x.name).join(' / ')
// an empty query filters nothing and reorders nothing
ran++
const list = [{ name: 'A Dress' }, { name: 'B Dress' }, { name: 'C Dress' }]
if (names(searchPieces(list, 'dress', (x) => x, 'client').ranked) !== 'A Dress / B Dress / C Dress') fail('equally good matches were re-ordered; ties must keep her wardrobe order')
ran++
if ((searchPieces(list, '', (x) => x, 'client').ranked ?? []).length !== 3) fail('an empty query filtered the list')

// THE PEYTON WHEELER CASE, 2026-09-25: "plaid rosie dress" in Dresses. The page showed 2 and hid
// the rest. Every possible match now shows, closest first, in ONE list.
ran++
const PEYTON = [
  { name: 'Cotton Halter Gown with Asymmetric Hem', brand: 'Rosie Assoulin', categories: ['dresses'] },
  { name: 'Longsleeve Belted Plaid Dress', brand: 'Lena Hoschek', categories: ['dresses'] },
  { name: 'Plaid Print Halter Cotton Long Dress', brand: 'Rosie Assoulin', categories: ['dresses'] },
  { name: 'Floral Wrap Dress', brand: 'Dior', categories: ['dresses'] },
  { name: 'Sleeveless Belted Checkered Cotton Dress', brand: 'Rosie Assoulin', categories: ['dresses'] },
  { name: 'Midi Plaid Shirtdress', brand: 'Rosie Assoulin', categories: ['dresses'] },
]
const peyton = searchPieces(PEYTON, 'plaid rosie dress', (x) => x, 'client')
const top3 = new Set((peyton.ranked ?? []).slice(0, 3).map((x) => x.name))
if (!top3.has('Plaid Print Halter Cotton Long Dress') || !top3.has('Midi Plaid Shirtdress') || !top3.has('Sleeveless Belted Checkered Cotton Dress')) {
  fail(`"plaid rosie dress": the three Rosie Assoulin plaid dresses are not the first three: ${names(peyton.ranked)}`)
}
ran++
if ((peyton.ranked ?? []).length !== 5) fail(`"plaid rosie dress": expected 5 shown (every piece with two of the three words), got ${(peyton.ranked ?? []).length}: ${names(peyton.ranked)}`)
ran++
if ((peyton.ranked ?? []).some((x) => x.name === 'Floral Wrap Dress')) fail('"plaid rosie dress" showed a Dior floral dress: one word of three is not a match')
ran++
if ((peyton.ranked ?? []).at(-1)?.name === 'Longsleeve Belted Plaid Dress' || (peyton.ranked ?? []).at(-1)?.name === 'Cotton Halter Gown with Asymmetric Hem') {
  // both near matches rank below every full match, in either order
} else fail(`"plaid rosie dress": a near match outranked a full match: ${names(peyton.ranked)}`)

// "blue" means the colour before the brand ("Skarlett Blue")
ran++
const blue = searchPieces([{ name: 'Silk Cami', brand: 'Skarlett Blue' }, { name: 'Blue Silk Cami' }], 'blue', (x) => x, 'client').ranked
if ((blue ?? [])[0]?.name !== 'Blue Silk Cami') fail(`"blue" ranked the brand "Skarlett Blue" above a blue piece: ${names(blue)}`)

// a typo is only forgiven when the word finds nothing as typed: "plaid" must not bring in "plain"
ran++
const plaid = searchPieces([{ name: 'Plaid Skirt' }, { name: 'Plain White Tee' }], 'plaid', (x) => x, 'client').ranked
if (names(plaid) !== 'Plaid Skirt') fail(`"plaid" pulled in a typo match although plaid pieces exist: ${names(plaid)}`)
ran++
const typo = searchPieces([{ name: 'Houndstooth Skirt' }, { name: 'Plain White Tee' }], 'houndstoth', (x) => x, 'client').ranked
if (names(typo) !== 'Houndstooth Skirt') fail(`"houndstoth" (one letter off) did not find the houndstooth skirt: ${names(typo)}`)

// ── ADR-0163: a category is a filter, and a search inside it searches that category ──
// Maegan, Danielle York, 2026-10-02: Rings + "chanel" "should only pull the Chanel in that
// category"; Coats + "mcqueen": "it's not just searching coats, that's the 1 issue".
ran++
const DY = [
  { name: 'Premiere Triple Chain Watch', brand: 'Chanel', categories: ['time-pieces'] },
  { name: 'CC Logo Crystal Brooch', brand: 'Chanel', categories: ['brooches'] },
  { name: 'Beaded Ball Stacking Ring', brand: 'Unknown', categories: ['rings'] },
  { name: 'Logo Intarsia Colorblock Knit Cardigan', brand: 'Chanel', categories: ['sweaters', 'tops'] },
  { name: 'Asymmetric Double-Breasted Slim-Fit Wool Coat', brand: 'Alexander McQueen', categories: ['coats', 'outerwear'] },
  { name: 'Cropped Double-breasted Jacket', brand: 'Alexander McQueen', categories: ['jackets', 'outerwear'] },
  { name: 'Skull Print Maxi Dress', brand: 'Alexander McQueen', categories: ['dresses'] },
]
const inCat = (c) => (x) => (x.categories ?? []).includes(c)
const rings = searchInCategory(DY, inCat('rings'), true, 'chanel', (x) => x, 'client')
if ((rings?.ranked ?? ['x']).length !== 0) fail(`Rings + "chanel" showed pieces from other categories: ${names(rings?.ranked)}`)
ran++
if (rings?.elsewhere !== 3) fail(`Rings + "chanel" must count the 3 Chanel pieces elsewhere for the "See all" link, got ${rings?.elsewhere}`)
ran++
const sw = searchInCategory(DY, inCat('sweaters'), true, 'chanel', (x) => x, 'client')
if (names(sw?.ranked) !== 'Logo Intarsia Colorblock Knit Cardigan') fail(`Sweaters + "chanel": expected only the Chanel cardigan, got ${names(sw?.ranked)}`)
ran++
const coats = searchInCategory(DY, inCat('coats'), true, 'mcqueen', (x) => x, 'client')
if (names(coats?.ranked) !== 'Asymmetric Double-Breasted Slim-Fit Wool Coat') fail(`Coats + "mcqueen": expected only the coat, got ${names(coats?.ranked)}`)
ran++
const ow = searchInCategory(DY, inCat('outerwear'), true, 'mcqueen', (x) => x, 'client')
if ((ow?.ranked ?? []).length !== 2) fail(`Outerwear + "mcqueen": a parent holds its sub-categories, expected 2, got ${names(ow?.ranked)}`)
ran++
const browse = searchInCategory(DY, inCat('outerwear'), true, '', (x) => x, 'client')
if ((browse?.ranked ?? []).length !== 2 || browse?.elsewhere !== 0) fail('with nothing typed, a category shows only itself')
ran++
const noCat = searchInCategory(DY, inCat('rings'), false, 'chanel', (x) => x, 'client')
if ((noCat?.ranked ?? []).length !== 3 || noCat?.elsewhere !== 0) fail('All pieces searches everything and has no "elsewhere"')
// A colour the piece IS outranks a colour named in passing in a long AI colour description
// (Danielle York: 465 of 936 pieces carry one).
ran++
const LONG = 'Multi-color tartan: soft dusty sky blue and warm pale straw as dominant ground tones, overlaid with crimson red stripes and black crossing lines, matte finish'
const black = searchPieces([{ name: 'Wool Scarf', color: LONG, colorFamilies: ['Blue'] }, { name: 'Wool Scarf', colorFamilies: ['Black'] }], 'black', (x) => x, 'client').ranked
if ((black ?? [])[0]?.colorFamilies?.[0] !== 'Black') fail('"black": a scarf whose colour chip is Black did not outrank one that only mentions black in a long colour description')
// SHOPPING WORDS (ADR-0163): the broad word finds the specific piece, one way only. Measured misses
// on 2026-10-02: sweater 1,684, heels 1,484, jacket 620, swimsuit 222, coat 164, flats 124,
// necklace 119, sneakers 79, bag 44.
for (const [q, piece, expect] of [
  ['heels', 'Hi Dolly Fabric Pumps With Floral Heel Detail', 'full'],
  ['heels', 'Patent Pointed Toe Pump', 'full'],
  ['heels', 'Ballyrina Slingback in Silver', 'full'],
  ['sweater', 'Cashmere Open Front Cardigan', 'full'],
  ['jacket', 'Linen Blend Blazer', 'full'],
  ['coat', 'Camel Wool Trench', 'full'],
  ['swimsuit', 'Veyra Shell Bikini Top', 'full'],
  ['necklace', 'Gold Medallion Pendant', 'full'],
  ['sneakers', 'High Top Glitter Trainer', 'full'],
  ['bag', 'Shagreen Foldover Clutch', 'full'],
  ['black heels', 'Black Patent Stiletto', 'full'],
  // one way: the specific word never brings back the broad one
  ['pump', 'Block Heel Sandal', 'miss'],
  ['cardigan', 'Crewneck Wool Sweater', 'miss'],
  // left out on purpose: "stud" is also a studded shoe, "ankle" also an ankle jean
  ['earrings', 'Rock Stud Leather Flat', 'miss'],
]) {
  ran++
  const m = matchPiece({ name: piece }, q, 'client')
  const got = m.full ? 'full' : m.near ? 'near' : 'miss'
  if (got !== expect) fail(`shopping word "${q}" on "${piece}": expected ${expect}, got ${got}`)
}
ran++
const exactFirst = searchPieces([{ name: 'Patent Pointed Toe Pump' }, { name: 'Leather Heel Mule' }], 'heels', (x) => x, 'client').ranked
if ((exactFirst ?? [])[0]?.name !== 'Leather Heel Mule') fail('"heels": a piece named heel must rank above a pump found through the shopping words')

// ── ADR-0164: a number must be found, and a word in most of the list cannot carry a result ──
// Danielle York's Looks, 2026-10-02: "Look 300" returned all 258 looks (she has no Look 300).
ran++
const LOOKS = Array.from({ length: 30 }, (_, k) => ({ name: `Look ${k + 1}` }))
if ((searchPieces(LOOKS, 'Look 300', (x) => x, 'client').ranked ?? []).length !== 0) fail('"Look 300" returned looks that only match "look"; a typed number must be found')
ran++
if (names(searchPieces(LOOKS, 'look 17', (x) => x, 'client').ranked) !== 'Look 17') fail(`"look 17" must return exactly Look 17, got ${names(searchPieces(LOOKS, 'look 17', (x) => x, 'client').ranked)}`)
ran++
if ((searchPieces(LOOKS, '300', (x) => x, 'client').ranked ?? []).length !== 0) fail('"300" on its own returned looks')
ran++
const DRESSES = [
  ...Array.from({ length: 12 }, (_, k) => ({ name: `Silk Dress ${String.fromCharCode(65 + k)}`, brand: 'Rotate' })),
  { name: 'Plaid Belted Dress', brand: 'Lena Hoschek' }, { name: 'Wool Skirt', brand: 'Lena Hoschek' },
]
const lenaDress = searchPieces(DRESSES, 'lena dress', (x) => x, 'client').ranked
if (names(lenaDress) !== 'Plaid Belted Dress / Wool Skirt') fail(`"lena dress" where every piece is a dress: only the Lena pieces may come back, got ${names(lenaDress)}`)
ran++
if ((searchPieces(DRESSES, 'dress', (x) => x, 'client').ranked ?? []).length !== 13) fail('a search made only of a common word must still return every piece that has it')

console.log(`   rules: ${ran} case(s) run`)
if (ran === 0 || checks === 0) { console.error('\n❌ piece-search: inspected nothing.\n'); process.exit(1) }

if (problems.length) {
  if (problems.length > 14) console.error(`   … and ${problems.length - 14} more`)
  console.error(`\n❌ piece-search: ${problems.length} failure(s).\n`)
  process.exit(1)
}
console.log('\n✅ piece-search: one rule on every surface, the description searchable, her notes hers alone.\n')
