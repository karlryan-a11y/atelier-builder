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
 * Exits non-zero on failure and on inspecting nothing (ADR-0106).
 */
import { readFileSync, existsSync } from 'node:fs'
import { matchPiece, searchPieces, pieceTokens, wordHitsToken } from '../src/lib/pieceSearch.ts'

const ROOT = new URL('..', import.meta.url).pathname
const SIBLING = `${process.env.HOME}/Downloads/atelier-looks/`
const problems = []
const fail = (m) => { problems.push(m); if (problems.length <= 14) console.error(`   ❌ ${m}`) }
let checks = 0

const strip = (s) => s
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const read = (rel, root = ROOT) => strip(readFileSync(root + rel, 'utf8'))

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
  if (!/searchPieces\(/.test(src)) {
    fail(`${rel}: ${what} still filters with a search of its own. Five different field lists is why a piece findable on one screen was not findable on another (ADR-0151).`)
  }
  checks++
  if (!new RegExp(`'${audience}'`).test(src)) {
    fail(`${rel}: ${what} does not name its audience as '${audience}'.`)
  }
  checks++
  if (!/description: i\.description/.test(src)) {
    fail(`${rel}: ${what} does not put the description in the token set, so the field Maegan asked for is not searchable there.`)
  }
  checks++
  if (audience === 'team' && !/internalNote: i\.style_note/.test(src)) {
    fail(`${rel}: ${what} is a stylist surface and does not search the internal note.`)
  }
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
  // 4 of 5: "shirt" IS in "Belted Shirt Dress", so this is a near miss and not a miss. My first
  // expectation here was simply wrong about her data.
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
  // plurals, both directions — the silent loss this replaces
  [MARGARET, 'dresses', 'client', 'full'],
  [MARGARET, 'dress', 'client', 'full'],
  [{ name: 'Suede Boot' }, 'boots', 'client', 'full'],
  [{ name: 'Suede Boots' }, 'boot', 'client', 'full'],
  // brand, colour, category and tag all still count
  [MARGARET, 'lena hoschek', 'client', 'full'],
  [MARGARET, 'whiskey', 'client', 'full'],
  [MARGARET, 'dresses lena', 'client', 'full'],
  // a one-word miss on a TWO word query is not "nearly" — it would answer with everything
  [MARGARET, 'lena houndstooth', 'client', 'miss'],
  [MARGARET, 'zebra', 'client', 'miss'],
  // a short token must not swallow a long query
  [{ name: 'Fran Skirt' }, 'france', 'client', 'miss'],
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

// order is preserved within each group
ran++
const list = [{ name: 'A Dress' }, { name: 'B Dress' }, { name: 'C Dress' }]
const out = searchPieces(list, 'dress', (x) => x, 'client')
if (out.full.map((x) => x.name).join(',') !== 'A Dress,B Dress,C Dress') fail('the search re-ordered the list')
ran++
if (searchPieces(list, '', (x) => x, 'client').full.length !== 3) fail('an empty query filtered the list')

console.log(`   rules: ${ran} case(s) run`)
if (ran === 0 || checks === 0) { console.error('\n❌ piece-search: inspected nothing.\n'); process.exit(1) }

if (problems.length) {
  if (problems.length > 14) console.error(`   … and ${problems.length - 14} more`)
  console.error(`\n❌ piece-search: ${problems.length} failure(s).\n`)
  process.exit(1)
}
console.log('\n✅ piece-search: one rule on every surface, the description searchable, her notes hers alone.\n')
