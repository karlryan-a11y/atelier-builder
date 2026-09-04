#!/usr/bin/env node
/**
 * Fill the colour set from the colour ALREADY written on the piece (ADR-0115, step 2).
 *
 * 85,476 pieces have no filing colour, so the client's colour chips return nothing for all but ten
 * clients on the roster. 21,900 of those pieces already carry a colour word a human wrote — it has
 * simply never been translated into something the filter can read.
 *
 * SAFETY: BLANKS ONLY. Every write is guarded `color_family=is.null` in the WHERE clause, not just
 * in the read, so a colour chosen by a stylist or a client — or one written by a concurrent run
 * between this script's SELECT and its PATCH — can never be overwritten. We cannot always tell WHO
 * set a colour (there is no stylist-edit trace, only a client one), so the protection is structural
 * rather than a test that could be wrong: if the field is empty, nobody ever chose anything.
 *
 * A piece whose text we do not recognise is LEFT ALONE for the photo pass. A wrong colour is worse
 * than no colour: it files the piece under a chip the client will not look under.
 *
 *   node scripts/backfill-color-families.mjs                 # dry run, reports what it would do
 *   node scripts/backfill-color-families.mjs --apply         # writes
 *   node scripts/backfill-color-families.mjs --client <id>   # one client
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translateColorText } from '../src/lib/colorText.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const f of ['.env.local', '.env']) {
  const p = path.join(root, f)
  if (!fs.existsSync(p)) continue
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !KEY) { console.error('need VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

const APPLY = process.argv.includes('--apply')
const clientIx = process.argv.indexOf('--client')
const CLIENT = clientIx > -1 ? process.argv[clientIx + 1] : null

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const PAGE = 1000          // Supabase truncates a SELECT at 1000 rows; page explicitly.
const CHUNK = 50           // a big .in() write fails silently, and a 200-id PATCH with
                           // return=representation hit a statement timeout on the real table.

// ── Read every candidate: no filing colour, not deleted, some colour text ────
const base =
  `${URL_}/rest/v1/gp_closet_items?select=id,color,client_id` +
  `&color_family=is.null&is_deleted=is.false&color=not.is.null&color=neq.&order=id` +
  (CLIENT ? `&client_id=eq.${CLIENT}` : '')

// KEYSET pagination, not Range offsets. `color_family=is.null` over 89k rows with a deep OFFSET
// makes Postgres walk everything it already skipped, and the read started timing out at ~15k in.
// Paging on the last id seen is O(1) per page and is also RESUMABLE: the script only ever reads
// rows that still have no colour, so re-running it after an interruption picks up where it stopped.
const rows = []
let after = ''
for (;;) {
  const url = base + `&limit=${PAGE}` + (after ? `&id=gt.${after}` : '')
  const r = await fetch(url, { headers: H })
  if (!r.ok) { console.error('read failed:', r.status, await r.text()); process.exit(1) }
  const page = await r.json()
  rows.push(...page)
  if (page.length < PAGE) break
  after = page[page.length - 1].id
}

// ── Translate, and group by the resulting set so identical sets write together ──
const bySet = new Map()
let unrecognised = 0
const unrecognisedWords = new Map()
for (const row of rows) {
  const colors = translateColorText(row.color)
  if (!colors.length) {
    unrecognised++
    const w = (row.color || '').trim().toLowerCase()
    unrecognisedWords.set(w, (unrecognisedWords.get(w) ?? 0) + 1)
    continue
  }
  const key = colors.join('|')
  if (!bySet.has(key)) bySet.set(key, [])
  bySet.get(key).push(row.id)
}

const translated = rows.length - unrecognised
const multi = [...bySet.entries()].filter(([k]) => k.includes('|')).reduce((n, [, ids]) => n + ids.length, 0)

console.log(`candidates (no filing colour, colour text present): ${rows.length}`)
console.log(`  translated:   ${translated} (${rows.length ? (translated * 100 / rows.length).toFixed(1) : 0}%)`)
console.log(`    ...landing on 2+ colours: ${multi}`)
console.log(`  left for the photo pass: ${unrecognised} across ${unrecognisedWords.size} distinct spellings`)
console.log(`  distinct colour sets to write: ${bySet.size}`)

if (rows.length === 0) { console.error('FAIL: inspected nothing.'); process.exit(1) }

const top = [...bySet.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 12)
console.log('\nlargest sets:')
for (const [k, ids] of top) console.log(`  ${String(ids.length).padStart(6)}  ${k.split('|').join(' + ')}`)
const topUnknown = [...unrecognisedWords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
if (topUnknown.length) {
  console.log('\ncommonest words left alone:')
  for (const [w, n] of topUnknown) console.log(`  ${String(n).padStart(6)}  ${w}`)
}

if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); process.exit(0) }

// ── Write. Blanks only, chunked, and every failure is surfaced ───────────────
let written = 0, failed = 0

/**
 * One PATCH, splitting on a statement timeout rather than retrying the same size.
 *
 * Updating one of these rows rewrites the whole tuple, and gp_closet_items carries `raw` plus a
 * 1536-dimension embedding, so a wide id list is genuinely slow at the database rather than flaky.
 * A same-size retry just times out again — the first full run lost 4,917 writes that way. Halving
 * until it fits always terminates, and a single row that still will not go is reported by id.
 */
async function writeChunk(colors, ids) {
  const body = JSON.stringify({ color_family: colors[0], color_families: colors.slice(1) })
  // `color_family=is.null` in the WHERE is the whole safety story: a row that acquired a colour
  // since the read simply does not match, and is left as the human left it.
  const url = `${URL_}/rest/v1/gp_closet_items?id=in.(${ids.join(',')})&color_family=is.null`
  const r = await fetch(url, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal,count=exact' }, body })
  if (r.ok) {
    // Content-Range carries how many rows the PATCH actually matched — a write RLS declines is
    // HTTP 200 with an empty body (ADR-0108), so a count is asked for rather than assumed.
    const n = Number((r.headers.get('content-range') || '').split('/')[1])
    written += Number.isFinite(n) ? n : 0
    return
  }
  const txt = (await r.text()).slice(0, 160)
  if (ids.length === 1) { console.error(`  write failed (${colors.join('+')}) id=${ids[0]}: ${r.status} ${txt}`); failed++; return }
  const mid = Math.ceil(ids.length / 2)
  await writeChunk(colors, ids.slice(0, mid))
  await writeChunk(colors, ids.slice(mid))
}

for (const [key, ids] of bySet) {
  const colors = key.split('|')
  for (let i = 0; i < ids.length; i += CHUNK) await writeChunk(colors, ids.slice(i, i + CHUNK))
}
console.log(`\nwrote ${written} pieces; ${failed} failed`)
process.exit(failed ? 1 : 0)
