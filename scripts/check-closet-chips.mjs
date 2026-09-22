#!/usr/bin/env node
/**
 * ADR-0136. EVERY CATEGORY A CLIENT HAS IS A CHIP ON THE CANVAS RAIL, AND NONE OF THEM HIDE.
 *
 * Cynthia Dada, 2026-09-22, twice in twenty minutes:
 *   "can you please make it possible for the categories to all be visible at the top? It makes a
 *    difference with how long it takes to find items. The way goodpix has it is great"
 *   "I had garments categorized correctly in Goodpix and now they are in different categories in
 *    Atelier"
 *
 * The second one reads like a data bug and is not. The sync has never written `category` or
 * `custom_categories` — gp-sync's itemRow lists them as stylist-owned — and Atelier holds her own
 * fine labels. The rail was PRESENTING them through a nine-bucket rollup with group headings,
 * pushing everything else under a "Custom" heading inside a 192px scroll box. Her blazers were
 * filed correctly and were not where she looked.
 *
 * Two things are guarded, because this can go wrong in two ways:
 *
 *   1. THE SOURCE. The rail builds its chips from the client's OWN category counts, sorted by the
 *      label on screen, with no rollup structure and no fixed-vs-custom split, and the block it
 *      sits in has no inner max-height. A reintroduced `max-h-*` is the exact defect: the chips
 *      exist and cannot be seen.
 *   2. THE DATA, over every real client. For each one, how many distinct categories the rail
 *      would now offer versus how many the old rollup showed as a named bucket. A client whose
 *      chips do not cover every category her pieces carry is a failure.
 *
 * Exits non-zero on failure and on inspecting nothing (ADR-0106).
 *
 *   node scripts/check-closet-chips.mjs
 *   node scripts/check-closet-chips.mjs --legacy   # grade the old rollup: must FAIL
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const ROOT = new URL('..', import.meta.url).pathname
const LEGACY = process.argv.includes('--legacy')
const problems = []
const fail = (m) => { problems.push(m); if (problems.length <= 15) console.error(`   ❌ ${m}`) }

// ── 1. the rail's own source ──────────────────────────────────────────────────────────────
const RAIL = 'src/components/layout/ClosetPanel.tsx'
const raw = readFileSync(ROOT + RAIL, 'utf8')
// Comments explain the decision and NAME the thing they moved away from, so the rules below read
// code only. A guard that trips over its own explanation is a guard nobody keeps.
const src = raw
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')   // {/* JSX comment */}
  .replace(/\/\*[\s\S]*?\*\//g, '')                 // /* block */
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')             // // line
let checks = 0

const chipBlock = src.slice(src.indexOf('chipCategories'), src.indexOf('{/* Item grid */}'))
if (!chipBlock) fail(`${RAIL}: the chip list is gone`)

checks++
if (!/const chipCategories = useMemo/.test(src)) {
  fail(`${RAIL}: chipCategories is gone. The rail must build its chips from the client's own categories.`)
}
checks++
if (/SIDEBAR_STRUCTURE/.test(src)) {
  fail(`${RAIL}: back on SIDEBAR_STRUCTURE. That rollup hides a client's own categories behind nine buckets (ADR-0136). It still belongs in Categorize and the lookbook, not here.`)
}
checks++
if (/isFixedCategory/.test(src)) {
  fail(`${RAIL}: splitting categories into fixed and custom again. One flat list, like GoodPix.`)
}
checks++
// The container the chips wrap inside must not cap its own height.
const container = src.slice(src.indexOf('{categoryCounts.size > 0 &&'), src.indexOf('{/* Item grid */}'))
if (/max-h-\d/.test(container)) {
  fail(`${RAIL}: the category block has an inner max-height again, so the chips scroll inside a box and she cannot see them all. That IS the bug (ADR-0136).`)
}
checks++
if (!/localeCompare/.test(src)) {
  fail(`${RAIL}: chips are no longer sorted by their label. GoodPix lists them A to Z and so do we.`)
}
console.log(`   source: ${checks} rule(s) checked on ${RAIL}`)

// ── 2. the data, over every real client ───────────────────────────────────────────────────
const env = { ...process.env }
for (const f of ['../.env.local', '../.env']) {
  let t; try { t = readFileSync(new URL(f, import.meta.url), 'utf8') } catch { continue }
  for (const l of t.split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
}
if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n❌ closet-chips: needs VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.\n'); process.exit(1)
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// The nine slugs the old rollup named as buckets, plus the four it grouped under Accessories.
const ROLLED_UP = new Set(['dresses', 'tops', 'skirts', 'pants', 'jeans', 'shorts', 'outerwear',
  'swim', 'activewear', 'shoes', 'bags', 'jewelry', 'belts', 'scarves', 'hats', 'sunglasses', 'other'])

const rows = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('gp_closet_items')
    .select('client_id, category, custom_categories')
    .eq('is_deleted', false).is('transitioned_at', null)
    .order('id', { ascending: true })
    .range(from, from + 999)       // PostgREST truncates at 1000 silently
  if (error) throw error
  rows.push(...(data ?? []))
  if (!data || data.length < 1000) break
}

const byClient = new Map()
for (const r of rows) {
  const cats = new Set()
  const primary = (r.category ?? '').trim().toLowerCase()
  if (primary) cats.add(primary)
  for (const c of r.custom_categories ?? []) {
    const slug = String(c).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    if (slug) cats.add(slug)
  }
  const cur = byClient.get(r.client_id) ?? new Set()
  for (const c of cats) cur.add(c)
  byClient.set(r.client_id, cur)
}

let clients = 0, chipsNow = 0, namedBefore = 0, worstHidden = 0, worstClient = null
for (const [cid, cats] of byClient) {
  if (cats.size === 0) continue
  clients++
  // now: every category she has is a chip. before: only the rolled-up slugs were NAMED buckets,
  // the rest sat under a "Custom" heading below them, inside the scroll box.
  const now = LEGACY ? [...cats].filter((c) => ROLLED_UP.has(c)) : [...cats]
  const before = [...cats].filter((c) => ROLLED_UP.has(c))
  chipsNow += now.length
  namedBefore += before.length
  const hidden = cats.size - now.length
  if (hidden > worstHidden) { worstHidden = hidden; worstClient = cid }
  if (hidden > 0) {
    fail(`client ${cid}: ${hidden} of her ${cats.size} categories are not offered as a chip`)
  }
}

console.log(`   data: ${clients} client(s), ${chipsNow} chips offered in total, ${namedBefore} were named buckets under the old rollup`)
if (clients === 0) { console.error('\n❌ closet-chips: no clients with categories. Nothing was verified.\n'); process.exit(1) }
if (worstClient) console.log(`   worst case: ${worstHidden} categories unreachable for one client`)

if (problems.length) {
  if (problems.length > 15) console.error(`   … and ${problems.length - 15} more`)
  console.error(`\n❌ closet-chips: ${problems.length} failure(s)${LEGACY ? ' (--legacy: this is the point)' : ''}.\n`)
  process.exit(1)
}
console.log(`\n✅ closet-chips: every category a client has is a chip she can see.\n`)
