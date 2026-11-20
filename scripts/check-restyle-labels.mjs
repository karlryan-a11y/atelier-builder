#!/usr/bin/env node
// @checks build
/**
 * RESTYLE OPENS THE LOOK AS IT WAS, MINUS THE PIECES SHE LET GO AND THEIR LABELS.
 *
 * Cynthia Dada, 2026-11-20, Chris Cadieux Look 66: "Make it so that restyling looks with
 * transitioned items doesn't open the look with items resized." Two things were wrong on the board
 * Restyle opened:
 *   1. The Prada loafers, placed by height (target_height 340) on their 400x500 GoodPix photo in
 *      October, were drawn 340 tall on the 1671x941 photo that replaced it on 11/12: almost three
 *      times wider and lower down. lib/photoFit.ts now fits a height-sized piece like any other.
 *   2. The two "Dior" labels of the transitioned suit jacket and trousers stayed on the board.
 *      lib/restyleSelection.ts labelsOfLetGo takes a brand label off with its piece; the "Dior"
 *      label of the pink Dior shirt, which stays, stays.
 * Numbers are Look 66 as saved on 2026-10-20 (last night's backup) and its photos as measured.
 */
import { readFileSync } from 'node:fs'
const { fitToPhoto } = await import('../src/lib/photoFit.ts')
const { restyleSavedBoard, garmentRect, labelsOfLetGo } = await import('../src/lib/restyleSelection.ts')

let n = 0
const problems = []
const assert = (name, ok) => { n += 1; if (!ok) { problems.push(name); console.error(`   ❌ ${name}`) } }
const near = (a, b, tol = 0.5) => Math.abs(a - b) < tol

const font = { fill: '#1A1A1A', type: 'text', rotation: 0, font_size: 32, font_family: 'Neue Haas' }
const ci = (id, closet_item_id, x, y, scale, scale_y, z, extra = {}) => ({ id, type: 'closet_item', closet_item_id, x, y, scale, scale_y, z_index: z, rotation: 0, flipped: false, locked: false, ...extra })
const JACKET = 'dc221d3e', PANTS = 'af448f0f', SHIRT = '5201516a', LOAFER = '6a05de7d', BELT = '593c3aac', TIE = 'c8a653a6'
const look66 = {
  version: 1,
  canvas: { width: 1080, height: 1080, background: '#ffffff' },
  nodes: [
    ci('jacket', JACKET, 269.81, 39.32, 0.30515, 0.28492, 0),
    ci('shirt', SHIRT, 454.49, 73.10, 0.25292, 0.28087, 1),
    ci('pants', PANTS, 379.70, 326.90, 0.42594, 0.39463, 2),
    { ...ci('loafer', LOAFER, 475.62, 721.51, 1, undefined, 3, { target_height: 340 }), scale_y: undefined },
    ci('belt', BELT, 509.60, 319.77, 0.11058, 0.14626, 4),
    { ...font, id: 'tx_dior_jacket', x: 218.30, y: 267.70, content: 'Dior', z_index: 5 },
    { ...font, id: 'te_dior_pants', x: 715.81, y: 700.11, content: 'Dior', z_index: 6 },
    { ...font, id: 'te_dior_shirt', x: 763.15, y: 244.44, content: 'Dior', z_index: 7 },
    { ...font, id: 'te_munro', x: 757.64, y: 378.00, content: 'Munro', width: 127.59, z_index: 8 },
    { ...font, id: 'te_prada', x: 559.40, y: 993.45, content: 'Prada', width: 130.55, z_index: 9 },
    ci('tie', TIE, 522.96, 132.68, 0.13664, 0.17439, 10),
  ],
}
const piece = (id, brand, transitioned = false) => [id, { id, name: id, brand, transitionedAt: transitioned ? '2026-11-20T19:48:11Z' : null }]
const pieces = new Map([piece(JACKET, 'Dior', true), piece(PANTS, 'Dior', true), piece(SHIRT, 'Dior'), piece(LOAFER, 'Prada'), piece(BELT, 'Munro'), piece(TIE, null)])
// Photo [w, h] and garment box, as the board loads them today.
const photos = {
  jacket: [1024, 1536, [80, 112, 944, 1424]],
  pants: [1024, 1536, [272, 112, 752, 1424]],
  shirt: [1159, 1358, [0, 42.4, 1160, 1301.4]],
  loafer: [1671, 941, [174.1, 243.7, 1514.3, 748.5]],
  belt: [1683, 935, [105.2, 368.2, 1577.8, 596.1]],
  tie: [1254, 1254, [431.1, 52.3, 862.1, 1201.8]],
}
const garments = new Map(look66.nodes.filter((x) => x.type === 'closet_item').map((x) => [x.id, garmentRect(x, ...photos[x.id])]))

// ── The labels ────────────────────────────────────────────────────────────────────────────────
const plan = restyleSavedBoard(look66, pieces, undefined, garments)
const ids = new Set(plan.canvas.nodes.map((x) => x.id))
assert('the jacket and trousers come off', !ids.has('jacket') && !ids.has('pants'))
assert('the jacket\'s Dior label comes off with it', !ids.has('tx_dior_jacket'))
assert('the trousers\' Dior label comes off with them', !ids.has('te_dior_pants'))
assert('the Dior shirt\'s label stays', ids.has('te_dior_shirt'))
assert('the Munro and Prada labels stay', ids.has('te_munro') && ids.has('te_prada'))
assert('shirt, tie, belt and loafers stay', ['shirt', 'tie', 'belt', 'loafer'].every((x) => ids.has(x)))
assert('every node that stays is untouched', plan.canvas.nodes.every((x) => x === look66.nodes.find((o) => o.id === x.id)))
// Without the garments' places, a label shared with a piece that stays is kept, never guessed.
const blind = restyleSavedBoard(look66, pieces)
assert('no measurements: the shared Dior labels stay', ['tx_dior_jacket', 'te_dior_pants', 'te_dior_shirt'].every((x) => blind.canvas.nodes.some((o) => o.id === x)))
// When every piece of the brand came off, its label goes without measuring.
const allDior = new Map([...pieces, piece(SHIRT, 'Dior', true)])
const gone3 = restyleSavedBoard(look66, allDior)
assert('every Dior piece gone: all three Dior labels go', !gone3.canvas.nodes.some((x) => x.type === 'text' && x.content === 'Dior'))
assert('every Dior piece gone: Munro and Prada stay', gone3.canvas.nodes.some((x) => x.id === 'te_munro') && gone3.canvas.nodes.some((x) => x.id === 'te_prada'))
// Nothing transitioned: the board opens exactly as saved.
const none = restyleSavedBoard(look66, new Map([piece(JACKET, 'Dior'), piece(PANTS, 'Dior'), ...[...pieces].filter(([k]) => k !== JACKET && k !== PANTS)]), undefined, garments)
assert('nothing let go: every node, every label, untouched', none.canvas.nodes.length === look66.nodes.length && none.canvas.nodes.every((x, i) => x === look66.nodes[i]))
// Her own words never go: a title, or a brand no piece carries.
const words = { ...look66, nodes: [...look66.nodes, { ...font, id: 'title', x: 220, y: 280, content: 'Thanksgiving' }, { ...font, id: 'other', x: 220, y: 300, content: 'Gucci' }] }
const kept = restyleSavedBoard(words, pieces, undefined, garments)
assert('a title and an unrelated brand stay', kept.canvas.nodes.some((x) => x.id === 'title') && kept.canvas.nodes.some((x) => x.id === 'other'))
assert('label matching ignores case and spaces', labelsOfLetGo([{ ...font, id: 'l', x: 0, y: 0, content: ' dior ' }, look66.nodes[0]], new Set([JACKET]), (id) => pieces.get(id)?.brand ?? null).has('l'))

// ── The loafers keep their size ─────────────────────────────────────────────────────────────
// The look was saved against the 400x500 GoodPix photo (garment [72.9,291.7,328.1,395.8]).
const loafer = { ...look66.nodes[3], photo_w: 400, photo_h: 500, photo_box: [72.9, 291.7, 328.1, 395.8] }
const was = garmentRect(loafer, 400, 500, loafer.photo_box)
const now = garmentRect(loafer, ...photos.loafer)
const w0 = was.x1 - was.x0, h0 = was.y1 - was.y0, w1 = now.x1 - now.x0, h1 = now.y1 - now.y0
assert('loafers keep their width or height', near(w1, w0) || near(h1, h0))
assert('loafers never grow', w1 <= w0 + 0.5 && h1 <= h0 + 0.5)
assert('loafers keep their centre', near((now.x0 + now.x1) / 2, (was.x0 + was.x1) / 2) && near((now.y0 + now.y1) / 2, (was.y0 + was.y1) / 2))
const fitted = fitToPhoto(loafer, ...photos.loafer)
assert('loafers become an ordinary scaled piece', !fitted.target_height && fitted.photo_w === 1671)
// Same photo again: untouched, still sized by height.
assert('same photo: a height-sized piece is untouched', fitToPhoto(loafer, 400, 500, loafer.photo_box) === loafer)
// A height-sized piece that has never remembered a photo only learns it (the repair tells old looks).
const fresh = fitToPhoto(look66.nodes[3], ...photos.loafer)
assert('never remembered a photo: only learns it', fresh.target_height === 340 && fresh.x === look66.nodes[3].x && fresh.photo_w === 1671)

// ── Wired in ─────────────────────────────────────────────────────────────────────────────────
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
assert('Restyle measures the garments for the labels', /measureGarments\(/.test(src('components/categorize/CategorizePanel.tsx')))
assert('a GoodPix restyle takes a let-go piece\'s label off too', /labelsOfLetGo\(/.test(src('lib/goodpixBoard.ts')))

if (problems.length) {
  console.error(`check-restyle-labels: ${problems.length} of ${n} failed`)
  process.exit(1)
}
console.log(`check-restyle-labels: ${n} checks pass (restyle keeps every piece's size and takes off the labels of pieces it takes off)`)
