#!/usr/bin/env node
/**
 * backfill-derivatives — build the small copy for EVERY look and piece that lacks one.
 *
 * WHY THIS EXISTS
 * generate-look-derivatives.mjs covered published looks only, skipped drafts, and
 * skipped any source narrower than its target, so those derived keys never existed
 * and every tile that asked for one paid a 404 and then loaded the original. This
 * pass covers drafts too, re-encodes narrow sources at their own size (the shared
 * makeDerivative does that), and finds what already exists by LISTING derived/ once
 * instead of ~100k HeadObjects.
 *
 * SAFETY
 * - DEFAULT IS A DRY RUN. Writing needs --write, and then waits 10 seconds first.
 * - Never overwrites: a key present in the listing is skipped, and every key is
 *   HEADed again immediately before its PUT. There is no --force.
 * - Resumable: every processed key is appended to the JSONL log (--log). On start,
 *   keys the log already records as built/exists are skipped.
 * - Undo: --undo-from-log <file> deletes exactly the keys that log records as
 *   `built` by a --write run of this script. Dry run by default; --write to delete.
 *
 * KEY RULES (must match the readers; see lib/derivative.mjs and
 * atelier-looks src/lib/supabase.ts `derivedKeyFor` / `lookR2Key`)
 * - Look: raw.main_image_r2_key, else the `key` param of an image-proxy
 *   raw.main_image_url; a goodpix-co.s3.amazonaws.com/<path> URL maps to
 *   goodpix/<path>. Width 760. Archived or transitioned looks are out.
 * - Piece: source 'intake_pipeline' -> processed_image_hash ?? primary_image_hash;
 *   otherwise raw.processed_image ?? raw.image ?? raw.images[0] mapped the same way.
 *   Width 400. Deleted or transitioned pieces are out.
 * - Keys already under derived/ are never targets.
 *
 * Usage:
 *   node scripts/backfill-derivatives.mjs --log ./derivatives-backfill.jsonl            # dry run
 *   node scripts/backfill-derivatives.mjs --log ./derivatives-backfill.jsonl --sample 5 --out ./samples
 *   node scripts/backfill-derivatives.mjs --log ./derivatives-backfill.jsonl --write [--concurrency 4]
 *   node scripts/backfill-derivatives.mjs --undo-from-log ./derivatives-backfill.jsonl  # dry run of undo
 *   node scripts/backfill-derivatives.mjs --undo-from-log ./derivatives-backfill.jsonl --write
 * Options: --only looks|pieces   --limit N (cap targets processed in write mode)
 *          --would-write <file>  (default: <log>.would-write.txt)
 */
import { createClient } from '@supabase/supabase-js'
import {
  S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand,
  ListObjectsV2Command, DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import fs from 'node:fs'
import path from 'node:path'
import {
  LOOK_WIDTH, ITEM_WIDTH, derivedKey, makeDerivative, DERIVED_CACHE_CONTROL,
} from '../lib/derivative.mjs'

const SCRIPT = 'backfill-derivatives'
const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null }
if (has('--force')) { console.error('--force does not exist: this script never overwrites.'); process.exit(2) }
const WRITE = has('--write')
const SAMPLE = val('--sample') ? Number(val('--sample')) : 0
const OUT = val('--out')
const UNDO = val('--undo-from-log')
const ONLY = val('--only')
const LIMIT = val('--limit') ? Number(val('--limit')) : Infinity
const CONCURRENCY = Math.min(8, Math.max(1, Number(val('--concurrency') ?? 4)))
const LOG = val('--log') ?? './derivatives-backfill.jsonl'
const WOULD = val('--would-write') ?? `${LOG}.would-write.txt`
if (SAMPLE && !OUT) { console.error('--sample needs --out <local dir>'); process.exit(2) }
if (SAMPLE && WRITE) { console.error('--sample only writes locally; do not combine with --write'); process.exit(2) }

// ---------- env (same loader as generate-look-derivatives.mjs) ----------
function loadEnv(file) {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const i = line.indexOf('=')
    if (i < 0 || line.trim().startsWith('#')) continue
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}
const here = path.dirname(new URL(import.meta.url).pathname)
const builderEnv = loadEnv(path.join(here, '..', '.env.local'))
const r2Env = loadEnv(path.join(process.env.HOME, 'wsg-intake-pipeline', '.env.local'))
const SUPABASE_URL = builderEnv.VITE_SUPABASE_URL
const SERVICE_KEY = builderEnv.SUPABASE_SERVICE_ROLE_KEY
for (const [k, v] of Object.entries({ SUPABASE_URL, SERVICE_KEY, R2_ENDPOINT: r2Env.R2_ENDPOINT, R2_BUCKET_NAME: r2Env.R2_BUCKET_NAME })) {
  if (!v) { console.error(`missing ${k}`); process.exit(1) }
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const s3 = new S3Client({
  region: 'auto',
  endpoint: r2Env.R2_ENDPOINT,
  credentials: { accessKeyId: r2Env.R2_ACCESS_KEY_ID, secretAccessKey: r2Env.R2_SECRET_ACCESS_KEY },
})
const BUCKET = r2Env.R2_BUCKET_NAME

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function retry(fn, label, tries = 4) {
  for (let a = 0; ; a++) {
    try { return await fn() } catch (e) {
      const status = e?.$metadata?.httpStatusCode
      if (a >= tries - 1 || status === 404 || e?.name === 'NoSuchKey' || e?.permanent) throw e
      await sleep(500 * 2 ** a)
      if (a === tries - 2) console.warn(`  retrying ${label}: ${e.message}`)
    }
  }
}
const logLine = (obj) => fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), script: SCRIPT, ...obj }) + '\n')
async function countdown(what) {
  console.log(`\n*** WRITE MODE: ${what}. Ctrl-C now to abort. ***`)
  for (let s = 10; s > 0; s--) { process.stdout.write(`  ${s}… `); await sleep(1000) }
  console.log('\n')
}
async function headExists(key) {
  try { await retry(() => s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })), `HEAD ${key}`); return true }
  catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return false
    throw e // unknown: do NOT treat as absent (that could lead to an overwrite)
  }
}

// ---------- undo ----------
if (UNDO) {
  const lines = fs.readFileSync(UNDO, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const built = [...new Set(lines.filter((l) => l.script === SCRIPT && l.mode === 'write' && l.status === 'built' && l.dk?.startsWith('derived/')).map((l) => l.dk))]
  const undone = new Set(lines.filter((l) => l.script === SCRIPT && l.status === 'deleted').map((l) => l.dk))
  const todo = built.filter((k) => !undone.has(k))
  console.log(`undo source log        : ${UNDO}`)
  console.log(`keys logged as built   : ${built.length}`)
  console.log(`already deleted (log)  : ${built.length - todo.length}`)
  console.log(`would delete           : ${todo.length}`)
  for (const k of todo.slice(0, 5)) console.log(`  e.g. ${k}`)
  if (!WRITE) { console.log('\nDRY RUN: nothing deleted. Add --write to delete exactly these keys.'); process.exit(0) }
  await countdown(`deleting ${todo.length} derived objects from ${BUCKET}`)
  let n = 0
  for (const k of todo) {
    await retry(() => s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: k })), `DELETE ${k}`)
    fs.appendFileSync(UNDO, JSON.stringify({ ts: new Date().toISOString(), script: SCRIPT, mode: 'write', dk: k, status: 'deleted' }) + '\n')
    if (++n % 500 === 0) console.log(`  deleted ${n}/${todo.length}`)
  }
  console.log(`deleted ${n}`)
  process.exit(0)
}

// ---------- read DB ----------
const t0 = Date.now()
async function page(table, select, filters) {
  const out = []
  for (let from = 0; ; from += 1000) {
    // Always order by the primary key: .range() without ORDER BY is not a stable cursor.
    let q = db.from(table).select(select).order('id', { ascending: true }).range(from, from + 999)
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v)
    const { data, error } = await retry(async () => {
      const r = await q
      if (r.error) throw new Error(r.error.message)
      return r
    }, `${table} page ${from}`)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data?.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

function keyFromProxyUrl(url) {
  try { const k = new URL(url).searchParams.get('key'); return k ? decodeURIComponent(k) : null } catch { return null }
}
/** { key, kind: 'ours'|'goodpix', srcUrl? } or { foreign: true } or null (no image). */
function sourceForUrl(url) {
  if (!url) return null
  if (url.includes('/functions/v1/image-proxy')) {
    const key = keyFromProxyUrl(url)
    return key ? { key, kind: 'ours' } : { foreign: true }
  }
  if (url.includes('goodpix-co.s3.amazonaws.com')) {
    try {
      const file = new URL(url).pathname.replace(/^\/+/, '')
      if (!file) return { foreign: true }
      return { key: `goodpix/${file}`, kind: 'goodpix', srcUrl: `https://goodpix-co.s3.amazonaws.com/${file}` }
    } catch { return { foreign: true } }
  }
  return { foreign: true }
}

const looksAll = ONLY === 'pieces' ? [] : await page('gp_looks', 'id, raw, archived, transitioned_at, published', {})
const looks = looksAll.filter((l) => !l.archived && !l.transitioned_at)
const itemsAll = ONLY === 'looks' ? [] : await page('gp_closet_items', 'id, raw, is_deleted, transitioned_at, source, primary_image_hash, processed_image_hash', { is_deleted: false })
const items = itemsAll.filter((i) => !i.transitioned_at)
const tDb = Date.now()

// ---------- targets ----------
const stats = {
  looks: { published: { has: 0, missing: 0 }, draft: { has: 0, missing: 0 }, noImage: 0, foreign: 0, alreadyDerivedKey: 0 },
  pieces: { intake: { has: 0, missing: 0 }, goodpix: { has: 0, missing: 0 }, other: { has: 0, missing: 0 }, noImage: 0, foreign: 0, alreadyDerivedKey: 0 },
}
const foreignExamples = []
const byDk = new Map() // dk -> target (collapsed)
let rowsWithTarget = 0
function addTarget(row, kind, cat, src, width) {
  if (src.key.startsWith('derived/')) { stats[kind].alreadyDerivedKey++; return null }
  const dk = derivedKey(src.key, width)
  rowsWithTarget++
  if (!byDk.has(dk)) byDk.set(dk, { dk, key: src.key, srcKind: src.kind, srcUrl: src.srcUrl, width, kind, cat, rows: [] })
  byDk.get(dk).rows.push(row.id)
  return dk
}

const rowTargets = [] // {kind, cat, dk}
for (const l of looks) {
  const cat = l.published ? 'published' : 'draft'
  const r2 = l.raw?.main_image_r2_key
  let src
  if (r2) src = { key: r2, kind: 'ours' }
  else src = sourceForUrl(l.raw?.main_image_url)
  if (!src) { stats.looks.noImage++; continue }
  if (src.foreign) { stats.looks.foreign++; if (foreignExamples.length < 5) foreignExamples.push(String(l.raw?.main_image_url).slice(0, 90)); continue }
  const dk = addTarget(l, 'looks', cat, src, LOOK_WIDTH)
  if (dk) rowTargets.push({ kind: 'looks', cat, dk })
}
for (const it of items) {
  let src, cat
  if (it.source === 'intake_pipeline') {
    const key = it.processed_image_hash ?? it.primary_image_hash
    if (!key) { stats.pieces.noImage++; continue }
    src = { key, kind: 'ours' }; cat = 'intake'
  } else {
    src = sourceForUrl(it.raw?.processed_image ?? it.raw?.image ?? it.raw?.images?.[0] ?? null)
    if (!src) { stats.pieces.noImage++; continue }
    if (src.foreign) { stats.pieces.foreign++; if (foreignExamples.length < 10) foreignExamples.push(String(it.raw?.processed_image ?? it.raw?.image ?? it.raw?.images?.[0]).slice(0, 90)); continue }
    cat = src.kind === 'goodpix' ? 'goodpix' : 'other'
  }
  const dk = addTarget(it, 'pieces', cat, src, ITEM_WIDTH)
  if (dk) rowTargets.push({ kind: 'pieces', cat, dk })
}

// ---------- list derived/ once ----------
async function listPrefix(prefix) {
  const set = new Set()
  let token
  do {
    const r = await retry(() => s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 })), `LIST ${prefix}`)
    for (const o of r.Contents ?? []) set.add(o.Key)
    token = r.IsTruncated ? r.NextContinuationToken : undefined
  } while (token)
  return set
}
const [set760, set400] = await Promise.all([
  ONLY === 'pieces' ? new Set() : listPrefix(`derived/w${LOOK_WIDTH}q82/`),
  ONLY === 'looks' ? new Set() : listPrefix(`derived/w${ITEM_WIDTH}q82/`),
])
const existing = new Set([...set760, ...set400])
const tList = Date.now()

for (const r of rowTargets) stats[r.kind][r.cat][existing.has(r.dk) ? 'has' : 'missing']++

// resume: keys the log already records as done
const done = new Set()
if (fs.existsSync(LOG)) {
  for (const l of fs.readFileSync(LOG, 'utf8').split('\n')) {
    if (!l) continue
    try { const o = JSON.parse(l); if (o.dk && (o.status === 'built' || o.status === 'exists')) done.add(o.dk) } catch {}
  }
}
const unique = [...byDk.values()]
const missing = unique.filter((t) => !existing.has(t.dk))
const todo = missing.filter((t) => !done.has(t.dk))

// ---------- summary ----------
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '-')
const L = stats.looks, P = stats.pieces
const lookRows = L.published.has + L.published.missing + L.draft.has + L.draft.missing
const lookMissing = L.published.missing + L.draft.missing
const pieceRows = P.intake.has + P.intake.missing + P.goodpix.has + P.goodpix.missing + P.other.has + P.other.missing
const pieceMissing = P.intake.missing + P.goodpix.missing + P.other.missing
const uLooks = unique.filter((t) => t.kind === 'looks'), uPieces = unique.filter((t) => t.kind === 'pieces')
const summary = [
  `mode                        : ${WRITE ? 'WRITE' : SAMPLE ? `SAMPLE ${SAMPLE} (local only)` : 'DRY RUN'}`,
  `looks read / live           : ${looksAll.length} / ${looks.length}   (archived or transitioned excluded)`,
  `pieces read / live          : ${itemsAll.length} / ${items.length}   (is_deleted=false; transitioned excluded)`,
  `derived objects listed      : w760 ${set760.size}, w400 ${set400.size}`,
  ``,
  `LOOKS @${LOOK_WIDTH} (rows)            has copy   missing`,
  `  published                 : ${String(L.published.has).padStart(7)}   ${String(L.published.missing).padStart(7)}`,
  `  draft                     : ${String(L.draft.has).padStart(7)}   ${String(L.draft.missing).padStart(7)}`,
  `  total                     : ${lookRows} rows, ${lookMissing} missing (${pct(lookMissing, lookRows)})`,
  `  no image / foreign source : ${L.noImage} / ${L.foreign}   (key already derived/: ${L.alreadyDerivedKey})`,
  ``,
  `PIECES @${ITEM_WIDTH} (rows)           has copy   missing`,
  `  intake (R2 key columns)   : ${String(P.intake.has).padStart(7)}   ${String(P.intake.missing).padStart(7)}`,
  `  goodpix URL               : ${String(P.goodpix.has).padStart(7)}   ${String(P.goodpix.missing).padStart(7)}`,
  `  other (our image-proxy)   : ${String(P.other.has).padStart(7)}   ${String(P.other.missing).padStart(7)}`,
  `  total                     : ${pieceRows} rows, ${pieceMissing} missing (${pct(pieceMissing, pieceRows)})`,
  `  no image / foreign source : ${P.noImage} / ${P.foreign}   (key already derived/: ${P.alreadyDerivedKey})`,
  ``,
  `rows with a target          : ${rowsWithTarget}`,
  `unique derived keys         : ${unique.length}  (duplicates collapsed: ${rowsWithTarget - unique.length})`,
  `unique keys missing         : ${missing.length}  (looks ${uLooks.filter((t) => !existing.has(t.dk)).length}, pieces ${uPieces.filter((t) => !existing.has(t.dk)).length})`,
  `  of which ours / goodpix   : ${missing.filter((t) => t.srcKind === 'ours').length} / ${missing.filter((t) => t.srcKind === 'goodpix').length}`,
  `already done per log        : ${missing.length - todo.length}`,
  `WOULD WRITE                 : ${todo.length}  -> list in ${WOULD}`,
  `timing                      : db ${((tDb - t0) / 1000).toFixed(1)}s, list ${((tList - tDb) / 1000).toFixed(1)}s`,
]
if (foreignExamples.length) summary.push(`foreign source examples     : ${foreignExamples.slice(0, 3).join(' | ')}`)
console.log(summary.join('\n'))
fs.writeFileSync(WOULD, todo.map((t) => `${t.dk}\t${t.srcKind}\t${t.kind}/${t.cat}\t${t.srcUrl ?? t.key}`).join('\n') + '\n')
logLine({ type: 'summary', mode: WRITE ? 'write' : SAMPLE ? 'sample' : 'dry-run', stats, rowsWithTarget, unique: unique.length, missing: missing.length, wouldWrite: todo.length, listed: { w760: set760.size, w400: set400.size } })

// ---------- source fetch ----------
async function fetchSource(t, range) {
  if (t.srcKind === 'ours') {
    try {
      const r = await retry(() => s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: t.key, Range: range })), `GET ${t.key}`)
      return Buffer.from(await r.Body.transformToByteArray())
    } catch (e) {
      if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null
      throw e
    }
  }
  const res = await retry(async () => {
    const r = await fetch(t.srcUrl, range ? { headers: { Range: range } } : undefined)
    if (r.status === 404 || r.status === 403) return r // GoodPix S3 answers 403 for a missing object
    if (!r.ok && r.status !== 206) throw new Error(`HTTP ${r.status}`)
    return r
  }, `GET ${t.srcUrl}`)
  if (res.status === 404 || res.status === 403) return null
  return Buffer.from(await res.arrayBuffer())
}

// ---------- sample mode ----------
if (SAMPLE) {
  const sharp = (await import('sharp')).default
  fs.mkdirSync(OUT, { recursive: true })
  const shuffled = [...todo].sort(() => Math.random() - 0.5)
  const groups = [
    shuffled.filter((t) => t.kind === 'looks' && t.srcKind === 'ours'),
    shuffled.filter((t) => t.kind === 'looks' && t.srcKind === 'goodpix'),
    shuffled.filter((t) => t.kind === 'pieces' && t.srcKind === 'ours'),
    shuffled.filter((t) => t.kind === 'pieces' && t.srcKind === 'goodpix'),
  ]
  // Look for a source narrower than its target by probing the first 64 KB of a few.
  let narrow = null
  for (const t of shuffled.slice(0, 40)) {
    try {
      const head = await fetchSource(t, 'bytes=0-65535')
      if (!head) continue
      const m = await sharp(head).metadata().catch(() => null)
      if (m?.width && m.width < t.width) { narrow = t; break }
    } catch {}
  }
  const picks = []
  if (narrow) picks.push(narrow)
  for (let g = 0; picks.length < SAMPLE && groups.some((x) => x.length); g = (g + 1) % groups.length) {
    const t = groups[g].shift()
    if (t && !picks.includes(t)) picks.push(t)
  }
  console.log(`\nSAMPLE (written only to ${OUT}; narrow source ${narrow ? 'found' : 'NOT found in 40 probes'})`)
  console.log('kind/cat         src     srcBytes  srcW  outBytes  outW  resized    ms  derived key')
  for (const t of picks) {
    const s = Date.now()
    try {
      const src = await fetchSource(t)
      if (!src) { console.log(`${(t.kind + '/' + t.cat).padEnd(16)} ${t.srcKind.padEnd(7)} missing-source  ${t.dk}`); continue }
      const d = await makeDerivative(src, t.width)
      const ms = Date.now() - s
      const file = path.join(OUT, t.dk.replace(/[\/]/g, '__'))
      fs.writeFileSync(file, d.buffer)
      const outMeta = await sharp(d.buffer).metadata()
      console.log(`${(t.kind + '/' + t.cat).padEnd(16)} ${t.srcKind.padEnd(7)} ${String(src.length).padStart(9)} ${String(d.srcWidth).padStart(5)} ${String(d.buffer.length).padStart(9)} ${String(outMeta.width).padStart(5)}  ${String(d.resized).padEnd(7)} ${String(ms).padStart(5)}  ${t.dk}`)
      logLine({ mode: 'sample', dk: t.dk, status: 'sampled', bytesIn: src.length, bytesOut: d.buffer.length, srcWidth: d.srcWidth, outWidth: outMeta.width, resized: d.resized, ms, file })
    } catch (e) { console.log(`${t.dk}  FAILED ${e.message}`) }
  }
  console.log(`\nruntime ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  process.exit(0)
}

if (!WRITE) {
  console.log(`\nDRY RUN: nothing written to R2. runtime ${((Date.now() - t0) / 1000).toFixed(1)}s. Add --write to build.`)
  process.exit(0)
}

// ---------- write mode ----------
const work = todo.slice(0, LIMIT)
await countdown(`building up to ${work.length} derivatives into ${BUCKET} (concurrency ${CONCURRENCY})`)
const c = { built: 0, exists: 0, failed: 0, 'missing-source': 0, bytesIn: 0, bytesOut: 0 }
const startedAt = Date.now()
async function buildOne(t) {
  const s = Date.now()
  try {
    if (await headExists(t.dk)) { c.exists++; logLine({ mode: 'write', dk: t.dk, status: 'exists', ms: Date.now() - s }); return }
    const src = await fetchSource(t)
    if (!src) { c['missing-source']++; logLine({ mode: 'write', dk: t.dk, status: 'missing-source', src: t.srcUrl ?? t.key, ms: Date.now() - s }); return }
    const d = await makeDerivative(src, t.width)
    // Re-HEAD right before the PUT: never overwrite something another writer made meanwhile.
    if (await headExists(t.dk)) { c.exists++; logLine({ mode: 'write', dk: t.dk, status: 'exists', ms: Date.now() - s }); return }
    await retry(() => s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: t.dk, Body: d.buffer, ContentType: 'image/jpeg', CacheControl: DERIVED_CACHE_CONTROL,
    })), `PUT ${t.dk}`)
    c.built++; c.bytesIn += src.length; c.bytesOut += d.buffer.length
    logLine({ mode: 'write', dk: t.dk, status: 'built', bytesIn: src.length, bytesOut: d.buffer.length, srcWidth: d.srcWidth, resized: d.resized, ms: Date.now() - s })
  } catch (e) {
    c.failed++
    logLine({ mode: 'write', dk: t.dk, status: 'failed', error: String(e?.message ?? e).slice(0, 300), ms: Date.now() - s })
    if (c.failed <= 20) console.warn(`  ! ${t.dk}: ${e?.message}`)
  }
  const n = c.built + c.exists + c.failed + c['missing-source']
  if (n % 250 === 0) {
    const rate = n / ((Date.now() - startedAt) / 60000)
    console.log(`  … ${n}/${work.length}  ${rate.toFixed(0)}/min  ~${((work.length - n) / Math.max(rate, 1)).toFixed(0)} min left`)
  }
}
let cursor = 0
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (cursor < work.length) await buildOne(work[cursor++])
}))
const mb = (n) => (n / 1024 / 1024).toFixed(1)
console.log(`\nbuilt ${c.built}  exists ${c.exists}  missing-source ${c['missing-source']}  failed ${c.failed}`)
console.log(`source ${mb(c.bytesIn)} MB -> derived ${mb(c.bytesOut)} MB   runtime ${((Date.now() - t0) / 60000).toFixed(1)} min`)
logLine({ type: 'run-end', mode: 'write', ...c })
