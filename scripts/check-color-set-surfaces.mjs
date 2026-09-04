#!/usr/bin/env node
/**
 * Colour-set surface guard (ADR-0115).
 *
 * Maegan asked whether she could pick more than one colour. She could, on three surfaces out of
 * ten; on the other seven a colour was a single free-text word written into `color`, which NOTHING
 * filters on. A stylist typing "Navy" into Review changed nothing about what tapping Navy returns,
 * with no error anywhere.
 *
 * Two failure modes are guarded, because this went wrong in both directions before:
 *
 * 1. A SURFACE THAT EDITS A FIELD IT NEVER FETCHED. This is ADR-0099 word for word: the Audit tab
 *    was given the multi-CATEGORY editor while its query did not select custom_categories, so the
 *    dialog opened on an empty list and saved the emptiness back over real data. The Audit tab's
 *    query did not select color_family/color_families either until this change, so enabling the
 *    colour editor there without the fetch would have blanked the colour set of every piece a
 *    stylist opened. On the pre-change tree, check 1 below FAILS.
 *
 * 2. A SURFACE THAT QUIETLY OPTS OUT. `enableMultiColor` used to default to FALSE, so four of the
 *    five stylist surfaces went without it for months by saying nothing at all. The default is now
 *    ON and silence means the set; opting out is a claim that has to be argued in a comment.
 *
 * Also asserts the palette copies agree (the Vercel function cannot import the app's module) and
 * that a stylist overriding the CLIENT's colours takes ownership back — colour was missing from
 * that list, so a piece went on claiming the client owned a colour a stylist had replaced.
 *
 * Runs in `npm run guard`, so the deploy is blocked if any of it is weakened.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
let checked = 0
const failures = []

// Every surface that renders the shared editor, and the module holding the query that feeds it.
// Adding a sixth consumer without adding it here trips check 0.
const SURFACES = [
  { name: 'Collection tab', ui: 'src/components/categorize/CollectionTab.tsx',            data: 'src/hooks/useClosetItems.ts' },
  { name: 'Review tab',     ui: 'src/components/categorize/ReviewTab.tsx',                data: 'src/hooks/useClosetItems.ts' },
  { name: 'Canvas closet',  ui: 'src/components/layout/ClosetPanel.tsx',                  data: 'src/hooks/useClosetItems.ts' },
  { name: 'Audit tab',      ui: 'src/components/reconciliation/ReconciliationPanel.tsx',  data: 'src/hooks/useReconciliation.ts' },
]

// ── 0. The enumeration itself ────────────────────────────────────────────────
// "Applied from every source" has twice meant "applied to most of them", so the list is checked
// against the tree rather than trusted.
checked++
const callSites = []
for (const dir of ['src/components', 'src/pages'].filter((d) => fs.existsSync(path.join(root, d)))) {
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
      const rel = `${d}/${e.name}`
      if (e.isDirectory()) walk(rel)
      else if (/\.tsx$/.test(e.name) && /<EditItemDialog/.test(read(rel))) callSites.push(rel)
    }
  }
  walk(dir)
}
const known = new Set(SURFACES.map((s) => s.ui))
for (const f of callSites) {
  if (!known.has(f)) failures.push(`${f} renders EditItemDialog but is not in this guard's SURFACES list — add it, with the query that feeds it.`)
}
for (const s of SURFACES) {
  if (!callSites.includes(s.ui)) failures.push(`${s.ui} is listed as a colour surface but no longer renders EditItemDialog.`)
}

// ── 1. THE DATA CONTRACT — a surface that shows the field must fetch it ──────
for (const s of SURFACES) {
  checked++
  const src = read(s.data)
  const selects = [...src.matchAll(/\.select\(\s*(['"`])([\s\S]*?)\1/g)].map((m) => m[2])
  const feeds = selects.filter((c) => /\bcustom_categories\b/.test(c) || /\bcolor\b/.test(c))
  if (!feeds.length) {
    failures.push(`${s.name}: no closet-item SELECT found in ${s.data}`)
    continue
  }
  for (const cols of feeds) {
    const missing = ['color_family', 'color_families'].filter((c) => !new RegExp(`\\b${c}\\b`).test(cols))
    if (missing.length) {
      failures.push(
        `${s.name} (${s.data}): the SELECT is missing ${missing.join(' + ')}.\n` +
        `      The editor would open on an EMPTY colour set and save the emptiness back over real data — ADR-0099, exactly.`)
    }
  }
}

// ── 2. THE DEFAULT POSTURE — silence means the set ───────────────────────────
const DIALOG = 'src/components/layout/EditItemDialog.tsx'
const dialog = read(DIALOG)
checked++
if (!/enableMultiColor = true/.test(dialog)) {
  failures.push(`${DIALOG}: enableMultiColor no longer DEFAULTS TO TRUE. Silence would once again mean "single colour", which is how four surfaces went without it (ADR-0115).`)
}
for (const s of SURFACES) {
  checked++
  const ui = read(s.ui)
  const optOut = /enableMultiColor=\{false\}/.test(ui)
  if (optOut && !/ADR-0115/.test(ui)) {
    failures.push(`${s.name}: opts OUT of the colour set with no reason. Passing false is a claim — say why, and cite ADR-0115.`)
  }
}

// ── 3. THE WRITE PATH — each surface persists the columns it now edits ───────
// The four saves are NOT the same code: two spread the payload, one builds its column list by hand.
for (const s of SURFACES) {
  checked++
  const ui = read(s.ui)
  const spreads = /\.update\(data\)|\.update\(patch\)/.test(ui)
  const byHand = /'color_family' in data/.test(ui) || /color_family: /.test(ui)
  if (!spreads && !byHand) {
    failures.push(`${s.name}: its save neither spreads the dialog payload nor names color_family, so the colour set is edited and then dropped on the floor.`)
  }
}

// ── 4. PALETTE PARITY — the Vercel function cannot import the app's module ───
checked++
const palette = (src) => {
  const m = src.match(/COLOR_ORDER\s*=\s*\[([\s\S]*?)\]/)
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null
}
const appPalette = palette(read('src/lib/colorFamily.ts'))
const apiPalette = palette(read('api/add-closet-item.ts'))
if (!appPalette || !apiPalette) {
  failures.push('could not read COLOR_ORDER from src/lib/colorFamily.ts and/or api/add-closet-item.ts')
} else if (appPalette.join('|') !== apiPalette.join('|')) {
  failures.push(
    `the palette copies have drifted.\n` +
    `      app: ${appPalette.join(', ')}\n` +
    `      api: ${apiPalette.join(', ')}\n` +
    `      Add Item would offer the AI a colour the filter cannot show, or withhold one it can.`)
}

// ── 5. OWNERSHIP — a stylist overriding the client's colours takes them back ─
checked++
const collection = read('src/components/categorize/CollectionTab.tsx')
if (!/if \(f === 'color'\)/.test(collection)) {
  failures.push(
    `src/components/categorize/CollectionTab.tsx: client_edited_fields is released for name/brand/category but NOT colour.\n` +
    `      A stylist replaces the colours the client chose and the piece goes on claiming she owns them, forever.`)
}

// ── Report ───────────────────────────────────────────────────────────────────
// A green tick over nothing is how a broken guard survived three weeks here (ADR-0106).
console.log(`colour-set surfaces: ${checked} assertions over ${SURFACES.length} surfaces (${callSites.length} EditItemDialog call sites found)`)
if (checked === 0 || SURFACES.length === 0 || callSites.length === 0) {
  console.error('FAIL: the guard inspected nothing.')
  process.exit(1)
}
if (failures.length) {
  console.error(`\nFAIL (${failures.length}):`)
  for (const f of failures) console.error(`  • ${f}`)
  process.exit(1)
}
console.log('OK: every stylist surface that assigns a colour assigns the set, fetches it, and persists it.')
