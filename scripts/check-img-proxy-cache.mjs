#!/usr/bin/env node
/**
 * /img-proxy cache headers (styling wave 3, item 5).
 *
 * /img-proxy/* is a rewrite to the GoodPix S3 bucket. S3 sends no Cache-Control, so Vercel's CDN
 * never kept a copy (x-vercel-cache: MISS every time) and every board open re-downloaded every
 * original. The objects are immutable by key (content-hash and timestamp names; 400 of 400
 * sampled on 2026-09-19 were never rewritten after creation), so each rewrite source gets a
 * year-long immutable Cache-Control and CDN-Cache-Control.
 *
 * Fails if any img-proxy rewrite in vercel.json lacks a matching header rule with both.
 * The live proof is a second fetch on a preview answering x-vercel-cache: HIT.
 */
import { readFileSync } from 'node:fs'

const cfg = JSON.parse(readFileSync('vercel.json', 'utf8'))
const rewrites = (cfg.rewrites ?? []).filter((r) => /img-proxy/.test(r.source))
const failures = []
let checked = 0
for (const r of rewrites) {
  checked++
  const prefix = r.source.replace(/:path\*$/, '')
  const rule = (cfg.headers ?? []).find((h) => h.source.startsWith(prefix) && /\(\.\*\)$|:path\*$/.test(h.source))
  const get = (k) => rule?.headers.find((h) => h.key.toLowerCase() === k)?.value ?? ''
  for (const k of ['cache-control', 'cdn-cache-control']) {
    checked++
    if (!/max-age=31536000/.test(get(k)) || !/immutable/.test(get(k))) failures.push(`${r.source}: no long immutable ${k} header rule`)
  }
}
if (rewrites.length === 0) failures.push('no img-proxy rewrite found in vercel.json; nothing was checked')
console.log(`check-img-proxy-cache: ${checked} assertions over ${rewrites.length} img-proxy rewrite(s)`)
if (failures.length) {
  console.log(`FAIL (${failures.length}):`)
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}
console.log('PASS - every img-proxy rewrite is cacheable at the edge and in the browser.')
