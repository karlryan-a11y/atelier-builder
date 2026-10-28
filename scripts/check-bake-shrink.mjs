#!/usr/bin/env node
/**
 * A SHRUNK PIECE BAKES FROM A PROPERLY SHRUNK PHOTO (lib/bakeShrink). Runs in every build.
 *
 * Cynthia Dada, 2026-10-20, Mr. C's Dior shirt: stripes warped when the shirt was small on the
 * board. The real-browser proof is scripts/check-bake-stripes.mjs (npm run check:bake-stripes,
 * needs Playwright); this is the cheap half that holds the shrink itself and its wiring:
 *   1. A striped shirt at 28% of its photo (x2 for the saved picture) shrinks with no fake stripes:
 *      it matches an exact area average of the same stripes within a few levels, and a one-step
 *      shrink that skips pixels (what a browser does) does not.
 *   2. A wide stripe keeps its full contrast (no blur).
 *   3. A cut-out's edge does not go dark from its transparent surround.
 *   4. Both bake paths draw through bakeWithShrunkPhotos: the stylist Save and the renderer.
 * Exits non-zero on any failure and on inspecting nothing (ADR-0106).
 */
import { readFileSync } from 'node:fs'
import { shrinkPixels } from '../src/lib/bakeShrink.ts'

const ROOT = new URL('..', import.meta.url).pathname
const failures = []
let checked = 0
const check = (cond, msg) => { checked++; if (!cond) failures.push(msg) }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const read = (f) => strip(readFileSync(ROOT + f, 'utf8'))

// A stripe photo: SW x SH, blue and white columns `period` pixels apart.
const SW = 1000, SH = 8
const stripes = (period) => {
  const d = new Uint8ClampedArray(SW * SH * 4)
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const i = (y * SW + x) * 4, blue = (x % period) < period / 2
    d[i] = blue ? 60 : 250; d[i + 1] = blue ? 80 : 250; d[i + 2] = blue ? 165 : 252; d[i + 3] = 255
  }
  return d
}
const row = (d, w) => Array.from({ length: w }, (_, x) => d[(2 * w + x) * 4 + 2])
// Exact area average of one row (blue channel): what a perfect shrink gives.
const area = (d, w) => {
  const f = SW / w
  return Array.from({ length: w }, (_, x) => {
    const a = x * f, b = a + f; let s = 0
    for (let k = Math.floor(a); k < Math.ceil(b); k++) s += d[(2 * SW + k) * 4 + 2] * (Math.min(b, k + 1) - Math.max(a, k))
    return s / f
  })
}
// What a browser's one-step draw does at this size: read the nearest source pixel, skip the rest.
const skip = (d, w) => Array.from({ length: w }, (_, x) => d[(2 * SW + Math.floor((x + 0.5) * SW / w)) * 4 + 2])
const rms = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length)

const W = Math.round(SW * 0.28 * 2) // 560: the shirt at 28% on the board, in the 2x saved picture
for (const period of [9, 14]) {
  const src = stripes(period)
  const got = row(shrinkPixels(src, SW, SH, W, SH), W)
  const ideal = area(src, W)
  const e = rms(got, ideal), naive = rms(skip(src, W), ideal)
  console.log(`  ${period}px stripe at 28%: ours ${e.toFixed(1)}, a skipping shrink ${naive.toFixed(1)} levels off a perfect average`)
  check(e < 6, `A ${period}px stripe at 28% shrinks ${e.toFixed(1)} levels off a perfect average (limit 6).`)
  check(naive > 2 * e, `The check cannot tell a skipping shrink (${naive.toFixed(1)}) from ours (${e.toFixed(1)}) on a ${period}px stripe.`)
}

// 2. A wide stripe stays crisp: full blue and full white both still present.
{
  const got = row(shrinkPixels(stripes(48), SW, SH, W, SH), W)
  check(Math.min(...got) <= 170 && Math.max(...got) >= 245, 'A wide stripe lost contrast when shrunk (blurred).')
}

// 3. A white cut-out on transparent: its edge stays white, not grey.
{
  const d = new Uint8ClampedArray(SW * SH * 4)
  for (let y = 0; y < SH; y++) for (let x = 300; x < 700; x++) d.set([255, 255, 255, 255], (y * SW + x) * 4)
  const out = shrinkPixels(d, SW, SH, 250, SH)
  let darkest = 255, edges = 0
  for (let x = 0; x < 250; x++) { const i = (2 * 250 + x) * 4; if (out[i + 3] > 20) { edges++; darkest = Math.min(darkest, out[i]) } }
  check(edges > 90 && darkest >= 250, `A white cut-out's edge went grey (${darkest}) when shrunk.`)
}

// 4. Both bake paths draw through it.
const canvas = read('src/components/canvas/LookCanvas.tsx')
check(/bakeWithShrunkPhotos\(stage\.find\('Image'\)[^,]*, pixelRatio, \(\) => stage\.toDataURL\(/.test(canvas), 'The stylist Save (LookCanvas export) does not bake through bakeWithShrunkPhotos.')
const composite = read('src/render/composite.ts')
check(/bakeWithShrunkPhotos\(stage\.find\('Image'\)[^,]*, pixelRatio, \(\) =>\s*stage\.toDataURL\(/.test(composite), 'The renderer (render/composite.ts) does not bake through bakeWithShrunkPhotos.')

if (checked === 0) failures.push('Nothing was checked.')
if (failures.length) {
  console.error(`check-bake-shrink: ${failures.length} failed of ${checked}:`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log(`check-bake-shrink: ${checked} passed, 0 failed`)
