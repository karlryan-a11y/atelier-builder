#!/usr/bin/env node
/**
 * ADR-0149, the data half. FILE THE LOOKS THAT WERE TICKED INTO A COLUMN NOTHING FILES BY.
 *
 * Until 2026-09-24 the Save box's CATEGORIES pills wrote `gp_looks.tags` and nothing else, so a
 * stylist who ticked "Denim" saw her look come back UNCATEGORIZED in Categorize and on the
 * client's Looks page. The code is fixed forward; these rows were written before it.
 *
 * WHAT IT DOES: for every LIVE look, every tag whose label IS one of that client's own categories
 * becomes a `look_category_assignments` row. Nothing else.
 *
 * WHAT IT WILL NOT DO:
 *   - invent a category. A tag with no matching row is left alone and printed, because "Hamptons"
 *     on a client who has no Hamptons category is a guess, and a guess here shows up on her site.
 *   - touch an archived look, or remove anything. Add-only.
 *   - match across clients. Labels are resolved inside the look's own client.
 *
 * IT CHANGES WHAT CLIENTS SEE — a look that was in no category appears in one — so it is a press,
 * not a build step, and it prints the full plan before it writes anything.
 *
 *   node scripts/backfill-look-filing.mjs            # dry run, prints the plan
 *   node scripts/backfill-look-filing.mjs --apply    # writes
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')

const env = { ...process.env }
for (const f of ['../.env.local', '../.env']) {
  let t; try { t = readFileSync(new URL(f, import.meta.url), 'utf8') } catch { continue }
  for (const l of t.split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
}
if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('needs VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY'); process.exit(1)
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function all(table, sel, order = 'id') {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(sel).order(order, { ascending: true }).range(from, from + 999)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

const key = (s) => String(s).trim().toLowerCase()

const looks = await all('gp_looks', 'id, client_id, name, tags, archived, published')
const cats = await all('look_categories', 'id, client_id, label')
const asg = await all('look_category_assignments', 'look_id, category_id', 'look_id')
const clients = await all('gp_clients', 'id, name')

const nameOf = new Map(clients.map((c) => [c.id, c.name]))
const filed = new Set(asg.map((a) => `${a.look_id}|${a.category_id}`))
const catsByClient = new Map()
for (const c of cats) {
  const m = catsByClient.get(c.client_id) ?? new Map()
  m.set(key(c.label), { id: c.id, label: c.label })
  catsByClient.set(c.client_id, m)
}

const plan = []
const skipped = new Map()
for (const l of looks) {
  if (l.archived) continue
  for (const t of l.tags ?? []) {
    const m = catsByClient.get(l.client_id) ?? new Map()
    const c = m.get(key(t))
    if (!c) { skipped.set(String(t), (skipped.get(String(t)) ?? 0) + 1); continue }
    if (filed.has(`${l.id}|${c.id}`)) continue
    plan.push({ look_id: l.id, category_id: c.id, look: l.name ?? l.id, label: c.label, client: nameOf.get(l.client_id) ?? l.client_id, published: !!l.published })
  }
}

const byClient = new Map()
for (const p of plan) byClient.set(p.client, (byClient.get(p.client) ?? 0) + 1)

console.log(`\n${plan.length} filing(s) to add, across ${new Set(plan.map((p) => p.look_id)).size} look(s) and ${byClient.size} client(s).`)
console.log(`${plan.filter((p) => p.published).length} of them are on a PUBLISHED look, so the client sees the change.\n`)
for (const [c, n] of [...byClient].sort((a, b) => b[1] - a[1])) console.log(`   ${c}: ${n}`)
if (skipped.size) {
  console.log(`\nLeft alone — no category by that name (${[...skipped.values()].reduce((a, b) => a + b, 0)} tag(s)):`)
  for (const [t, n] of [...skipped].sort((a, b) => b[1] - a[1])) console.log(`   "${t}" x${n}`)
}

if (!APPLY) { console.log('\nDry run. Re-run with --apply to write.\n'); process.exit(0) }

let written = 0
for (let i = 0; i < plan.length; i += 100) {   // a big write fails silently: chunk it
  const chunk = plan.slice(i, i + 100)
  const { data, error } = await sb.from('look_category_assignments')
    .upsert(chunk.map((p) => ({ look_id: p.look_id, category_id: p.category_id })))
    .select('look_id')
  if (error) { console.error('\n❌ write failed:', error.message); process.exit(1) }
  written += (data ?? []).length
}
console.log(`\n✅ ${written} filing(s) written.\n`)
