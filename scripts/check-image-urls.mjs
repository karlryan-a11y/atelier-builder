#!/usr/bin/env node
/**
 * ONE PLACE BUILDS A PICTURE URL, and ONE definition of a small copy (2026-09-19, photo CDN).
 *
 * 1. Every screen loads our R2 pictures through the cached photo path
 *    (atelierbywatson.com/img/<key>), built only in src/lib/imageUrls.ts. A file that spells out
 *    the Supabase image-proxy function or the /img/ path itself skips the cache, and nobody
 *    notices: the picture still loads, at 400-580 ms a tile instead of a CDN hit. Fails if any
 *    file under src/ or api/ other than src/lib/imageUrls.ts contains:
 *      functions/v1/image-proxy  |  a string that starts "/img/"  |  PUBLIC_R2_DOMAIN / images.atelierbywatson.com
 *    Not scanned, on purpose: renderer/ (a separate Fly service that writes rows in the stored
 *    spelling) and scripts/ (maintenance tools, not screens).
 *
 * 2. The small-copy numbers agree everywhere they are written down: lib/derivative.mjs (the
 *    writer used on Save / approve / replace and by the backfill), src/lib/derivedImage.ts (the
 *    reader), and scripts/generate-look-derivatives.mjs (the original platform pass). A drift is a
 *    404 per picture that the fallback hides.
 *
 * A check that inspected nothing fails.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const HELPER = 'src/lib/imageUrls.ts'
// Server code that READS R2 through the function to build a small copy. Nothing it builds reaches
// a screen, so it is not a way around the cache. Named here so the exemption is visible.
const SERVER_READERS = new Set(['api/derive-image.ts'])
const EXT = /\.(tsx?|jsx?|mjs)$/
const problems = []

const RULES = [
  { re: /functions\/v1\/image-proxy/, why: 'builds an image-proxy URL; use r2ImageUrl() or storedProxyUrl() from lib/imageUrls' },
  { re: /['"`]\/img\//, why: 'builds a /img/ URL by hand; use r2ImageUrl() from lib/imageUrls' },
  { re: /PUBLIC_R2_DOMAIN|['"`]https:\/\/images\.atelierbywatson\.com/, why: 'uses the dead R2 host; use r2ImageUrl()' },
]

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (EXT.test(name)) out.push(p)
  }
  return out
}

const files = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'api'))]
let helperBuildsPath = false
for (const f of files) {
  const rel = relative(ROOT, f)
  const text = readFileSync(f, 'utf8')
  if (rel === HELPER) { helperBuildsPath = /\/img\//.test(text); continue }
  if (SERVER_READERS.has(rel)) continue
  text.split('\n').forEach((line, i) => {
    const code = line.replace(/^\s*(\/\/|\*).*$/, '') // a comment may name the function
    for (const r of RULES) if (r.re.test(code)) problems.push(`${rel}:${i + 1}: ${r.why}\n      ${line.trim().slice(0, 140)}`)
  })
}
if (files.length === 0) problems.push('inspected 0 files - measured nothing')
if (!helperBuildsPath) problems.push(`${HELPER}: missing, or does not build the /img/ path - there is no choke point`)

// 2. The numbers.
const num = (file, re) => {
  const p = join(ROOT, file)
  if (!existsSync(p)) return undefined
  const m = readFileSync(p, 'utf8').match(re)
  return m ? Number(m[1]) : undefined
}
const sides = {
  'lib/derivative.mjs': {
    look: num('lib/derivative.mjs', /LOOK_WIDTH\s*=\s*(\d+)/),
    item: num('lib/derivative.mjs', /ITEM_WIDTH\s*=\s*(\d+)/),
    q: num('lib/derivative.mjs', /QUALITY\s*=\s*(\d+)/),
  },
  'src/lib/derivedImage.ts': {
    look: num('src/lib/derivedImage.ts', /LOOK_TILE_WIDTH:\s*DerivedWidth\s*=\s*(\d+)/),
    item: num('src/lib/derivedImage.ts', /PIECE_TILE_WIDTH:\s*DerivedWidth\s*=\s*(\d+)/),
    q: num('src/lib/derivedImage.ts', /DERIVED_QUALITY\s*=\s*(\d+)/),
  },
  'scripts/generate-look-derivatives.mjs': {
    look: num('scripts/generate-look-derivatives.mjs', /LOOK_WIDTH\s*=\s*(\d+)/),
    item: num('scripts/generate-look-derivatives.mjs', /ITEM_WIDTH\s*=\s*(\d+)/),
    q: num('scripts/generate-look-derivatives.mjs', /QUALITY\s*=\s*(\d+)/),
  },
}
let numbersChecked = 0
const ref = sides['lib/derivative.mjs']
for (const [file, v] of Object.entries(sides)) {
  for (const k of ['look', 'item', 'q']) {
    if (v[k] === undefined) { problems.push(`${file}: could not read the ${k} number`); continue }
    numbersChecked++
    if (v[k] !== ref[k]) problems.push(`${file}: ${k} = ${v[k]}, but lib/derivative.mjs says ${ref[k]}`)
  }
}

console.log(`check-image-urls: ${files.length} files inspected, ${numbersChecked} small-copy numbers compared`)
if (problems.length) {
  console.error(`FAIL - ${problems.length}:`)
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log(`PASS - every R2 picture URL is built in ${HELPER}; small-copy sizes and quality agree in all three places.`)
