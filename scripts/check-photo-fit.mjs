#!/usr/bin/env node
// @checks build
/**
 * A PIECE KEEPS ITS SIZE AND PLACE WHEN ITS PHOTO IS REPLACED.
 *
 * Cynthia Dada, 2026-11-18, on Chris Cadieux's Thanksgiving Looks capsule: "it opened with items
 * larger and out of place". A piece is saved as a scale of its photo. On 11/12 the Prada crewneck's
 * photo went from 400x500 to 1212x1297 and the Brunello Cucinelli loafers' from 357x500 to
 * 1673x940, so the same scale drew them three to five times bigger, off the board.
 *
 * Each piece now remembers the photo size it was sized against (photo_w, photo_h). When the photo
 * it opens with is a different size, lib/photoFit.ts fits the new photo into the same box, centred.
 * The board (canvasStore.setNodeDims), the saved picture renderer (render/composite.ts) and
 * Add looks to capsule (lib/capsuleLooks.ts) all go through it.
 */
import { readFileSync } from 'node:fs'
const { fitToPhoto } = await import('../src/lib/photoFit.ts')

let n = 0
const problems = []
const assert = (name, ok) => { n += 1; if (!ok) { problems.push(name); console.error(`   ❌ ${name}`) } }
const near = (a, b) => Math.abs(a - b) < 0.01

// Drawn box of a piece on the board, unrotated and unflipped.
const box = (node, w, h) => {
  const sx = node.scale, sy = node.scale_y ?? node.scale
  const x0 = node.flipped ? node.x - w * sx : node.x
  return { x: x0, y: node.y, w: w * sx, h: h * sy }
}

// Chris Cadieux's crewneck as saved against its 400x500 photo, now 1212x1297.
const crew = { id: 'a', type: 'closet_item', closet_item_id: 'c', x: 600, y: 120, scale: 0.9, rotation: 0, flipped: false, z_index: 0, locked: false, photo_w: 400, photo_h: 500 }
const before = box(crew, 400, 500)
const fitted = fitToPhoto(crew, 1212, 1297)
const after = box(fitted, 1212, 1297)
assert('crewneck stays inside its saved box', after.x >= before.x - 0.01 && after.y >= before.y - 0.01 && after.x + after.w <= before.x + before.w + 0.01 && after.y + after.h <= before.y + before.h + 0.01)
assert('crewneck fills its saved box on one side', near(after.w, before.w) || near(after.h, before.h))
assert('crewneck stays centred', near(after.x + after.w / 2, before.x + before.w / 2) && near(after.y + after.h / 2, before.y + before.h / 2))
assert('crewneck now remembers the new photo', fitted.photo_w === 1212 && fitted.photo_h === 1297)

// The loafers went from portrait to landscape, and a stretched, flipped piece keeps its stretch and flip.
const loafer = { id: 'b', type: 'closet_item', closet_item_id: 'l', x: 900, y: 800, scale: 0.6, scale_y: 0.5, rotation: 0, flipped: true, z_index: 1, locked: false, photo_w: 357, photo_h: 500 }
const lb = box(loafer, 357, 500)
const lf = fitToPhoto(loafer, 1673, 940)
const la = box(lf, 1673, 940)
assert('loafers stay inside their saved box', la.x >= lb.x - 0.01 && la.x + la.w <= lb.x + lb.w + 0.01 && la.y >= lb.y - 0.01 && la.y + la.h <= lb.y + lb.h + 0.01)
assert('loafers stay centred', near(la.x + la.w / 2, lb.x + lb.w / 2) && near(la.y + la.h / 2, lb.y + lb.h / 2))
assert('loafers keep their stretch', near(lf.scale_y / lf.scale, loafer.scale_y / loafer.scale))
assert('loafers stay flipped', lf.flipped === true)

// Turned 90 degrees: the centre still stays put.
const turned = { ...crew, rotation: 90 }
const tf = fitToPhoto(turned, 1212, 1297)
const centre = (nd, w, h) => {
  const r = (nd.rotation * Math.PI) / 180, cx = (w * nd.scale) / 2, cy = (h * (nd.scale_y ?? nd.scale)) / 2
  return [nd.x + cx * Math.cos(r) - cy * Math.sin(r), nd.y + cx * Math.sin(r) + cy * Math.cos(r)]
}
const [c0x, c0y] = centre(turned, 400, 500), [c1x, c1y] = centre(tf, 1212, 1297)
assert('a turned piece keeps its centre', near(c0x, c1x) && near(c0y, c1y))

// Same photo size: nothing changes, the very same node comes back (so the board is not touched).
assert('same photo: untouched', fitToPhoto(crew, 400, 500) === crew)
// A piece saved before photo sizes were remembered: only learns its photo, never moves.
const old = { ...crew, photo_w: undefined, photo_h: undefined }
const learned = fitToPhoto(old, 1212, 1297)
assert('old piece: learns its photo', learned.photo_w === 1212 && learned.photo_h === 1297)
assert('old piece: does not move or resize', learned.x === old.x && learned.y === old.y && learned.scale === old.scale && learned.scale_y === old.scale_y)
// A piece Compose sized by height is drawn from its photo's height already: only learns its photo.
const composed = { ...crew, target_height: 300 }
const cf = fitToPhoto(composed, 1212, 1297)
assert('composed piece: scale untouched', cf.scale === composed.scale && cf.x === composed.x)
// A photo that has not loaded (0x0) changes nothing.
assert('no photo yet: untouched', fitToPhoto(crew, 0, 0) === crew)

// Every draw path goes through it.
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
assert('board fits each piece to its photo as it loads', /fitToPhoto\(/.test(src('stores/canvasStore.ts')))
assert('board re-checks when a piece forgets its photo', /node\.photo_w/.test(src('components/canvas/LookCanvas.tsx')))
assert('saved picture fits each piece to its photo', /fitToPhoto\(/.test(src('render/composite.ts')))
assert('Add looks to capsule fits each piece to its photo', /fitToPhoto\(/.test(src('lib/capsuleLooks.ts')))

if (problems.length) {
  console.error(`check-photo-fit: ${problems.length} of ${n} failed`)
  process.exit(1)
}
console.log(`check-photo-fit: ${n} checks pass (a piece keeps its size and place when its photo is replaced)`)
