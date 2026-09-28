#!/usr/bin/env node
/**
 * ADR-0150. SHE CAN FIND ONE LOOK BY NAME, AND OPEN IT FROM THE PIECE THAT IS IN IT.
 *
 * Cynthia Dada, 2026-09-24: "Can we please add the ability to search for look names? I need to
 * search for 182 and 175 to change the pants out because they were the wrong color. If we can
 * edit looks from the back end where we click on the garment and it shows what looks they're
 * styled in, that would be even better."
 *
 * Her screenshot shows Chrome's own Find bar open over Peyton Wheeler's 372 looks, reading
 * "182 · 3/3". That is the measure of how badly this was missing.
 *
 * THE SEARCH, four rules:
 *   1. It composes with the status pills and the category rail rather than replacing them, so
 *      "the drafts in Evening called 182" is one question.
 *   2. It never re-orders. The grid's order IS the client's gallery order (ADR-0121) and the
 *      drag handles act on it; a search that re-ranked would have her arranging a list nobody
 *      sees in that order.
 *   3. An empty result SAYS the search is why and offers to clear it. ADR-0136 is the lesson: a
 *      grid that silently shows less reads as looks going missing.
 *   4. It does not persist. A search left behind is the same silent-short-list failure.
 *
 * THE OPEN, two rules:
 *   5. The list of looks a piece is in is clickable, or finding the look and opening it stay two
 *      jobs in two tabs, which is the half that was already built and dead-ended.
 *   6. It goes through handleRebuildLook — the SAME route the Looks grid uses. ADR-0148 exists
 *      because two ways onto the canvas looked identical and did opposite things (one replaced,
 *      one duplicated). A third route would be that bug again.
 *
 * Then the matcher itself, over EVERY live look on the roster: for a set of real queries, the
 * number of looks it returns, and the guarantee that typing more characters never returns more.
 *
 * Exits non-zero on failure and on inspecting nothing (ADR-0106).
 *
 *   node scripts/check-look-search.mjs
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { searchByName, matchesSearch, searchTerms } from '../src/lib/lookSearch.ts'

const ROOT = new URL('..', import.meta.url).pathname
const problems = []
const fail = (m) => { problems.push(m); if (problems.length <= 12) console.error(`   ❌ ${m}`) }
let checks = 0

const strip = (s) => s
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const read = (rel) => strip(readFileSync(ROOT + rel, 'utf8'))

const PANEL = 'src/components/categorize/CategorizePanel.tsx'
const panel = read(PANEL)
const COLL = 'src/components/categorize/CollectionTab.tsx'
const coll = read(COLL)

// ── 1. it composes ────────────────────────────────────────────────────────────────────────
checks++
const visible = panel.match(/const visible = useMemo\(([\s\S]*?)\n  \)/)
if (!visible) {
  fail(`${PANEL}: the visible list is gone; this guard no longer covers what it claims to.`)
} else {
  if (!/searchByName\(/.test(visible[1])) {
    fail(`${PANEL}: the grid is not filtered by the search box, so typing a look name does nothing (ADR-0150).`)
  }
  if (!/filterByCategory\(/.test(visible[1])) {
    fail(`${PANEL}: search has replaced the category filter instead of composing with it. Both must apply (ADR-0150).`)
  }
}

// ── 2. it never re-orders ─────────────────────────────────────────────────────────────────
const LIB = 'src/lib/lookSearch.ts'
const lib = read(LIB)
checks++
if (/\.sort\(/.test(lib)) {
  fail(`${LIB}: the search sorts its result. The grid order is the client's gallery order and the drag handles act on it (ADR-0121).`)
}

// ── 3. an empty result explains itself ────────────────────────────────────────────────────
checks++
if (!/beforeSearch/.test(panel)) {
  fail(`${PANEL}: nothing knows how many looks the search alone removed, so an empty grid cannot say the search is why (ADR-0150).`)
}
checks++
if (!/Clear the search/.test(panel)) {
  fail(`${PANEL}: the empty state offers no way out of a search that found nothing.`)
}
checks++
if (!/aria-label=\{mode === 'looks' \? 'Search look names'/.test(panel) && !/aria-label="Search/.test(panel)) {
  fail(`${PANEL}: the search box is not labelled.`)
}

// ── 4. it does not persist ────────────────────────────────────────────────────────────────
checks++
const decl = panel.match(/const \[search, setSearch\] = ([^\n]+)/)
if (!decl) {
  fail(`${PANEL}: the search state is gone.`)
} else if (/localStorage|useViewStore|sessionStorage/.test(decl[1])) {
  fail(`${PANEL}: the search is remembered between sessions. A search left behind reads as looks gone missing (ADR-0150).`)
}
checks++
if (!/setTagging\(false\); setSearch\(''\)/.test(panel)) {
  fail(`${PANEL}: switching tabs does not clear the search, so Capsules opens filtered by a look name (ADR-0150).`)
}

// ── 5 + 6. the open ───────────────────────────────────────────────────────────────────────
checks++
if (!/onOpenLook/.test(coll)) {
  fail(`${COLL}: the "Styled in N looks" list still cannot be acted on, which is the half of the request that was already built and dead-ended (ADR-0150).`)
}
checks++
if (!/onOpenLook\(lk\.id\)/.test(coll)) {
  fail(`${COLL}: the look tiles in that list are not clickable.`)
}
checks++
if (!/onOpenLook=\{handleOpenLookFromPiece\}/.test(panel)) {
  fail(`${PANEL}: the Collection tab is not given a way to open a look.`)
}
checks++
const handler = panel.match(/function handleOpenLookFromPiece\([\s\S]*?\n  \}/)
if (!handler) {
  fail(`${PANEL}: handleOpenLookFromPiece is gone.`)
} else {
  if (!/handleRebuildLook\(/.test(handler[0])) {
    fail(`${PANEL}: opening a look from a piece does NOT go through handleRebuildLook. A second route onto the canvas is exactly the bug ADR-0148 fixed: two ways in that looked the same and did opposite things.`)
  }
  if (/loadLookAsNew\(/.test(handler[0])) {
    fail(`${PANEL}: opening a look from a piece duplicates it instead of replacing it (ADR-0148).`)
  }
}

console.log(`   source: ${checks} rule(s) checked across ${PANEL}, ${COLL}, ${LIB}`)

// ── the matcher, over every live look ─────────────────────────────────────────────────────
const env = { ...process.env }
for (const f of ['../.env.local', '../.env']) {
  let t; try { t = readFileSync(new URL(f, import.meta.url), 'utf8') } catch { continue }
  for (const l of t.split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
}
if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n❌ look-search: needs VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.\n'); process.exit(1)
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const rows = []
for (let from = 0; ; from += 1000) {   // PostgREST truncates at 1000 silently
  const { data, error } = await sb.from('gp_looks').select('id, client_id, name, archived')
    .order('id', { ascending: true }).range(from, from + 999)
  if (error) throw error
  rows.push(...(data ?? []))
  if (!data || data.length < 1000) break
}
const live = rows.filter((r) => !r.archived)

// Cynthia's own two, on her own client.
const { data: peyton } = await sb.from('gp_clients').select('id, name').ilike('name', '%Peyton Wheeler%')
const pid = peyton?.[0]?.id ?? null
const hers = pid ? live.filter((l) => l.client_id === pid) : []
checks++
if (hers.length === 0) {
  fail('Peyton Wheeler has no live looks; the reported case cannot be graded.')
} else {
  for (const q of ['182', '175']) {
    const hits = searchByName(hers, q)
    if (hits.length === 0) fail(`searching Peyton for "${q}" finds nothing; that is the exact search Cynthia asked for`)
    else console.log(`   "${q}" on Peyton (${hers.length} looks) -> ${hits.length}: ${hits.map((h) => h.name).join(', ')}`)
  }
}

// Typing more can only ever narrow. Over EVERY client, for the prefixes of a real query.
checks++
let widened = 0
const byClient = new Map()
for (const l of live) { const a = byClient.get(l.client_id) ?? []; a.push(l); byClient.set(l.client_id, a) }
for (const [, ls] of byClient) {
  let prev = ls.length
  for (const q of ['1', '18', '182']) {
    const n = searchByName(ls, q).length
    if (n > prev) widened++
    prev = n
  }
}
if (widened) fail(`typing another character WIDENED the result for ${widened} client/query pair(s); a live filter must only narrow`)

// An empty query is not a filter, and a name nothing matches is not a crash.
checks++
if (searchByName(live, '').length !== live.length) fail('an empty search filters the list; it must be a no-op')
checks++
if (searchByName(live, '   ').length !== live.length) fail('a whitespace-only search filters the list')
checks++
if (!matchesSearch(null, [])) fail('an unnamed look does not survive an empty query')
checks++
if (matchesSearch(null, searchTerms('182'))) fail('an unnamed look matches a real query')
checks++
// Order in, order out — rule 2, measured rather than read off the source.
const sample = live.slice(0, 5000)
const filtered = searchByName(sample, 'look')
const expected = sample.filter((l) => (l.name ?? '').toLowerCase().includes('look')).map((l) => l.id)
if (filtered.map((l) => l.id).join(',') !== expected.join(',')) fail('the search changed the order of the list')

// Terms in any order find the same look.
checks++
const a = searchByName(hers.length ? hers : live, 'peyton 182').map((l) => l.id).sort().join(',')
const b = searchByName(hers.length ? hers : live, '182 peyton').map((l) => l.id).sort().join(',')
if (a !== b) fail('the order of the words changes the result')

console.log(`   data: ${live.length} live look(s) across ${byClient.size} client(s), ${checks} rule(s) total`)
if (live.length === 0) { console.error('\n❌ look-search: no live looks. Nothing was verified.\n'); process.exit(1) }
if (checks === 0) { console.error('\n❌ look-search: inspected nothing.\n'); process.exit(1) }

if (problems.length) {
  if (problems.length > 12) console.error(`   … and ${problems.length - 12} more`)
  console.error(`\n❌ look-search: ${problems.length} failure(s).\n`)
  process.exit(1)
}
console.log('\n✅ look-search: she can find a look by name, and open it from a piece that is in it.\n')
