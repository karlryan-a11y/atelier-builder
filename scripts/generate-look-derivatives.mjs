#!/usr/bin/env node
/**
 * generate-look-derivatives — build small, correctly-sized copies of look images.
 *
 * WHY THIS EXISTS
 * Look images are baked at full canvas resolution: 2160x2160 PNGs, ~2.4 MB each.
 * Every surface served those originals no matter how small it drew them. Margaux
 * Ellery's residence tiles render at 340x340 and were pulling ~7 MB before they
 * could paint, so on a cold connection a tile sat blank for several seconds —
 * which is what Karl hit moments before screen-sharing her lookbook on a call.
 *
 * The fix is to stop shipping a 4.6-megapixel image into a 340px box. This script
 * writes a resized JPEG next to each original in R2, under a `derived/` prefix,
 * which the existing image-proxy already knows how to serve — no Edge Function
 * change, no schema change, no new infrastructure.
 *
 * DESIGN NOTES
 * - Only builder-baked looks are affected. Of 14,528 published looks, 288 carry
 *   image-proxy URLs (our R2); the rest are GoodPix-hosted and already modest.
 * - The derived key is a pure function of the original key and the width, so this
 *   script is IDEMPOTENT and the reader needs no lookup table: given the original
 *   URL you can compute the variant URL. See `derivedKey()` — the lookbook has the
 *   matching helper in src/lib/images.ts.
 * - Existing variants are skipped unless --force, so re-running is cheap.
 * - Readers must fall back to the original if a variant is missing, so a look
 *   created after the last run degrades to "slow" rather than "broken".
 *
 * Usage:
 *   node scripts/generate-look-derivatives.mjs                 # all published looks on R2
 *   node scripts/generate-look-derivatives.mjs --client <id>   # one client
 *   node scripts/generate-look-derivatives.mjs --dry-run
 *   node scripts/generate-look-derivatives.mjs --force         # rebuild existing variants
 */
import { createClient } from '@supabase/supabase-js'
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'

/** Widths worth building. 760 covers every tile we render today at 2x on retina. */
const WIDTHS = [760]
const QUALITY = 82

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null }
const DRY = has('--dry-run')
const FORCE = has('--force')
const CLIENT = val('--client')

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
// R2 credentials live with the intake pipeline, which owns the bucket.
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

/**
 * The variant's key, derived purely from the original key + width, so a reader can
 * compute it without a lookup. MUST stay in step with `derivedImageUrl` in the
 * lookbook's src/lib/images.ts.
 */
export const derivedKey = (key, width) => `derived/w${width}q${QUALITY}/${key}.jpg`

/** Pull the R2 key back out of an image-proxy URL. Returns null for foreign URLs. */
function keyFromProxyUrl(url) {
  if (!url || !url.includes('/functions/v1/image-proxy')) return null
  try {
    const k = new URL(url).searchParams.get('key')
    return k ? decodeURIComponent(k) : null
  } catch { return null }
}

async function exists(key) {
  try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return true }
  catch { return false }
}

async function page(table, select, filters) {
  const out = []
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select(select).range(from, from + 999)
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v)
    const { data, error } = await q
    if (error) { console.error(table, error.message); break }
    if (!data?.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

const looks = (await page('gp_looks', 'id, client_id, name, raw, archived, transitioned_at, published',
  CLIENT ? { client_id: CLIENT, published: true } : { published: true }))
  .filter((l) => !l.archived && !l.transitioned_at)

const targets = []
for (const l of looks) {
  const key = keyFromProxyUrl(l.raw?.main_image_url)
  if (key) targets.push({ id: l.id, name: l.name, key, url: l.raw.main_image_url })
}

console.log(`published looks considered : ${looks.length}`)
console.log(`on our R2 (image-proxy)     : ${targets.length}`)
console.log(`widths                      : ${WIDTHS.join(', ')}  quality ${QUALITY}`)
if (DRY) console.log('\nDRY RUN — nothing will be written.\n')

let built = 0, skipped = 0, failed = 0, srcBytes = 0, outBytes = 0

for (const [i, t] of targets.entries()) {
  for (const width of WIDTHS) {
    const dk = derivedKey(t.key, width)
    if (!FORCE && await exists(dk)) { skipped++; continue }
    if (DRY) { built++; continue }
    try {
      const res = await fetch(t.url)
      if (!res.ok) { failed++; console.warn(`  ! ${t.name}: source HTTP ${res.status}`); continue }
      const src = Buffer.from(await res.arrayBuffer())
      const img = sharp(src)
      const meta = await img.metadata()
      // Never upscale: a source already smaller than the target needs no variant.
      if ((meta.width ?? 0) <= width) { skipped++; continue }
      const out = await img
        .resize({ width, withoutEnlargement: true })
        .flatten({ background: '#ffffff' }) // look PNGs are transparent; JPEG needs a matte
        .jpeg({ quality: QUALITY, progressive: true, mozjpeg: true })
        .toBuffer()
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: dk, Body: out, ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      }))
      srcBytes += src.length; outBytes += out.length; built++
      if (built % 25 === 0) console.log(`  … ${built} built (${i + 1}/${targets.length})`)
    } catch (e) {
      failed++
      console.warn(`  ! ${t.name}: ${e.message}`)
    }
  }
}

console.log(`\nbuilt   : ${built}`)
console.log(`skipped : ${skipped} (already present or already small)`)
console.log(`failed  : ${failed}`)
if (built && outBytes) {
  const mb = (n) => (n / 1024 / 1024).toFixed(1)
  console.log(`\nsource  : ${mb(srcBytes)} MB`)
  console.log(`derived : ${mb(outBytes)} MB  (${(100 - (outBytes / srcBytes) * 100).toFixed(1)}% smaller)`)
  console.log(`average : ${Math.round(outBytes / built / 1024)} KB per image, was ${Math.round(srcBytes / built / 1024)} KB`)
}
