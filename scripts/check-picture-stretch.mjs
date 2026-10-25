#!/usr/bin/env node
/**
 * Picture stretch guard (Cynthia, 2026-10-21: "the capability to make images wider or taller").
 * A picture on the board (the sweater-over-shirt image on Chris Cadieux's look) had only the four
 * corner handles and kept its shape. A picture alone now gets the same 8 handles as a piece, with
 * keepRatio off, so a side handle makes it wider and a top or bottom handle makes it taller. The
 * group box still keeps its shape. A stretch (flipped or not) saves as the same box that was on
 * screen, through the one pair pictureFromKonva / pictureKonvaAttrs the lookbook render also uses.
 * Exits non-zero on a break AND on inspecting nothing.
 */
import { readFileSync } from 'node:fs'
import { pictureFromKonva, pictureKonvaAttrs } from '../src/components/canvas/CanvasAdapter.ts'

const failures = []
let checked = 0
const is = (name, got, want) => { checked++; if (got !== want) failures.push(`${name}: expected ${want}, got ${got}`) }
const near = (name, got, want) => { checked++; if (!(Math.abs(got - want) < 1e-9)) failures.push(`${name}: expected ${want}, got ${got}`) }

const src = readFileSync(new URL('../src/components/canvas/LookCanvas.tsx', import.meta.url), 'utf8')
const EIGHT = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

// The anchor list a Transformer block uses, whether written inline or through STRETCH_ANCHORS.
const anchorsOf = (block) => {
  const m = block.match(/enabledAnchors=\{([^}]+)\}/)
  if (!m) return null
  let expr = m[1].trim()
  if (/^[A-Z_]+$/.test(expr)) {
    const def = src.match(new RegExp(`const ${expr}\\b[^=]*=\\s*(\\[[^\\]]*\\])`))
    if (!def) return null
    expr = def[1]
  }
  return [...expr.matchAll(/'([a-z-]+)'/g)].map((x) => x[1])
}
const transformerIn = (from, to) => {
  const start = src.indexOf(from)
  const end = to ? src.indexOf(to, start) : -1
  const body = start < 0 ? '' : src.slice(start, end < 0 ? undefined : end)
  return body.match(/<Transformer[\s\S]*?\/>/)?.[0] ?? ''
}

const picture = transformerIn('function PictureNodeElement', 'interface TextNodeProps')
is('the picture has its own resize box', picture.length > 0, true)
is('a picture alone does not keep its shape', /keepRatio=\{false\}/.test(picture), true)
is('a picture alone has 8 handles (corners and side middles)', JSON.stringify(anchorsOf(picture)), JSON.stringify(EIGHT))
is('a picture can still rotate', /rotateEnabled/.test(picture), true)

const piece = transformerIn('function ClosetItemImage', 'interface PictureNodeProps')
is('a piece alone still does not keep its shape', /keepRatio=\{false\}/.test(piece), true)
is('a piece alone still has 8 handles', JSON.stringify(anchorsOf(piece)), JSON.stringify(EIGHT))

const group = src.match(/<Transformer\s+ref=\{groupTrRef\}[\s\S]*?\/>/)?.[0] ?? ''
is('the group box still keeps its shape', /keepRatio\s/.test(group) && !/keepRatio=\{false\}/.test(group), true)
is('the group box still has the 4 corners only', JSON.stringify(anchorsOf(group)), JSON.stringify(CORNERS))

// Screen box of a picture node (rotation 0), from Konva attrs: x + scale * (local - offset).
const box = (a) => {
  const xs = [a.x + a.scaleX * (0 - a.offsetX), a.x + a.scaleX * (a.width - a.offsetX)]
  const ys = [a.y + a.scaleY * (0 - a.offsetY), a.y + a.scaleY * (a.height - a.offsetY)]
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
}
const pic = { id: 'p', type: 'picture', x: 100, y: 50, width: 200, height: 300, rotation: 0, flipped: false, flipped_y: false }

for (const flip of [false, true]) {
  const node = { ...pic, flipped: flip }
  const label = flip ? 'a flipped picture' : 'a picture'
  const live = pictureKonvaAttrs(node)
  // Middle-right handle: 1.5x wider only. Konva multiplies the live scale; a flip keeps its sign.
  const wider = { ...live, scaleX: live.scaleX * 1.5 }
  const savedW = pictureFromKonva(node, { x: wider.x, y: wider.y, scaleX: wider.scaleX, scaleY: wider.scaleY, rotation: 0 })
  near(`${label} stretched wider saves the new width`, savedW.width, 300)
  near(`${label} stretched wider keeps its height`, savedW.height, 300)
  const after = pictureKonvaAttrs({ ...node, ...savedW })
  is(`${label} stretched wider stays flipped as it was`, after.scaleX, flip ? -1 : 1)
  const b0 = box(wider), b1 = box(after)
  near(`${label} stretched wider: left edge saved as on screen`, b1.left, b0.left)
  near(`${label} stretched wider: right edge saved as on screen`, b1.right, b0.right)

  // Bottom-middle handle: 1.25x taller only.
  const taller = { ...live, scaleY: live.scaleY * 1.25 }
  const savedH = pictureFromKonva(node, { x: taller.x, y: taller.y, scaleX: taller.scaleX, scaleY: taller.scaleY, rotation: 0 })
  near(`${label} stretched taller keeps its width`, savedH.width, 200)
  near(`${label} stretched taller saves the new height`, savedH.height, 375)
  const b2 = box(taller), b3 = box(pictureKonvaAttrs({ ...node, ...savedH }))
  near(`${label} stretched taller: bottom edge saved as on screen`, b3.bottom, b2.bottom)
}

if (checked === 0) { console.error('check-picture-stretch: inspected nothing'); process.exit(1) }
if (failures.length) { console.error('check-picture-stretch FAILED:\n  ' + failures.join('\n  ')); process.exit(1) }
console.log(`check-picture-stretch OK (${checked} checks)`)
