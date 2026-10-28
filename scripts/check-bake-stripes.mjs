#!/usr/bin/env node
/**
 * A STRIPED PIECE SHRUNK ON THE BOARD BAKES WITH STRAIGHT, EVEN STRIPES, IN A REAL BROWSER.
 *
 * Cynthia Dada, 2026-10-20, Mr. C's Dior shirt: "Is there a way to make it so that stripe patterns
 * don't look warped when the garment is smaller?" A browser shrinks a photo in one step without
 * averaging the pixels it skips, so a stripe at a quarter size comes out uneven, and in Safari a
 * pinstripe folds into fake wide stripes. Measured before this check existed, on today's bake:
 * Safari off by 4 to 35 levels on stripes at 15 to 35%, and sparkle on plain wool (2.6x the
 * detail a proper shrink has).
 *
 * This bakes one board through the REAL render page (dist/render.html -> render/composite.ts, the
 * same draw path as a stylist Save) in Chromium AND WebKit, and compares every piece with an exact
 * area-average shrink of its own photo, computed here independently:
 *   1. Stripes (wide, medium and pin, at 15 to 35%): no fake stripes. The baked piece has no stripe
 *      pattern that the shirt itself does not have (shift-proof, so a half-pixel offset does not
 *      count, and a crisper or softer edge on the real stripes does not count either).
 *   2. A plain wool piece is not blurred (detail at least 0.9 of the proper shrink) and has no
 *      sparkle (at most 1.35).
 *   3. Nothing moved: every piece's box lands where it did.
 *
 * Needs a built dist/ (npm run build) and Playwright's browsers. Run: npm run check:bake-stripes
 * Exits non-zero on any failure and on inspecting nothing (ADR-0106).
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const distFlag = process.argv.indexOf('--dist')
const DIST = distFlag > 0 ? process.argv[distFlag + 1] : join(ROOT, 'dist')
if (!existsSync(join(DIST, 'render.html'))) { console.error('check-bake-stripes: no dist/render.html. Run npm run build first.'); process.exit(1) }

let pw
// `--playwright <path>` may point at another checkout's copy (wsg-dashboard/node_modules/@playwright/test/index.js).
const flag = process.argv.indexOf('--playwright')
for (const name of [flag > 0 ? process.argv[flag + 1] : null, 'playwright', '@playwright/test'].filter(Boolean)) {
  try { const m = await import(name); pw = m.chromium ? m : m.default; break } catch { /* try the next */ }
}
if (!pw) { console.error('check-bake-stripes: Playwright is not installed here, so nothing was measured.'); process.exit(1) }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' }
const server = createServer(async (req, res) => {
  const path = join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  try { const body = await readFile(path); res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' }); res.end(body) }
  catch { res.writeHead(404); res.end() }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

// Every piece photo is 1000x1400, like a cut-out garment photo. period = source pixels per stripe.
const PIECES = [
  { id: 'wide28', kind: 'stripe', period: 24, scale: 0.28, x: 20, y: 20 },
  { id: 'mid28', kind: 'stripe', period: 14, scale: 0.28, x: 320, y: 20 },
  { id: 'pin28', kind: 'stripe', period: 9, scale: 0.28, x: 620, y: 20 },
  { id: 'pin20', kind: 'stripe', period: 6, scale: 0.2, x: 20, y: 440 },
  { id: 'wide15', kind: 'stripe', period: 24, scale: 0.15, x: 260, y: 440 },
  { id: 'mid35', kind: 'stripe', period: 14, scale: 0.35, x: 430, y: 440 },
  { id: 'wool28', kind: 'wool', scale: 0.28, x: 790, y: 440 },
]
const STRIPE_LIMIT = 3
const WOOL_MIN = 0.9, WOOL_MAX = 1.35

// Runs in the page: make the photos, bake through window.__atelierRender, measure.
async function bakeAndMeasure({ pieces }) {
  const NW = 1000, NH = 1400, PR = 2
  const photos = {}
  for (const p of pieces) {
    const c = document.createElement('canvas'); c.width = NW; c.height = NH
    const ctx = c.getContext('2d'); const im = ctx.createImageData(NW, NH); const d = im.data
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let y = 0; y < NH; y++) for (let x = 0; x < NW; x++) {
      const i = (y * NW + x) * 4
      let c3
      if (p.kind === 'stripe') c3 = (x % p.period) < p.period / 2 ? [60, 80, 165] : [250, 250, 252]
      else { const g = (rnd() - 0.5) * 60; const v = (x > 300 + y * 0.3 && x < 330 + y * 0.3) ? 30 : 95; c3 = [v + g * 0.6, v + 8 + g * 0.6, v + 30 + g] }
      d[i] = c3[0]; d[i + 1] = c3[1]; d[i + 2] = c3[2]; d[i + 3] = 255
    }
    ctx.putImageData(im, 0, 0)
    photos[p.id] = { url: c.toDataURL('image/png'), px: d }
  }
  const canvasState = {
    version: 1, canvas: { width: 1080, height: 1080, background: '#ffffff' },
    nodes: pieces.map((p, z) => ({ id: p.id, type: 'closet_item', closet_item_id: p.id, x: p.x, y: p.y, scale: p.scale, rotation: 0, flipped: false, z_index: z, locked: false })),
  }
  const imageUrls = Object.fromEntries(pieces.map((p) => [p.id, photos[p.id].url]))
  const t0 = performance.now()
  const out = await window.__atelierRender({ kind: 'canvas', canvasState, imageUrls, pixelRatio: PR })
  console.log(`bake took ${Math.round(performance.now() - t0)} ms for ${pieces.length} pieces`)
  const img = new Image(); await new Promise((r) => { img.onload = r; img.src = 'data:image/png;base64,' + out.pngBase64 })
  const bc = document.createElement('canvas'); bc.width = img.width; bc.height = img.height
  const bctx = bc.getContext('2d'); bctx.drawImage(img, 0, 0)
  const board = bctx.getImageData(0, 0, bc.width, bc.height)

  const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
  // Exact area average: every output pixel is the mean of the source area it covers.
  function areaShrink(src, sw, sh, w, h) {
    const tmp = new Float64Array(w * sh), out = new Float64Array(w * h)
    const fx = sw / w, fy = sh / h
    for (let y = 0; y < sh; y++) for (let x = 0; x < w; x++) {
      const a = x * fx, b = a + fx; let s = 0
      for (let k = Math.floor(a); k < Math.ceil(b); k++) s += lum(src, (y * sw + k) * 4) * (Math.min(b, k + 1) - Math.max(a, k))
      tmp[y * w + x] = s / fx
    }
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
      const a = y * fy, b = a + fy; let s = 0
      for (let k = Math.floor(a); k < Math.ceil(b); k++) s += tmp[k * w + x] * (Math.min(b, k + 1) - Math.max(a, k))
      out[y * w + x] = s / fy
    }
    return out
  }
  const results = []
  for (const p of pieces) {
    const w = Math.round(NW * p.scale * PR), h = Math.round(NH * p.scale * PR)
    const X = Math.round(p.x * PR), Y = Math.round(p.y * PR)
    const ref = areaShrink(photos[p.id].px, NW, NH, w, h)
    const got = new Float64Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) got[y * w + x] = lum(board.data, ((Y + y) * board.width + X + x) * 4)
    // Nothing moved: the piece's first and last columns are ink, the columns just outside are board.
    const colMean = (a, x, aw) => { let s = 0; for (let y = 10; y < h - 10; y++) s += a(y * aw + x); return s / (h - 20) }
    const outside = (dx) => { let s = 0; for (let y = 10; y < h - 10; y++) s += lum(board.data, ((Y + y) * board.width + X + dx) * 4); return s / (h - 20) }
    const placed = outside(-2) > 250 && outside(w + 1) > 250 && colMean((i) => got[i], 2, w) < 240
    let stripe = null, detail = null
    if (p.kind === 'stripe') {
      const prof = (a) => { const r = new Float64Array(w); for (let x = 0; x < w; x++) r[x] = colMean((i) => a[i], x, w); return r }
      const mag = (q) => { const N = q.length - 8, m = []; for (let k = 1; k < N / 2; k++) { let re = 0, im = 0; for (let x = 0; x < N; x++) { const t = 2 * Math.PI * k * x / N; re += q[x + 4] * Math.cos(t); im -= q[x + 4] * Math.sin(t) } m.push(Math.hypot(re, im) / N) } return m }
      // Fake stripes: pattern the baked piece has at frequencies where the shirt itself has none
      // (under 5% of its strongest stripe). A sharper or softer edge on the real stripes is not counted.
      const mg = mag(prof(got)), mr = mag(prof(ref))
      const peak = Math.max(...mr)
      stripe = Math.sqrt(mg.reduce((s, v, k) => s + (mr[k] < 0.05 * peak ? Math.max(0, v - mr[k]) ** 2 : 0), 0))
    } else {
      const lap = (a) => { let s = 0; for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) { const i = y * w + x; s += Math.abs(4 * a[i] - a[i - 1] - a[i + 1] - a[i - w] - a[i + w]) } return s }
      detail = lap(got) / lap(ref)
    }
    results.push({ id: p.id, w, h, placed, stripe, detail })
  }
  return results
}

const failures = []
let checked = 0
try {
  for (const type of [pw.chromium, pw.webkit]) {
    const browser = await type.launch()
    try {
      const page = await browser.newPage()
      await page.goto(`${base}/render.html`)
      await page.waitForFunction(() => window.__atelierRenderReady === true, null, { timeout: 30000 })
      page.on('console', (m) => { if (m.text().startsWith('bake took')) console.log(`  ${type.name()} ${m.text()}`) })
      const results = await page.evaluate(bakeAndMeasure, { pieces: PIECES })
      for (const r of results) {
        checked++
        const tag = `${type.name()} ${r.id}`
        if (!r.placed) failures.push(`${tag}: the piece is not where the board puts it.`)
        if (r.stripe !== null) {
          console.log(`  ${tag.padEnd(16)} fake stripes ${r.stripe.toFixed(2)} (limit ${STRIPE_LIMIT})`)
          if (!(r.stripe <= STRIPE_LIMIT)) failures.push(`${tag}: fake stripes the shirt does not have, ${r.stripe.toFixed(1)} (limit ${STRIPE_LIMIT}).`)
        } else {
          console.log(`  ${tag.padEnd(16)} wool detail ${r.detail.toFixed(2)} (between ${WOOL_MIN} and ${WOOL_MAX})`)
          if (!(r.detail >= WOOL_MIN)) failures.push(`${tag}: plain wool is blurred (detail ${r.detail.toFixed(2)} of a proper shrink).`)
          if (!(r.detail <= WOOL_MAX)) failures.push(`${tag}: plain wool sparkles (detail ${r.detail.toFixed(2)} of a proper shrink).`)
        }
      }
    } finally { await browser.close() }
  }
} finally { server.close() }

if (checked === 0) failures.push('Nothing was measured.')
if (failures.length) {
  console.error(`check-bake-stripes: ${failures.length} failed of ${checked} pieces measured:`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log(`check-bake-stripes: ${checked} pieces measured in Chromium and WebKit, all clean.`)
