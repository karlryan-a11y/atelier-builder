#!/usr/bin/env node
/**
 * copy-look-thumbnails — copy gp_looks.thumbnail_url base64 pictures into R2.
 *
 * gp_looks.thumbnail_url holds a base64 data: URL per builder look (~641 rows, ~199 MB).
 * This copies each one to R2 at looks/thumbs/<look id>.jpg so it can later be served
 * by key instead of inline. It NEVER modifies the database row (thumbnail_url is left
 * exactly as it is) and NEVER overwrites an existing R2 object (HEAD before every PUT).
 *
 * FORMAT CHOICE: the key always ends in .jpg and the object is always a real JPEG.
 *   - image/jpeg data URLs are copied byte for byte (no re-encode, no quality loss).
 *   - any other image type (png, webp, ...) is re-encoded with sharp to JPEG quality 85,
 *     flattened onto white (look PNGs can be transparent). Logged as reencoded:true.
 *   So the name never lies about the bytes and readers need no type lookup.
 *
 * Memory: thumbnail_url is never selected for all rows at once. Candidate ids come
 * from a cheap id-only query; the pictures are fetched 25 rows per request.
 *
 * DEFAULT IS A DRY RUN (decodes and measures, uploads nothing). --write uploads,
 * after a 10-second countdown. Resumable via the JSONL --log (ids logged as
 * built/exists are skipped). Undo: --undo-from-log <file> deletes exactly the keys
 * that log records as `built` by --write (dry run unless --write).
 *
 * Usage:
 *   node scripts/copy-look-thumbnails.mjs --log ./look-thumbs.jsonl            # dry run
 *   node scripts/copy-look-thumbnails.mjs --log ./look-thumbs.jsonl --write
 *   node scripts/copy-look-thumbnails.mjs --undo-from-log ./look-thumbs.jsonl [--write]
 */
import { createClient } from '@supabase/supabase-js'
import { S3Client, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { DERIVED_CACHE_CONTROL } from '../lib/derivative.mjs'

const SCRIPT = 'copy-look-thumbnails'
const PREFIX = 'looks/thumbs/'
const PAGE = 25
const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null }
if (has('--force')) { console.error('--force does not exist: this script never overwrites.'); process.exit(2) }
const WRITE = has('--write')
const UNDO = val('--undo-from-log')
const LOG = val('--log') ?? './look-thumbs.jsonl'

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
  region: 'auto', endpoint: r2Env.R2_ENDPOINT,
  credentials: { accessKeyId: r2Env.R2_ACCESS_KEY_ID, secretAccessKey: r2Env.R2_SECRET_ACCESS_KEY },
})
const BUCKET = r2Env.R2_BUCKET_NAME

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function retry(fn, label, tries = 4) {
  for (let a = 0; ; a++) {
    try { return await fn() } catch (e) {
      if (a >= tries - 1 || e?.$metadata?.httpStatusCode === 404) throw e
      await sleep(500 * 2 ** a)
      if (a === tries - 2) console.warn(`  retrying ${label}: ${e.message}`)
    }
  }
}
const logLine = (o) => fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), script: SCRIPT, ...o }) + '\n')
async function countdown(what) {
  console.log(`\n*** WRITE MODE: ${what}. Ctrl-C now to abort. ***`)
  for (let s = 10; s > 0; s--) { process.stdout.write(`  ${s}… `); await sleep(1000) }
  console.log('\n')
}
async function headExists(key) {
  try { await retry(() => s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })), `HEAD ${key}`); return true }
  catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return false
    throw e // unknown: never assume absent
  }
}
async function q(build, label) {
  return retry(async () => { const r = await build(); if (r.error) throw new Error(r.error.message); return r }, label)
}

// ---------- undo ----------
if (UNDO) {
  const lines = fs.readFileSync(UNDO, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const built = [...new Set(lines.filter((l) => l.script === SCRIPT && l.mode === 'write' && l.status === 'built' && l.key?.startsWith(PREFIX)).map((l) => l.key))]
  const gone = new Set(lines.filter((l) => l.script === SCRIPT && l.status === 'deleted').map((l) => l.key))
  const todo = built.filter((k) => !gone.has(k))
  console.log(`keys logged as built : ${built.length}\nwould delete         : ${todo.length}`)
  for (const k of todo.slice(0, 5)) console.log(`  e.g. ${k}`)
  if (!WRITE) { console.log('\nDRY RUN: nothing deleted. Add --write to delete exactly these keys.'); process.exit(0) }
  await countdown(`deleting ${todo.length} objects from ${BUCKET}`)
  for (const k of todo) {
    await retry(() => s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: k })), `DELETE ${k}`)
    fs.appendFileSync(UNDO, JSON.stringify({ ts: new Date().toISOString(), script: SCRIPT, mode: 'write', key: k, status: 'deleted' }) + '\n')
  }
  console.log(`deleted ${todo.length}`)
  process.exit(0)
}

const t0 = Date.now()

// ---------- cheap counts + candidate ids (no thumbnail bytes) ----------
const { count: nonNull } = await q(() => db.from('gp_looks').select('id', { count: 'exact', head: true }).not('thumbnail_url', 'is', null), 'count non-null')
const { count: dataCount } = await q(() => db.from('gp_looks').select('id', { count: 'exact', head: true }).like('thumbnail_url', 'data:%'), 'count data:')
const { count: emptyCount } = await q(() => db.from('gp_looks').select('id', { count: 'exact', head: true }).eq('thumbnail_url', ''), 'count empty')
const ids = []
for (let from = 0; ; from += 1000) {
  const { data } = await q(() => db.from('gp_looks').select('id').like('thumbnail_url', 'data:%').order('id', { ascending: true }).range(from, from + 999), `ids ${from}`)
  ids.push(...data.map((r) => r.id))
  if (data.length < 1000) break
}
const nonData = (nonNull ?? 0) - (dataCount ?? 0) - (emptyCount ?? 0)

// existing objects under looks/thumbs/
const existing = new Set()
let token
do {
  const r = await retry(() => s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token })), 'LIST')
  for (const o of r.Contents ?? []) existing.add(o.Key)
  token = r.IsTruncated ? r.NextContinuationToken : undefined
} while (token)

const done = new Set()
if (fs.existsSync(LOG)) for (const l of fs.readFileSync(LOG, 'utf8').split('\n')) {
  if (!l) continue
  try { const o = JSON.parse(l); if (o.key && (o.status === 'built' || o.status === 'exists')) done.add(o.key) } catch {}
}

if (WRITE) await countdown(`uploading up to ${ids.length} thumbnails to ${BUCKET}/${PREFIX}`)

const c = { rows: 0, decodedBytes: 0, outBytes: 0, jpeg: 0, reencode: 0, exists: 0, loggedDone: 0, wouldWrite: 0, built: 0, bad: 0, failed: 0, types: {} }
for (let i = 0; i < ids.length; i += PAGE) {
  const chunk = ids.slice(i, i + PAGE)
  const { data } = await q(() => db.from('gp_looks').select('id, thumbnail_url').in('id', chunk).order('id', { ascending: true }), `page ${i}`)
  for (const row of data) {
    c.rows++
    const key = `${PREFIX}${row.id}.jpg`
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(row.thumbnail_url ?? '')
    if (!m || !m[2]) { c.bad++; logLine({ mode: WRITE ? 'write' : 'dry-run', id: row.id, key, status: 'failed', error: 'not a base64 data URL' }); continue }
    const mime = (m[1] || 'application/octet-stream').toLowerCase()
    c.types[mime] = (c.types[mime] ?? 0) + 1
    const bytes = Buffer.from(m[3], 'base64')
    c.decodedBytes += bytes.length
    const isJpeg = mime === 'image/jpeg' || mime === 'image/jpg'
    if (isJpeg) c.jpeg++; else c.reencode++
    if (existing.has(key)) { c.exists++; continue }
    if (done.has(key)) { c.loggedDone++; continue }
    c.wouldWrite++
    if (!WRITE) continue
    const s = Date.now()
    try {
      const body = isJpeg ? bytes : await sharp(bytes).flatten({ background: '#ffffff' }).jpeg({ quality: 85, mozjpeg: true }).toBuffer()
      if (await headExists(key)) { c.exists++; logLine({ mode: 'write', id: row.id, key, status: 'exists' }); continue }
      await retry(() => s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: 'image/jpeg', CacheControl: DERIVED_CACHE_CONTROL })), `PUT ${key}`)
      c.built++; c.outBytes += body.length
      logLine({ mode: 'write', id: row.id, key, status: 'built', srcType: mime, bytesIn: bytes.length, bytesOut: body.length, reencoded: !isJpeg, ms: Date.now() - s })
    } catch (e) {
      c.failed++
      logLine({ mode: 'write', id: row.id, key, status: 'failed', error: String(e?.message ?? e).slice(0, 300) })
      console.warn(`  ! ${row.id}: ${e?.message}`)
    }
  }
}

const mb = (n) => (n / 1024 / 1024).toFixed(1)
const summary = [
  `mode                          : ${WRITE ? 'WRITE' : 'DRY RUN'}`,
  `rows with thumbnail_url       : ${nonNull}`,
  `  data: URLs                  : ${dataCount}  (ids paged: ${ids.length}, rows decoded: ${c.rows})`,
  `  non-data (http etc.)        : ${nonData}   (counted, not copied)`,
  `  empty string                : ${emptyCount}`,
  `data: types                   : ${JSON.stringify(c.types)}`,
  `  copied byte-for-byte (jpeg) : ${c.jpeg}`,
  `  re-encode to jpeg q85       : ${c.reencode}`,
  `  malformed data: URLs        : ${c.bad}`,
  `total decoded bytes           : ${c.decodedBytes} (${mb(c.decodedBytes)} MB)`,
  `already in R2 at ${PREFIX}<id>.jpg : ${c.exists}   (objects listed under prefix: ${existing.size})`,
  `already done per log          : ${c.loggedDone}`,
  `${WRITE ? 'uploaded' : 'WOULD WRITE'}                   : ${WRITE ? `${c.built} (${mb(c.outBytes)} MB), failed ${c.failed}` : c.wouldWrite}`,
  `runtime                       : ${((Date.now() - t0) / 1000).toFixed(1)}s`,
]
console.log(summary.join('\n'))
logLine({ type: 'summary', mode: WRITE ? 'write' : 'dry-run', nonNull, dataCount, nonData, emptyCount, ...c })
if (!WRITE) console.log('\nDRY RUN: nothing written to R2 and no database row touched. Add --write to upload.')
