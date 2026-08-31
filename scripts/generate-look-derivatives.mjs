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

/** 760 covers a look tile at 2x on retina; 400 covers a collection tile at 2x.
 *  Each target asks for the one it is actually drawn at, rather than both. */
const LOOK_WIDTH = 760
const ITEM_WIDTH = 400
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

/**
 * The variant key for ANY image url, ours or GoodPix's.
 *
 * KEEP IN STEP WITH atelier-looks/src/lib/supabase.ts `derivedKeyFor`. The two
 * are a matched pair - this writes the object, that asks for it - and nothing
 * checks they agree. If they drift, every image 404s and the reader's onerror
 * quietly loads the full-size original instead: the page still works and weighs
 * ten times what it should, which is exactly how this stayed invisible before.
 *
 * The earlier version of this script only handled our own R2 and said the rest
 * were "GoodPix-hosted and already modest". Measured, they are 800x800 to
 * 1080x1080 - 2 to 4 MB of decoded memory each - and they are the majority:
 * 132 of the 178 images on Margaux Ellery's Looks page, and every one of the
 * 1,349 on Ashley Petras's Collection. That assumption is what took a client's
 * lookbook white on her phone.
 */
export function derivedKeyForUrl(url, width) {
  if (!url) return null
  if (url.includes('/functions/v1/image-proxy')) {
    const key = keyFromProxyUrl(url)
    if (!key || key.startsWith('derived/')) return null
    return derivedKey(key, width)
  }
  if (url.includes('goodpix-co.s3.amazonaws.com')) {
    try {
      const file = new URL(url).pathname.replace(/^\/+/, '')
      return file ? derivedKey(`goodpix/${file}`, width) : null
    } catch { return null }
  }
  return null
}

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

const items = await page('gp_closet_items', 'id, client_id, raw, is_deleted, transitioned_at',
  CLIENT ? { client_id: CLIENT, is_deleted: false } : { is_deleted: false })

const targets = []
for (const l of looks) {
  const url = l.raw?.main_image_url
  const dk = derivedKeyForUrl(url, LOOK_WIDTH)
  if (dk) targets.push({ id: l.id, name: l.name, dk, url, width: LOOK_WIDTH })
}
for (const it of items) {
  if (it.transitioned_at) continue
  const url = it.raw?.processed_image ?? it.raw?.image ?? it.raw?.images?.[0] ?? null
  const dk = derivedKeyForUrl(url, ITEM_WIDTH)
  if (dk) targets.push({ id: it.id, name: 'piece', dk, url, width: ITEM_WIDTH })
}

const ours = targets.filter((t) => t.url.includes('image-proxy')).length
console.log(`published looks considered : ${looks.length}`)
console.log(`collection items considered: ${items.length}`)
console.log(`images to build            : ${targets.length}  (${ours} ours, ${targets.length - ours} GoodPix)`)
console.log(`widths                     : looks ${LOOK_WIDTH}, items ${ITEM_WIDTH}  quality ${QUALITY}`)
if (DRY) console.log('\nDRY RUN — nothing will be written.\n')

let built = 0, skipped = 0, failed = 0, srcBytes = 0, outBytes = 0

/*
  CONCURRENCY. This ran one image at a time, which is fine for the 288 looks it
  was written for and useless for the 103,462 images it now has to cover: at the
  measured 29 a minute that is 59 hours. Sixteen at a time makes it a few hours,
  and every step is independent - fetch, resize, put - so there is nothing to
  coordinate beyond the counters.
*/
const CONCURRENCY = Number(val('--concurrency') ?? 16)

async function buildOne(t, i) {
  const width = t.width
  const dk = t.dk
  if (!FORCE && await exists(dk)) { skipped++; return }
  if (DRY) { built++; return }
  try {
    const res = await fetch(t.url)
    if (!res.ok) { failed++; if (failed < 20) console.warn(`  ! ${t.name}: source HTTP ${res.status}`); return }
    const src = Buffer.from(await res.arrayBuffer())
    const img = sharp(src)
    const meta = await img.metadata()
    // Never upscale: a source already smaller than the target needs no variant.
    if ((meta.width ?? 0) <= width) { skipped++; return }
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
    if (built % 250 === 0) {
      const done = built + skipped + failed
      const rate = done / ((Date.now() - startedAt) / 60000)
      const left = (targets.length - done) / Math.max(rate, 1)
      console.log(`  … ${done}/${targets.length}  ${rate.toFixed(0)}/min  ~${left.toFixed(0)} min left`)
    }
  } catch (e) {
    failed++
    if (failed < 20) console.warn(`  ! ${t.name}: ${e.message}`)
  }
}

const startedAt = Date.now()
let cursor = 0
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < targets.length) {
      const i = cursor++
      await buildOne(targets[i], i)
    }
  }),
)

console.log(`\nbuilt   : ${built}`)
console.log(`skipped : ${skipped} (already present or already small)`)
console.log(`failed  : ${failed}`)
if (built && outBytes) {
  const mb = (n) => (n / 1024 / 1024).toFixed(1)
  console.log(`\nsource  : ${mb(srcBytes)} MB`)
  console.log(`derived : ${mb(outBytes)} MB  (${(100 - (outBytes / srcBytes) * 100).toFixed(1)}% smaller)`)
  console.log(`average : ${Math.round(outBytes / built / 1024)} KB per image, was ${Math.round(srcBytes / built / 1024)} KB`)
}
