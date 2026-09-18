#!/usr/bin/env node
/**
 * A GOODPIX LOOK OPENS THE WAY THE STYLIST LEFT IT — measured over the layouts actually stored.
 *
 * The defect (Paige Berndt, 2026-09-17; Cynthia Dada, same day): Restyle and Rebuild in canvas
 * laid a GoodPix look's pieces out in a grid, dropped every handwritten note, and put pieces on
 * the board that were never in the picture. 0 of 15,065 GoodPix looks had an arrangement. ADR-0127
 * copies GoodPix's own arrangement into gp_looks.gp_layout and src/lib/goodpixLayout.ts turns it
 * into an Atelier canvas. This guard grades that conversion over REAL stored layouts:
 *
 *   1. PLACEMENT. Every piece lands where GoodPix drew it: the centre of its box on the board is
 *      the centre GoodPix's object had, scaled, within 2 board pixels. The old grid fails this for
 *      almost every piece (--legacy).
 *   2. NOTHING LOST. Every object is accounted for: a placed piece, a picture, a text box, or a
 *      counted skip (shapes, lines). A converter that silently drops objects fails.
 *   3. HANDWRITING ARRIVES. Text boxes in the layout come across as text nodes, word for word.
 *   4. RECOGNITION. At least 90% of the images that are not shop products are recognised as one of
 *      her pieces (measured 98% on 120 boards, 2026-09-18). Below that, pieces are silently
 *      turning into pictures, which a transition can never see.
 *   5. LEFT OFF MEANS LEFT OFF. With every piece refused, no piece reaches the board.
 *   6. THE BOARD IS A STOCK BOARD: 1080x1080, 1200x1600 or 1600x1200.
 *
 * Plus shaped cases for geometry the sample may not contain (centre origin, flips, rotation).
 * Imports the SHIPPED converter. Exits non-zero on any failure and on inspecting nothing.
 *
 *   node scripts/check-goodpix-layout.mjs              # up to 400 stored layouts
 *   node scripts/check-goodpix-layout.mjs --legacy     # the old grid, graded the same: must FAIL
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const G = await import('../src/lib/goodpixLayout.ts')
// The OLD behaviour, for --legacy: lib/rebuildLookCanvas.ts's centred grid, modelled here the way
// check-transition-queue.mjs models the old queue (that file imports through the @ alias, which
// plain node does not resolve).
function buildCanvasFromClosetItems(ids) {
  const W = 1080, Hh = 1080, n = ids.length
  const canvas = { version: 1, canvas: { width: W, height: Hh, background: '#ffffff' }, nodes: [] }
  if (!n) return canvas
  const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), cellW = W / cols, cellH = Hh / rows
  const targetH = Math.min(340, Math.round(cellH * 0.82)), estW = Math.round(targetH * 0.75)
  canvas.nodes = ids.map((id, i) => {
    const col = i % cols, row = Math.floor(i / cols)
    const rowCount = row === rows - 1 ? n - (rows - 1) * cols : cols
    const rowOffset = (W - rowCount * cellW) / 2
    return { id: `g${i}`, type: 'closet_item', closet_item_id: id, x: Math.round(rowOffset + col * cellW + (cellW - estW) / 2),
      y: Math.round(row * cellH + (cellH - targetH) / 2), scale: 1, target_height: targetH, rotation: 0, flipped: false, z_index: i, locked: false }
  })
  return canvas
}

const env = { ...process.env }
for (const f of ['../.env.local', '../.env']) {
  let t; try { t = readFileSync(new URL(f, import.meta.url), 'utf8') } catch { continue }
  for (const l of t.split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
}
if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error('\n❌ goodpix-layout: needs VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.\n'); process.exit(1) }
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const LEGACY = process.argv.includes('--legacy')
const LIMIT = 400

const problems = []
const fail = (m) => { problems.push(m); if (problems.length <= 20) console.error(`   ❌ ${m}`) }
const mirrorUrl = (k) => `https://example.invalid/${k}`

// ── shaped cases ──────────────────────────────────────────────────────────────────────────
let shaped = 0
if (!LEGACY) {
  const ok = (name, c) => { shaped++; if (!c) fail(`shaped: ${name}`) }
  const H = 'a'.repeat(32)
  const base = { v: 1, canvas: { width: 2160, height: 2160 }, v1_primary: null, pool: [{ id: 'P1', urls: [`https://goodpix-co.s3.amazonaws.com/processed-original-${H}.png`] }] }
  const img = (o) => ({ type: 'Image', width: 100, height: 200, scaleX: 1, scaleY: 1, src: `https://v2.goodpix.co/api/download/image?url=${encodeURIComponent(`https://goodpix-co.s3.amazonaws.com/processed-large-${H}.png`)}`, ...o })
  const conv = (objs, keep = () => true) => G.convertGoodPixLayout({ ...base, objects: objs }, { keep, mirrorUrl })

  ok('a 2160 square with no stated space is laid out in 1080 units', G.layoutSpace(base).width === 1080)
  ok('a 1800x2400 board with v1 1200 is 1200x1600', G.layoutSpace({ canvas: { width: 1800, height: 2400 }, v1_primary: { width: 1200, height: 1600 } }).height === 1600)
  ok('a 2400x1800 board with no v1 is 1600 wide', G.layoutSpace({ canvas: { width: 2400, height: 1800 } }).width === 1600)
  ok('a wrapped GoodPix url is recognised by its photo hash', conv([img({ left: 10, top: 20 })]).placed[0] === 'P1')
  {
    const n = conv([img({ left: 10, top: 20 })]).canvas.nodes[0]
    ok('an unflipped piece is anchored at its top-left', n.x === 10 && n.y === 20 && n.target_height === 200 && !n.flipped)
  }
  {
    const n = conv([img({ left: 10, top: 20, flipX: true })]).canvas.nodes[0]
    ok('a flipped piece is anchored on its right edge (Konva mirrors about x)', n.x === 110 && n.y === 20 && n.flipped)
  }
  {
    const n = conv([img({ left: 60, top: 120, originX: 'center', originY: 'center' })]).canvas.nodes[0]
    ok('a centre-origin object is moved to its top-left', Math.abs(n.x - 10) < 1e-9 && Math.abs(n.y - 20) < 1e-9)
  }
  {
    const n = conv([img({ left: 0, top: 0, angle: 90 })]).canvas.nodes[0]
    ok('a rotated piece keeps its angle and its pivot', n.rotation === 90 && Math.abs(n.x) < 1e-9)
  }
  {
    const n = conv([img({ left: 10, top: 20, flipY: true })]).canvas.nodes[0]
    ok('a vertical flip becomes a horizontal flip turned 180, anchored at the bottom-left', n.flipped && n.rotation === 180 && n.x === 10 && n.y === 220)
  }
  {
    const c = conv([img({ left: 0, top: 0 }), { type: 'Image', width: 50, height: 50, src: 'https://d1h0n5niljcjo3.cloudfront.net/x.jpg', mirror: 'abc.jpg', productId: 'pr1', left: 5, top: 5 }])
    ok('a shop product becomes a plain picture from its mirrored copy', c.pictures === 1 && c.canvas.nodes[1].type === 'picture' && c.canvas.nodes[1].src.endsWith('abc.jpg'))
  }
  {
    const c = conv([{ type: 'Textbox', text: 'optional cardigan if needed', fontFamily: 'Amalfi Coast', fontSize: 28, left: 5, top: 6, width: 210 }])
    ok('handwriting comes across as text in the brand script', c.texts === 1 && c.canvas.nodes[0].content === 'optional cardigan if needed' && c.canvas.nodes[0].font_family.includes('Amalfi Coast'))
  }
  ok('a piece she no longer owns is left off, not placed', conv([img({})], () => false).canvas.nodes.length === 0)
  ok('an inline picture with no copy is skipped and counted', conv([{ type: 'Image', src: null, width: 5, height: 5 }]).skipped === 1)
  console.log(`\n   ${shaped} shaped case(s) over the shipped converter`)
}

// ── real stored layouts ───────────────────────────────────────────────────────────────────
const { data: rows, error } = await sb.from('gp_looks')
  .select('id, name, client_id, closet_item_ids, gp_layout').not('gp_layout', 'is', null).limit(LIMIT)
if (error) throw error

let looks = 0, pieces = 0, onTarget = 0, texts = 0, textsExpected = 0, candidates = 0, recognised = 0
const STOCK = new Set(['1080x1080', '1200x1600', '1600x1200'])

for (const r of rows ?? []) {
  const lay = r.gp_layout
  const objs = lay.objects ?? []
  if (!objs.length) continue
  looks++
  const space = G.layoutSpace(lay)
  const k = (Math.abs(space.width - space.height) < 1 ? 1080 : 1600) / Math.max(space.width, space.height)

  // What the board would be. --legacy: the grid every GoodPix look opened on before ADR-0127.
  let canvas, conv
  if (LEGACY) {
    const ids = G.piecesInLayout(lay)
    canvas = buildCanvasFromClosetItems(ids)
    conv = { placed: ids, pictures: 0, texts: 0, skipped: 0, leftOff: [] }
  } else {
    conv = G.convertGoodPixLayout(lay, { keep: () => true, mirrorUrl, idPrefix: r.id.slice(-6) })
    canvas = conv.canvas
  }
  const size = `${canvas.canvas.width}x${canvas.canvas.height}`
  if (!STOCK.has(size)) fail(`"${r.name}": board is ${size}, not a stock board`)

  // 1. placement — each recognised piece against its layout object's centre
  const byHash = new Map()
  for (const p of lay.pool ?? []) for (const u of p.urls ?? []) { const h = G.goodPixPhotoHash(u); if (h) byHash.set(h, p.id) }
  const poolIds = new Set((lay.pool ?? []).map((p) => p.id))
  const used = new Set()
  for (const o of objs) {
    if ((o.type ?? '').toLowerCase() !== 'image' || o.visible === false) continue
    const id = (o.closetItemId && poolIds.has(o.closetItemId)) ? o.closetItemId : byHash.get(G.goodPixPhotoHash(o.src ? G.unwrapGoodPixUrl(o.src) : null))
    if (!o.productId) { candidates++; if (id) recognised++ }
    if (!id) continue
    const node = canvas.nodes.find((n) => n.type === 'closet_item' && n.closet_item_id === id && !used.has(n.id))
    if (!node) { fail(`"${r.name}": piece ${id} is in the picture and not on the board`); continue }
    used.add(node.id)
    pieces++
    // expected centre, in board units
    const w = (o.width ?? 0) * Math.abs(o.scaleX ?? 1), h = (o.height ?? 0) * Math.abs(o.scaleY ?? 1)
    const a = ((o.angle ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
    const ox = ({ center: 0.5, right: 1 }[o.originX] ?? 0) * w, oy = ({ center: 0.5, bottom: 1 }[o.originY] ?? 0) * h
    const tlx = (o.left ?? 0) - (c * ox - s * oy), tly = (o.top ?? 0) - (s * ox + c * oy)
    const ex = (tlx + c * w / 2 - s * h / 2) * k, ey = (tly + s * w / 2 + c * h / 2) * k
    // the node's centre, assuming the image is drawn at GoodPix's aspect (the height is exact)
    const th = node.target_height ?? 0, tw = th * (w / (h || 1))
    const nr = (node.rotation * Math.PI) / 180, nc = Math.cos(nr), ns = Math.sin(nr)
    const dx = node.flipped ? -tw / 2 : tw / 2
    const gx = node.x + nc * dx - ns * th / 2, gy = node.y + ns * dx + nc * th / 2
    if (Math.hypot(gx - ex, gy - ey) <= 2) onTarget++
  }

  // 2. nothing lost
  if (!LEGACY) {
    const accounted = canvas.nodes.length + conv.skipped + conv.leftOff.length
    if (accounted !== objs.length) fail(`"${r.name}": ${objs.length} objects in the layout, ${accounted} accounted for`)
  }
  // 3. handwriting
  for (const o of objs) {
    const t = (o.type ?? '').toLowerCase()
    if ((t === 'textbox' || t === 'i-text' || t === 'text') && (o.text ?? '').trim() && o.visible !== false) {
      textsExpected++
      if (canvas.nodes.some((n) => n.type === 'text' && n.content === o.text)) texts++
    }
  }
  // 5. refused pieces stay off
  if (!LEGACY && G.convertGoodPixLayout(lay, { keep: () => false, mirrorUrl }).canvas.nodes.some((n) => n.type === 'closet_item')) {
    fail(`"${r.name}": a refused piece still reached the board`)
  }
}

const placePct = pieces ? (100 * onTarget) / pieces : 0
const recogPct = candidates ? (100 * recognised) / candidates : 0
console.log(`\n   ${looks} stored layout(s) graded`)
console.log(`   ${onTarget} of ${pieces} pieces placed where GoodPix drew them (${placePct.toFixed(1)}%)`)
console.log(`   ${texts} of ${textsExpected} handwritten notes carried across`)
console.log(`   ${recognised} of ${candidates} non-product images recognised as her pieces (${recogPct.toFixed(1)}%)`)

if (pieces && placePct < 99) fail(`only ${placePct.toFixed(1)}% of pieces are where GoodPix drew them`)
if (textsExpected && texts < textsExpected) fail(`${textsExpected - texts} handwritten note(s) did not arrive`)
if (candidates && recogPct < 90) fail(`only ${recogPct.toFixed(1)}% of her pieces were recognised`)

if (looks === 0 && shaped === 0) { console.error('\n❌ goodpix-layout: nothing inspected. Nothing was verified.\n'); process.exit(1) }
if (looks === 0) { console.error('\n❌ goodpix-layout: no stored layouts to grade. Run goodpix-scraper resync_layouts.py.\n'); process.exit(1) }
if (problems.length) {
  if (problems.length > 20) console.error(`   … and ${problems.length - 20} more`)
  console.error(`\n❌ goodpix-layout: ${problems.length} failure(s)${LEGACY ? ' (--legacy: this is the point)' : ''}.\n`)
  process.exit(1)
}
console.log(`\n✅ goodpix-layout: ${looks} look(s) open the way the stylist left them.\n`)
