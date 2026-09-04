#!/usr/bin/env node
/**
 * Styled-coverage guard.
 *
 * Maegan asked what percentage of a client's collection is styled. Karl's answer to "styled by
 * what measure" was PUBLISHED ONLY: a look still in draft is not on her lookbook, so a piece in
 * one has not been styled as far as the client is concerned.
 *
 * Two things are guarded here, because the number can go wrong in two ways.
 *
 * 1. THE DATA CONTRACT. styledCoverage() decides "styled" from `look.published`. If that column
 *    is ever dropped from useItemLookUsage's SELECT, every look arrives with published ===
 *    undefined, every draft is promoted to styled, and the number inflates on every client with
 *    no error anywhere. That is ADR-0103 word for word. Measured on live data 2026-09-04, it
 *    would have moved Shanna Preve from 0% to 75% and Jennifer Alleva from 0% to 40%.
 *
 * 2. THE ARITHMETIC. Every branch of styledCoverage, including the empty collection and the
 *    client whose looks are ALL drafts, which is not hypothetical: five active clients hold 88
 *    unpublished looks between them.
 *
 * Runs in `npm run guard`, so the deploy is blocked if either is weakened.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { styledCoverage, coverageByCategory, LABEL_MAX_CHARS, TOTAL_SLUG } from '../src/lib/styledCoverage.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let checked = 0
const failures = []

// ── 1. The data contract ─────────────────────────────────────────────────────
const HOOK = 'src/hooks/useItemLookUsage.ts'
const hookSrc = fs.readFileSync(path.join(root, HOOK), 'utf8')
checked++
const select = hookSrc.match(/\.select\(\s*'([^']*closet_item_ids[^']*)'\s*\)/)
if (!select) {
  failures.push(`${HOOK}: could not find the gp_looks .select() at all`)
} else if (!/\bpublished\b/.test(select[1])) {
  failures.push(
    `${HOOK}: the gp_looks SELECT no longer asks for "published" — got "${select[1]}".\n` +
    `      Every look would arrive undefined, every draft would count as styled, and the ` +
    `coverage number would inflate silently on every client.`)
}
checked++
if (!/published:\s*l\.published === true/.test(hookSrc)) {
  failures.push(`${HOOK}: LookLite no longer carries published through from the row`)
}

// ── 2. The arithmetic ────────────────────────────────────────────────────────
const P = { published: true }
const D = { published: false }

function expect(name, ids, usage, want) {
  checked++
  const got = styledCoverage(ids, new Map(usage))
  for (const [k, v] of Object.entries(want)) {
    if (got[k] !== v) failures.push(`${name}: ${k} expected ${JSON.stringify(v)}, got ${JSON.stringify(got[k])}`)
  }
}

expect('empty collection', [], [], { total: 0, styled: 0, percent: 0, label: 'No collection yet' })

expect('never styled', ['a', 'b'], [],
  { total: 2, styled: 0, draftOnly: 0, unstyled: 2, percent: 0, label: '0/2 styled (0%)' })

expect('one published look', ['a', 'b'], [['a', [P]]],
  { total: 2, styled: 1, draftOnly: 0, unstyled: 1, percent: 50, label: '1/2 styled (50%)' })

// THE CASE THE WHOLE MEASURE EXISTS FOR. Shanna Preve: 42 looks, none published.
expect('draft looks only', ['a', 'b'], [['a', [D, D]], ['b', [D]]],
  { total: 2, styled: 0, draftOnly: 2, unstyled: 0, percent: 0, label: '0/2 styled (0%) · 2 in drafts' })

// A piece in a draft AND a published look is styled. One published look is enough.
expect('mixed on one piece', ['a'], [['a', [D, P, D]]],
  { total: 1, styled: 1, draftOnly: 0, unstyled: 0, percent: 100, label: '1/1 styled (100%)' })

expect('mixed collection', ['a', 'b', 'c', 'd'], [['a', [P]], ['b', [D]], ['c', [P, D]]],
  { total: 4, styled: 2, draftOnly: 1, unstyled: 1, percent: 50, label: '2/4 styled (50%) · 1 in drafts' })

// Usage carrying a piece that is not on screen (filtered out, or an orphan reference — 450 of
// them exist live) must not leak into the denominator or the numerator.
expect('usage outside the scope', ['a'], [['a', [P]], ['ghost', [P, P]]],
  { total: 1, styled: 1, percent: 100 })

// A look with published === undefined, which is what a trimmed SELECT produces, must NOT count.
expect('undefined published is not published', ['a'], [['a', [{}]]],
  { total: 1, styled: 0, draftOnly: 1, percent: 0 })

// Rounding is honest at the edges: 1 of 3 is 33%, not 33.33, and never 0 or 100 by accident.
expect('rounds down', ['a', 'b', 'c'], [['a', [P]]], { percent: 33 })
expect('rounds up', ['a', 'b', 'c'], [['a', [P]], ['b', [P]]], { percent: 67 })

// Danielle York, reproduced at her real live shape: 936 pieces, 326 in a published look,
// 43 more in drafts only. Measured against production 2026-09-04.
{
  const ids = Array.from({ length: 936 }, (_, i) => `d${i}`)
  const usage = []
  for (let i = 0; i < 326; i++) usage.push([`d${i}`, [P]])
  for (let i = 326; i < 369; i++) usage.push([`d${i}`, [D]])
  expect('Danielle York, live shape', ids, usage,
    { total: 936, styled: 326, draftOnly: 43, unstyled: 567, percent: 35, label: '326/936 styled (35%) · 43 in drafts' })
}

// LENGTH. The line sits in a single-row flex header beside two other counts. At 1024px, the
// iPad the stylists work on, a 47-character label wrapped that header onto two lines — measured
// in WebKit on 2026-09-04, which is how this was caught. The worst realistic case is the biggest
// collection on the roster (Ashley Petras, 1,346 pieces) fully styled with drafts outstanding.
{
  const worst = [
    styledCoverage(Array.from({ length: 1346 }, (_, i) => `p${i}`), new Map(
      Array.from({ length: 1346 }, (_, i) => [`p${i}`, [i < 400 ? D : P]]))).label,
    styledCoverage(['a'], new Map([['a', [P]]])).label,
    styledCoverage([], new Map()).label,
  ]
  for (const label of worst) {
    checked++
    if (label.length > LABEL_MAX_CHARS) {
      failures.push(`label is ${label.length} chars, over the ${LABEL_MAX_CHARS} that fit on one line at 1024px: "${label}"`)
    }
  }
}

// House style: the stylist reads this line, so the build checks it, not Karl. (0108)
checked++
const probes = [
  styledCoverage([], new Map()).label,
  styledCoverage(['a', 'b'], new Map([['a', [D]]])).label,
  styledCoverage(['a'], new Map([['a', [P]]])).label,
]
for (const label of probes) {
  if (label.includes('—') || label.includes('–')) failures.push(`em dash reached the stylist: "${label}"`)
  for (const jargon of ['null', 'undefined', 'boolean', 'array', 'gp_', 'closet_item_ids', 'published=', 'NaN']) {
    if (label.includes(jargon)) failures.push(`jargon "${jargon}" reached the stylist: "${label}"`)
  }
}

// ── 3. The rail renders coverage on EVERY one of its lists ───────────────────
// The Collection rail has three lists: All items, the fixed garment structure, and the client's
// own custom categories. A previous sweep through this file reached two lists out of three, which
// is the shape ADR-0106 named. There is now one row renderer and no inline row markup, so a
// fourth list cannot be added without it. This fails if anyone writes a bare row again.
const PANEL = 'src/components/categorize/CategorizePanel.tsx'
const panelSrc = fs.readFileSync(path.join(root, PANEL), 'utf8')
const railStart = panelSrc.indexOf("Filter by category")
const railEnd = panelSrc.indexOf("Active category", railStart)
checked++
if (railStart < 0 || railEnd < 0) {
  failures.push(`${PANEL}: could not locate the Collection rail`)
} else {
  const rail = panelSrc.slice(railStart, railEnd)
  const rows = (rail.match(/<CategoryRow\b/g) ?? []).length
  const inlineRows = (rail.match(/<button\b/g) ?? []).length
  console.log(`  ${PANEL}: Collection rail renders ${rows} list(s) through CategoryRow, ${inlineRows} hand-written row button(s)`)
  checked++
  if (rows < 3) failures.push(`${PANEL}: only ${rows} of the rail's 3 lists render through CategoryRow`)
  checked++
  if (inlineRows > 0) failures.push(`${PANEL}: ${inlineRows} hand-written row button(s) left in the rail — they will not show coverage`)
  checked++
  if (!/coverage=\{garmentCoverage\.get\(TOTAL_SLUG\)\}/.test(rail)) {
    failures.push(`${PANEL}: "All items" no longer reads its coverage from TOTAL_SLUG`)
  }
}
// The meter must not be hover-gated. The stylists work on an iPad and hover does not exist
// there — that is why the rename pencil went unfound for months. (0108)
checked++
const rowFn = panelSrc.slice(panelSrc.indexOf('function CategoryRow'), panelSrc.indexOf('export function CategorizePanel'))
if (!rowFn) {
  failures.push(`${PANEL}: CategoryRow is gone`)
} else if (/opacity-0|group-hover|hidden\s+group-hover/.test(rowFn)) {
  failures.push(`${PANEL}: CategoryRow hides something behind hover, which does not exist on the stylists' iPad`)
}
// The meter must not be drawn in blush. Blush (#F8E5E7) is LIGHTER than the #EFEBE6 track it
// sits on, so a fully styled category rendered as a pale line that read as an empty one.
// Measured in WebKit on 2026-09-04. The fill uses the same two colours as the header text.
checked++
if (/bg-blush|#F8E5E7/i.test(rowFn)) {
  failures.push(`${PANEL}: the coverage meter is drawn in blush, which is lighter than its own track — a full row will read as an empty one`)
}
checked++
if (!/bg-\[#8a7a6a\]/.test(rowFn) || !/bg-\[#9a6b3f\]/.test(rowFn)) {
  failures.push(`${PANEL}: the meter no longer uses the header's two colours (#8a7a6a styled, #9a6b3f drafts)`)
}

// ── 4. Per-category coverage ─────────────────────────────────────────────────
function cat(name, items, usage, want) {
  checked++
  const got = coverageByCategory(items, new Map(usage))
  for (const [slug, expected] of Object.entries(want)) {
    const c = got.get(slug)
    if (!c) { failures.push(`${name}: no bucket for "${slug}"`); continue }
    for (const [k, v] of Object.entries(expected)) {
      if (c[k] !== v) failures.push(`${name}: ${slug}.${k} expected ${JSON.stringify(v)}, got ${JSON.stringify(c[k])}`)
    }
  }
}

// A piece counts under EVERY category it is filed in, exactly like the rail's own counts, so the
// denominators agree row for row. TOTAL_SLUG counts distinct pieces, so it is NOT the sum.
cat('multi-category piece', [
  { id: 'a', categories: ['dresses', 'aspen'] },
  { id: 'b', categories: ['dresses'] },
  { id: 'c', categories: ['shoes'] },
], [['a', [P]]], {
  [TOTAL_SLUG]: { total: 3, styled: 1 },
  dresses: { total: 2, styled: 1, percent: 50 },
  aspen: { total: 1, styled: 1, percent: 100 },
  shoes: { total: 1, styled: 0, percent: 0 },
})

// A category where every piece is only in drafts must read 0 styled and say so.
cat('all-draft category', [
  { id: 'a', categories: ['shoes'] },
  { id: 'b', categories: ['shoes'] },
], [['a', [D]], ['b', [D, D]]], {
  shoes: { total: 2, styled: 0, draftOnly: 2, percent: 0 },
})

// A piece with no categories still counts in the total. It is hers whether or not it is filed.
cat('uncategorized piece', [{ id: 'a', categories: [] }], [], { [TOTAL_SLUG]: { total: 1, unstyled: 1 } })

// A collection with nothing in it produces a total bucket and no category rows.
{
  checked++
  const empty = coverageByCategory([], new Map())
  if (empty.size !== 1 || empty.get(TOTAL_SLUG)?.label !== 'No collection yet') {
    failures.push(`empty collection: expected only a ${TOTAL_SLUG} bucket reading "No collection yet", got ${empty.size} bucket(s)`)
  }
}

// TOTAL_SLUG must never become a category row of its own.
{
  checked++
  const got = coverageByCategory([{ id: 'a', categories: [TOTAL_SLUG, 'shoes'] }], new Map([['a', [P]]]))
  if (got.get(TOTAL_SLUG).total !== 1) failures.push(`${TOTAL_SLUG} was treated as a category`)
}

console.log(`styled-coverage: exercised ${checked} cases against styledCoverage + the ${HOOK} SELECT contract`)
if (checked === 0) { console.error('FAIL — the guard inspected nothing'); process.exit(1) }
if (failures.length) {
  console.error('\nFAIL')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('PASS — published decides styled, drafts are named separately, every rail list shows it, and the SELECT still carries the column.')
