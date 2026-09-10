#!/usr/bin/env node
/**
 * TRANSITION CAPTION — the real wording, over real production rows.
 *
 * The defect this exists to catch (Julia Driscoll, 2026-09-09): "can I find in the look which
 * piece was the transitioned piece?" She could not. A pulled look records the exact pieces that
 * pulled it in `gp_looks.transitioned_item_ids`, the Transitions tab loaded that list, counted
 * it, and printed "Piece transitioned" — never which one. On Alicia Hidalgo alone that was 237
 * cards, 110 of them down over a single unnamed piece, and 62 of them with no title either
 * because those looks were saved with an EMPTY name and the fallback only caught a missing one.
 *
 * A caption checked by reading the JSX is a caption nobody checked. So this builds the caption
 * the stylist actually reads, using the shipped module, from rows pulled out of production, and
 * fails if any card would go up without naming its piece or without a title.
 *
 * Exits non-zero on any failure AND on inspecting zero cards — a guard that measured nothing is
 * a failure, not a pass. (ADR-0108, ADR-0121.)
 *
 *   node scripts/check-transition-caption.mjs               # every client with pulled looks
 *   node scripts/check-transition-caption.mjs "Alicia Hidalgo"
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
// The SHIPPED module, imported directly — the guard must exercise the code that ships, not a
// copy of it that can drift. Node strips the types natively (>= 22.18).
const { causeCaption, lookTitle } = await import('../src/lib/transitionCaption.ts')

const env = { ...process.env }
try {
  for (const file of ['../.env.local', '../.env']) {
    let text
    try { text = readFileSync(new URL(file, import.meta.url), 'utf8') } catch { continue }
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
} catch { /* rely on process.env */ }

const URL_ = env.VITE_SUPABASE_URL ?? env.PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !KEY) {
  console.error('\n❌ transition-caption: needs VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.\n')
  process.exit(1)
}
const sb = createClient(URL_, KEY)

const ONLY = process.argv[2] ?? null

const problems = []
const fail = (msg) => { problems.push(msg); console.error(`   ❌ ${msg}`) }

// Every pulled look on the platform, paged (PostgREST caps at 1000).
async function pulledLooks() {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('gp_looks')
      .select('id, client_id, name, transitioned_at, transitioned_item_ids')
      .not('transitioned_at', 'is', null)
      .range(from, from + 999)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

async function transitionedPieces(clientIds) {
  const byId = new Map()
  const ids = [...clientIds]
  for (let i = 0; i < ids.length; i += 20) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('gp_closet_items')
        .select('id, client_id, name, name_override, brand, transition_source')
        .in('client_id', ids.slice(i, i + 20))
        .not('transitioned_at', 'is', null)
        .range(from, from + 999)
      if (error) throw error
      for (const r of data ?? []) {
        byId.set(r.id, {
          id: r.id,
          name: (r.name_override?.trim() || r.name) ?? 'Untitled item',
          brand: r.brand && r.brand !== 'None' ? r.brand : null,
          source: r.transition_source ?? null,
        })
      }
      if (!data || data.length < 1000) break
    }
  }
  return byId
}

const { data: clientRows } = await sb.from('gp_clients').select('id, name')
const clientName = new Map((clientRows ?? []).map((c) => [c.id, c.name]))

let looks = await pulledLooks()
if (ONLY) {
  const wanted = new Set([...clientName].filter(([, n]) => n?.toLowerCase().includes(ONLY.toLowerCase())).map(([id]) => id))
  looks = looks.filter((l) => wanted.has(l.client_id))
}

const pieces = await transitionedPieces(new Set(looks.map((l) => l.client_id)))

let cards = 0
let named = 0
let untitledFallback = 0
const perClient = new Map()

for (const look of looks) {
  cards += 1
  perClient.set(look.client_id, (perClient.get(look.client_id) ?? 0) + 1)
  const who = clientName.get(look.client_id) ?? look.client_id

  const title = lookTitle(look.name)
  if (!title.trim()) fail(`${who} / ${look.id}: card would render with no title at all`)
  if (title === 'Untitled Look') untitledFallback += 1

  const causes = Array.isArray(look.transitioned_item_ids) ? look.transitioned_item_ids : []
  const caption = causeCaption(causes, (id) => pieces.get(id), look.transitioned_at)

  if (causes.length === 0) {
    // A look pulled with no recorded cause cannot be explained to anyone. ADR-0100 writes the
    // ids and the cause, so zero here is a data defect, not a wording one.
    fail(`${who} / ${look.id}: pulled but records NO cause piece — nothing can name why it is down`)
    continue
  }
  if (caption.pieces.length === 0) {
    fail(`${who} / ${look.id}: ${causes.length} cause id(s), none resolve to a piece — the card still says nothing`)
    continue
  }
  if (caption.unresolved > 0) {
    fail(`${who} / ${look.id}: ${caption.unresolved} of ${causes.length} cause piece(s) unresolved`)
  }
  if (!caption.pieces.every((p) => p.name && p.name.trim())) {
    fail(`${who} / ${look.id}: a named cause piece has an empty name`)
  }
  if (!/removed/.test(caption.headline)) {
    fail(`${who} / ${look.id}: headline does not say a piece was removed: "${caption.headline}"`)
  }
  named += 1
}

console.log(`\n   ${cards} pulled look card(s) across ${perClient.size} client(s)`)
console.log(`   ${named} name the piece that pulled them`)
console.log(`   ${untitledFallback} fell back to "Untitled Look" (empty name in the row, now titled rather than blank)`)
if (cards) {
  const sample = looks.find((l) => (l.transitioned_item_ids ?? []).length)
  if (sample) {
    const c = causeCaption(sample.transitioned_item_ids, (id) => pieces.get(id), sample.transitioned_at)
    console.log(`   e.g. "${lookTitle(sample.name)}" — ${c.headline} — ${c.pieces.map((p) => [p.brand, p.name].filter(Boolean).join(' ')).join('; ')}`)
  }
}

if (cards === 0) {
  console.error('\n❌ transition-caption: 0 cards inspected. Nothing was verified.\n')
  process.exit(1)
}
if (problems.length) {
  console.error(`\n❌ transition-caption: ${problems.length} failure(s) over ${cards} card(s).\n`)
  process.exit(1)
}
console.log(`\n✅ transition-caption: ${cards} card(s), every one names the piece that pulled it.\n`)
