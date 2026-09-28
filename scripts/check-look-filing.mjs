#!/usr/bin/env node
/**
 * ADR-0149. THE SAVE BOX'S CATEGORY PILLS MEAN THE SAME THING AS CATEGORIZE'S.
 *
 * Cynthia Dada, 2026-09-24: "When I go to update, it asks me to add to a category. This look was
 * already in a category but I'm not sure what. Can it just stay in the categories it was in?"
 *
 * Two defects sat behind that. The box opened BLANK on a replacement, because `initialTags` read
 * `currentLook?.tags` and a Rebuild has no `currentLook` (ADR-0076 inserts a new row). And the
 * pills wrote `gp_looks.tags`, which NOTHING files by — Categorize, the client's Looks page and
 * the season work all read `look_category_assignments`. Measured on production that morning: 219
 * live looks carried tags and 72 of them were in no category at all.
 *
 * Four rules, because this can go wrong in four ways:
 *
 *   1. THE SOURCE. The pills open from the assignment table, for the look being edited AND the
 *      one being replaced. A prefill that only knows about `currentLookId` is the original bug.
 *   2. THE WRITE. Saving files the look. If the only write is `tags`, ticking a pill is theatre.
 *   3. THE ORDER. Filing runs AFTER saveLook, which is where replaceTransitionedLook copies the
 *      original's categories across. Run it before and the inherited filing overwrites hers.
 *   4. THE SAFETY VALVE. A removal may only follow a baseline that was actually READ. A failed
 *      read must be able to add and never to strip a look out of a category the client browses by.
 *
 * Then the data, over every live look: a label a stylist ticked, that IS one of her categories,
 * must be a filing. That is the 72 rows, and it is what --legacy grades.
 *
 * Exits non-zero on failure and on inspecting nothing (ADR-0106).
 *
 *   node scripts/check-look-filing.mjs
 *   node scripts/check-look-filing.mjs --legacy   # grade what shipped before: must FAIL
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const ROOT = new URL('..', import.meta.url).pathname
const LEGACY = process.argv.includes('--legacy')
// The data sweep is OPT IN. The source rules below fail on the old code and pass on the new one,
// which is what gates a deploy. The 167 rows the sweep finds were written by the old code and are
// repaired by a press (backfill-look-filing.mjs), so gating the deploy on them would block the
// very fix that stops more of them being made.
const DATA = process.argv.includes('--data') || LEGACY
const problems = []
const fail = (m) => { problems.push(m); if (problems.length <= 12) console.error(`   ❌ ${m}`) }
let checks = 0

const strip = (s) => s
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const read = (rel) => strip(readFileSync(ROOT + rel, 'utf8'))

// ── 1. the source ─────────────────────────────────────────────────────────────────────────
const PANEL = 'src/components/layout/ChatPanel.tsx'
const panel = read(PANEL)

checks++
const prefill = panel.match(/initialTags=\{([^}]+)\}/)
if (!prefill) {
  fail(`${PANEL}: the Save box no longer takes initialTags; this guard no longer covers what it claims to.`)
} else if (/currentLook\?\.tags/.test(prefill[1])) {
  fail(`${PANEL}: the pills open from currentLook.tags, so a REBUILD or RESTYLE opens with every category blank on a look that is already filed (ADR-0149).`)
}

checks++
if (!/readLookFiling\(/.test(panel)) {
  fail(`${PANEL}: nothing reads the look's filing from look_category_assignments, so the box cannot show where the look already is.`)
}
checks++
// The whole point: the REPLACED look has no currentLookId.
if (!/currentLookId \?\? replacesLookId/.test(panel)) {
  fail(`${PANEL}: the filing read does not fall back to replacesLookId. A rebuilt look has no currentLookId, which is exactly the case Cynthia reported (ADR-0149).`)
}

// ── 2 + 3. the write, and when ────────────────────────────────────────────────────────────
checks++
if (!/applyLookFiling\(/.test(panel)) {
  fail(`${PANEL}: saving does not write look_category_assignments, so ticking a pill still only sets gp_looks.tags and files the look nowhere (ADR-0149).`)
}
checks++
const saveIdx = panel.indexOf('await saveLook(')
const fileIdx = panel.indexOf('applyLookFiling(')
if (saveIdx < 0 || fileIdx < 0) {
  fail(`${PANEL}: cannot locate the save and the filing together.`)
} else if (fileIdx < saveIdx) {
  fail(`${PANEL}: the look is filed BEFORE it is saved. replaceTransitionedLook copies the original's categories during the save, so this order lets the inherited filing overwrite the stylist's (ADR-0149).`)
}

// ── 4. the safety valve ───────────────────────────────────────────────────────────────────
const LIB = 'src/lib/lookFiling.ts'
const lib = read(LIB)
checks++
if (!/baseline/.test(lib)) {
  fail(`${LIB}: applyLookFiling does not take a baseline, so it must be diffing against the database. A read that failed would then strip a look out of its categories.`)
}
checks++
if (!/lookFilingOk \? lookFiling : \[\]/.test(panel)) {
  fail(`${PANEL}: a failed filing read is not turned into an EMPTY baseline, so a read error can delete the client's filing (ADR-0149).`)
}
checks++
if (!/\.delete\(\)/.test(lib) || !/\.in\('category_id'/.test(lib)) {
  fail(`${LIB}: unticking a pill does not remove the filing, so the box can file but never unfile.`)
}
checks++
if (!/client_id/.test(lib)) {
  fail(`${LIB}: labels are resolved without scoping to the client, so one client's category could be written onto another's look.`)
}

console.log(`   source: ${checks} rule(s) checked across ${PANEL}, ${LIB}`)

if (checks === 0) { console.error('\n❌ look-filing: inspected nothing.\n'); process.exit(1) }
if (!DATA) {
  if (problems.length) {
    console.error(`\n❌ look-filing: ${problems.length} failure(s).\n`)
    process.exit(1)
  }
  console.log('\n✅ look-filing: the pills in the Save box file the look, and a replacement opens with its filing on.')
  console.log('   (--data also sweeps every live look for pills that were never filed.)\n')
  process.exit(0)
}

// ── the data, over every live look ────────────────────────────────────────────────────────
const env = { ...process.env }
for (const f of ['../.env.local', '../.env']) {
  let t; try { t = readFileSync(new URL(f, import.meta.url), 'utf8') } catch { continue }
  for (const l of t.split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
}
if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n❌ look-filing: needs VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.\n'); process.exit(1)
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function all(table, sel, order = 'id') {
  const out = []
  for (let from = 0; ; from += 1000) {   // PostgREST truncates at 1000 silently
    const { data, error } = await sb.from(table).select(sel).order(order, { ascending: true }).range(from, from + 999)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

const looks = await all('gp_looks', 'id, client_id, name, tags, archived, published')
const cats = await all('look_categories', 'id, client_id, label')
const asg = await all('look_category_assignments', 'look_id, category_id', 'look_id')

const key = (s) => String(s).trim().toLowerCase()
const filed = new Set(asg.map((a) => `${a.look_id}|${a.category_id}`))
const catsByClient = new Map()
for (const c of cats) {
  const m = catsByClient.get(c.client_id) ?? new Map()
  m.set(key(c.label), c.id)
  catsByClient.set(c.client_id, m)
}

let inspected = 0, orphanPairs = 0, orphanLooks = new Set()
for (const l of looks) {
  if (l.archived) continue
  const tags = l.tags ?? []
  if (!tags.length) continue
  inspected++
  const m = catsByClient.get(l.client_id) ?? new Map()
  for (const t of tags) {
    const id = m.get(key(t))
    if (!id) continue                      // the category was renamed or deleted: not this rule
    if (filed.has(`${l.id}|${id}`)) continue
    orphanPairs++
    orphanLooks.add(l.id)
    fail(`look "${l.name ?? l.id}" is ticked "${t}" and is NOT in that category, so it reads UNCATEGORIZED to the stylist and the client`)
  }
}

console.log(`   data: ${inspected} live look(s) carrying pills, ${orphanPairs} of them filed nowhere, across ${orphanLooks.size} look(s)`)
if (inspected === 0) { console.error('\n❌ look-filing: no live look carries a pill. Nothing was verified.\n'); process.exit(1) }

if (problems.length) {
  if (problems.length > 12) console.error(`   … and ${problems.length - 12} more`)
  console.error(`\n❌ look-filing: ${problems.length} failure(s)${LEGACY ? ' (--legacy: this is the point)' : ''}.`)
  if (orphanPairs && !LEGACY) {
    console.error(`   The code is fixed forward; these ${orphanPairs} row(s) were written before it and need`)
    console.error(`   scripts/backfill-look-filing.mjs --apply. It changes what clients see, so it is a press, not a build step.\n`)
  }
  process.exit(1)
}
console.log('\n✅ look-filing: the pills in the Save box file the look, and a replacement opens with its filing on.\n')
