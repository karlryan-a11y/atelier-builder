#!/usr/bin/env node
/**
 * ADR-0165. TEAM NOTES LIVE IN THEIR OWN TABLE, AND NOTHING WRITES THEM ONTO THE PIECE ROW.
 *
 * A signed-in client may read every column of her own gp_closet_items rows. A team note on the row
 * ("Too low cut for work!", Janet Foutty) was never shown on a page, but her own token could read it
 * from the database API: measured 2026-10-06 by signing a query as her login. The note now lives in
 * closet_item_team_notes, whose policy returns nothing to a client (measured: client 0 rows,
 * stylist 206, bookkeeper 0), and a trigger empties the old column and raw key on every write.
 *
 * This guard keeps the code side honest: no read selects style_note off the piece row, and every
 * save routes the note through updateClosetItem / the team table. Exits non-zero on a break and on
 * inspecting nothing (ADR-0106).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const problems = []
const fail = (m) => { problems.push(m); console.error(`   ❌ ${m}`) }
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
let checks = 0

const hook = read('src/hooks/useClosetItems.ts')
const sel = hook.match(/export const CLOSET_SELECT\s*=\s*((?:\s*'[^']*'\s*\+?)+)/)?.[1] ?? ''
checks++
if (!sel) fail('useClosetItems.ts: CLOSET_SELECT not found, so this rule inspected nothing.')
if (/style_note/.test(sel)) fail('useClosetItems.ts: CLOSET_SELECT reads style_note off the piece row again (ADR-0165).')
checks++
if (!/fetchTeamNotes\(clientId\)/.test(hook)) fail('useClosetItems.ts: team notes are not read from their own table, so stylists see none.')
checks++
if (/select\([^)]*style_note/.test(strip(read('src/hooks/useReconciliation.ts')))) fail('useReconciliation.ts: the Audit tab reads style_note off the piece row.')

const add = strip(read('api/add-closet-item.ts'))
checks++
if (/style_note:\s*styleNote/.test(add)) fail('api/add-closet-item.ts: Add Item writes the note onto the piece row or into raw (ADR-0165).')
checks++
if (!/closet_item_team_notes/.test(add)) fail('api/add-closet-item.ts: Add Item drops the team note instead of saving it to its table.')

// Every src file: no direct gp_closet_items update that carries style_note.
const files = []
const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f)) files.push(p) } }
walk(path.join(ROOT, 'src'))
for (const f of files) {
  const src = strip(readFileSync(f, 'utf8'))
  checks++
  for (const m of src.matchAll(/from\('gp_closet_items'\)\s*\.update\(([\s\S]{0,400}?)\)/g)) {
    if (/style_note/.test(m[1])) fail(`${path.relative(ROOT, f)}: updates gp_closet_items with style_note directly; use updateClosetItem (ADR-0165).`)
  }
}
for (const rel of ['src/components/categorize/CollectionTab.tsx', 'src/components/categorize/ReviewTab.tsx', 'src/components/reconciliation/ReconciliationPanel.tsx', 'src/components/layout/ClosetPanel.tsx']) {
  checks++
  if (!/updateClosetItem\(/.test(read(rel))) fail(`${rel}: saves a piece without updateClosetItem, so its note can land on the piece row.`)
}

console.log(`check-team-notes: ${checks} rule(s) over ${files.length} source file(s)`)
if (!checks || !files.length) { console.error('❌ inspected nothing'); process.exit(1) }
if (problems.length) { console.error(`❌ team-notes: ${problems.length} failure(s)`); process.exit(1) }
console.log('✅ team-notes: every note is read from and written to the team-only table.')
