#!/usr/bin/env node
/**
 * Guard: a grid tile never downloads a full-size look or piece picture.
 *
 * Look pictures are 2160x2160 (~1.9 MB, ~18 MB decoded on an iPad); a tile draws them at a few
 * hundred px. Tiles go through <TileImage> (components/common/TileImage.tsx), which asks for the
 * derived/w760 (looks) or w400 (pieces) copy and falls back to the original on error.
 *
 * Checked:
 *   1. Every raw <img> under src/components whose src is a look or piece picture (an
 *      expression naming image / imageUrl / img / main_image_url / lookImageUrl /
 *      resolveItemImage / processed_image) is a FAILURE, unless the line or the one above it
 *      carries a `full-size:` comment saying why (canvas, editor, zoom, the original on request).
 *   2. derivedKeyFor/derivedImageUrl produce exactly the lookbook's URLs for our R2, GoodPix,
 *      and the builder's /img-proxy/ form; return null for foreign URLs, variants and blanks.
 *
 * Reports counts; exits non-zero at zero. ROOT=<dir> runs it on another tree.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(process.env.ROOT ?? '.')
const DIR = join(ROOT, 'src/components')
const SKIP = new Set(['intake', 'reconciliation', 'shopping', 'auth', 'feedback']) // not look/piece grids
const files = []
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) { if (!SKIP.has(n)) walk(p) } else if (n.endsWith('.tsx')) files.push(p) } }
if (existsSync(DIR)) walk(DIR)

const PICTURE = /\b(image|imageUrl|img|main_image_url|lookImageUrl|resolveItemImage|processed_image)\b/
const failures = []
let checked = 0, rawImgs = 0, tiles = 0, fullSize = 0
const ok = (name, cond, why) => { checked++; if (!cond) failures.push(`${name}: ${why}`) }

for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (/<TileImage\b/.test(line)) tiles++
    if (!/<img\b/.test(line)) return
    // src may be on this line or the next few (multi-line JSX).
    const block = lines.slice(i, i + 4).join(' ')
    const src = block.match(/\bsrc=\{([^}]*)\}/)?.[1] ?? ''
    if (!PICTURE.test(src)) return
    rawImgs++
    if (/full-size:/.test(line) || /full-size:/.test(lines[i - 1] ?? '')) { fullSize++; return }
    failures.push(`${relative(ROOT, f)}:${i + 1} <img src={${src.trim()}}> shows a full-size picture in a tile; use <TileImage>`)
  })
}
console.log(`check-tile-images: ${files.length} component files, ${tiles} <TileImage>, ${rawImgs} raw picture <img> (${fullSize} marked full-size)`)
ok('surfaces found', tiles + rawImgs > 0, 'found no look or piece images at all; the guard measured nothing')

const lib = join(ROOT, 'src/lib/derivedImage.ts')
let mod = null
if (existsSync(lib)) { try { mod = await import(pathToFileURL(lib).href) } catch (e) { failures.push(`import derivedImage.ts: ${e.message}`) } }
ok('derivative helper exists', typeof mod?.derivedImageUrl === 'function', 'src/lib/derivedImage.ts#derivedImageUrl not found')
if (mod?.derivedImageUrl) {
  const B = 'https://lejwzpwntjaleqgrcakq.supabase.co'
  // Rows hold the image-proxy spelling; a tile must load the variant from the CACHED photo path
  // (atelierbywatson.com/img/<key>, lib/imageUrls.ts). The Supabase function answered every
  // tile uncached at 400-580 ms (measured 2026-09-19).
  const px = (k) => `${B}/functions/v1/image-proxy?key=${encodeURIComponent(k)}`
  const cdn = (k) => `https://atelierbywatson.com/img/${k.split('/').map(encodeURIComponent).join('/')}`
  const cases = [
    ['our R2 look', px('looks/abc/image-1.png'), 760, cdn('derived/w760q82/looks/abc/image-1.png.jpg')],
    ['our R2 look, photo-path spelling', cdn('looks/abc/image-1.png'), 760, cdn('derived/w760q82/looks/abc/image-1.png.jpg')],
    ['dead R2 host spelling', 'https://images.atelierbywatson.com/intake/ai/i1/p-1.png', 400, cdn('derived/w400q82/intake/ai/i1/p-1.png.jpg')],
    ['GoodPix look', 'https://goodpix-co.s3.amazonaws.com/ab12cd.jpg', 760, cdn('derived/w760q82/goodpix/ab12cd.jpg.jpg')],
    ['builder /img-proxy/ form', '/img-proxy/ab12cd.jpg', 400, cdn('derived/w400q82/goodpix/ab12cd.jpg.jpg')],
    ['intake piece', px('intake/c1/p1-processed.png'), 400, cdn('derived/w400q82/intake/c1/p1-processed.png.jpg')],
    ['already a variant', px('derived/w760q82/looks/abc/image-1.png.jpg'), 760, null],
    ['already a variant, photo path', cdn('derived/w760q82/looks/abc/image-1.png.jpg'), 760, null],
    ['foreign URL', 'https://example.com/x.jpg', 760, null],
    ['data URL', 'data:image/jpeg;base64,AAAA', 760, null],
    ['blank', '', 760, null],
  ]
  for (const [name, url, w, want] of cases) {
    const got = mod.derivedImageUrl(url, w)
    ok(`derived URL: ${name}`, got === want, `expected ${want}, got ${got}`)
  }
}

console.log(`check-tile-images: ${checked} checks exercised`)
if (failures.length) {
  console.error(`FAIL - ${failures.length}:`)
  for (const x of failures) console.error('  - ' + x)
  process.exit(1)
}
console.log('PASS - every look and piece tile asks for the small copy first; full size only where marked.')
