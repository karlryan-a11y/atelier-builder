#!/usr/bin/env node
/**
 * ADR-0152. A CAPSULE IS A SET OF LOOKS: SHE CAN ADD AS MANY AS SHE WANTS, AND SAVING UPDATES
 * THE ONE SHE HAS.
 *
 * Cynthia Dada, 2026-09-24: "When I try to add another look to a capsule, it thinks I want to
 * discard and load a new look." A click on a look could only replace the board, and a fresh
 * "Save as Capsule" never adopted the row it made, so every save was a new capsule: Janet
 * Foutty had five Denvers and five Cape Cods by the end of the morning.
 *
 * Two halves:
 *   1. BEHAVIOUR. Runs lib/capsuleLayout.ts itself (Node strips the types) and adds real
 *      numbers of looks to a board: every look placed, none on top of another or of what was
 *      already there, the board grows instead of refusing, a look is never added twice, and
 *      every piece keeps its photo and says which look it came with.
 *   2. WIRING. The click on a look adds on a capsule, never offers only "discard"; every capsule
 *      save adopts its row; adopting it lets go of the look she started from.
 *
 * Exits non-zero on any failure and on inspecting nothing (ADR-0106).
 */
import { readFileSync, existsSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
const problems = []
const fail = (m) => { problems.push(m); console.error(`   ❌ ${m}`) }
let checks = 0
let looksPlaced = 0

const strip = (s) => s
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

/* ---------------- 1. Behaviour ---------------- */

const LAYOUT = 'src/lib/capsuleLayout.ts'
let L = null
checks++
if (!existsSync(ROOT + LAYOUT)) {
  fail(`${LAYOUT} does not exist: nothing can put a look on a capsule, so a click on one can only replace the board.`)
} else {
  try { L = await import(ROOT + LAYOUT) } catch (e) { fail(`${LAYOUT} would not load: ${e.message}`) }
}

/** A look like the ones stylists save: a few pieces and a label, on a mostly empty board. */
function makeLook(id, pieces = 5, board = { width: 1600, height: 1200 }) {
  const nodes = []
  for (let i = 0; i < pieces; i++) {
    nodes.push({ id: `${id}_p${i}`, type: 'closet_item', closet_item_id: `${id}_item${i}`, x: 100 + (i % 3) * 180, y: 80 + Math.floor(i / 3) * 260, scale: 0.5, rotation: 0, flipped: false, z_index: i, locked: false })
  }
  nodes.push({ id: `${id}_t`, type: 'text', content: 'Theory', font_family: 'Amalfi Coast', font_size: 28, fill: '#000', x: 60, y: 40, rotation: 0, z_index: pieces })
  const imageUrls = Object.fromEntries(nodes.filter((n) => n.type === 'closet_item').map((n) => [n.id, `https://img/${n.closet_item_id}.png`]))
  const dims = Object.fromEntries(nodes.filter((n) => n.type === 'closet_item').map((n) => [n.id, { w: 600, h: 800 }]))
  return { lookId: id, state: { version: 1, canvas: { ...board, background: '#fff' }, nodes }, imageUrls, dims }
}

if (L) {
  const empty = { version: 1, canvas: { width: 1600, height: 1200, background: '#fff' }, nodes: [] }
  let n = 0
  const newId = () => `new_${n++}`

  // Twelve looks: more than one Landscape board holds (8), which is where "it refused" would show.
  const looks = Array.from({ length: 12 }, (_, i) => makeLook(`look${i}`, 3 + (i % 5)))
  const r = L.addLooksToBoard(empty, {}, () => null, looks, newId)
  looksPlaced += r.added.length

  checks++
  if (r.added.length !== 12) fail(`12 looks added, ${r.added.length} placed (skipped: ${JSON.stringify(r.skipped)}). She must be able to add as many as she wants.`)

  checks++
  const expectedNodes = looks.reduce((a, l) => a + l.state.nodes.length, 0)
  if (r.state.nodes.length !== expectedNodes) fail(`${expectedNodes} pieces and labels went in, ${r.state.nodes.length} came out.`)

  checks++
  const ids = new Set(r.state.nodes.map((x) => x.id))
  if (ids.size !== r.state.nodes.length) fail('Two nodes on the board share an id, so moving one moves the other.')

  checks++
  const unstamped = r.state.nodes.filter((x) => !x.from_look_id)
  if (unstamped.length) fail(`${unstamped.length} nodes do not say which look they came with, so the capsule cannot say which looks it holds.`)

  checks++
  const pieces = r.state.nodes.filter((x) => x.type === 'closet_item')
  const noPhoto = pieces.filter((x) => !r.imageUrls[x.id])
  if (noPhoto.length) fail(`${noPhoto.length} of ${pieces.length} pieces lost their photo on the way onto the capsule and would draw blank.`)

  // No look overlaps another: each look's box must sit inside its own cell, and cells differ.
  checks++
  const grid = L.capsuleGrid(r.state.canvas)
  const dimsOf = (node) => {
    const src = looks.find((l) => l.lookId === node.from_look_id)
    return node.type === 'closet_item' ? { w: 600, h: 800 } : (src ? null : null)
  }
  const boxes = r.added.map((id) => ({ id, box: L.contentBox(r.state.nodes.filter((x) => x.from_look_id === id), dimsOf) }))
  const cells = new Set()
  for (const { id, box } of boxes) {
    const col = Math.floor((box.x + box.w / 2) / grid.cellW)
    const row = Math.floor((box.y + box.h / 2) / grid.cellH)
    const inside = box.x >= col * grid.cellW - 0.5 && box.x + box.w <= (col + 1) * grid.cellW + 0.5
      && box.y >= row * grid.cellH - 0.5 && box.y + box.h <= (row + 1) * grid.cellH + 0.5
    if (!inside) fail(`${id} spills out of its place on the board and sits over its neighbour.`)
    const key = `${row}:${col}`
    if (cells.has(key)) fail(`${id} was put on top of another look.`)
    cells.add(key)
  }

  checks++
  const bottom = Math.max(...boxes.map((b) => b.box.y + b.box.h))
  if (r.state.canvas.height < bottom) fail(`Looks run off the bottom of the board (board ${r.state.canvas.height}px, looks reach ${Math.round(bottom)}px). The board has to grow.`)

  // Adding the same look again does nothing.
  checks++
  const again = L.addLooksToBoard(r.state, r.imageUrls, dimsOf, [makeLook('look3')], newId)
  if (again.added.length !== 0 || again.state.nodes.length !== r.state.nodes.length) fail('A look already on the capsule was added a second time.')

  // Her own work on the board is never covered: a piece she placed by hand keeps its place.
  checks++
  const handPlaced = { ...empty, nodes: [{ id: 'hand', type: 'closet_item', closet_item_id: 'x', x: 120, y: 150, scale: 0.4, rotation: 0, flipped: false, z_index: 0, locked: false }] }
  const r2 = L.addLooksToBoard(handPlaced, {}, () => ({ w: 600, h: 800 }), [makeLook('lookA')], newId)
  const handBox = L.nodeBox(handPlaced.nodes[0], { w: 600, h: 800 })
  const aBox = L.contentBox(r2.state.nodes.filter((x) => x.from_look_id === 'lookA'), () => ({ w: 600, h: 800 }))
  const overlap = !(aBox.x >= handBox.x + handBox.w || aBox.x + aBox.w <= handBox.x || aBox.y >= handBox.y + handBox.h || aBox.y + aBox.h <= handBox.y)
  if (overlap) fail('A look was dropped on top of a piece she had already placed.')
  if (r2.state.nodes[0].x !== 120 || r2.state.nodes[0].y !== 150) fail('Adding a look moved a piece she had already placed.')
  looksPlaced += r2.added.length

  checks++
  if (JSON.stringify(L.lookIdsOnBoard(r.state)) !== JSON.stringify(looks.map((l) => l.lookId))) fail('The board does not report its looks in the order they were added.')
}

/* ---------------- 2. Wiring ---------------- */

const CHAT = 'src/components/layout/ChatPanel.tsx'
const chat = strip(readFileSync(ROOT + CHAT, 'utf8'))
const bodyOf = (src, name) => {
  const i = src.indexOf(`const ${name} = useCallback(`)
  if (i < 0) return null
  const j = src.indexOf('\n  const ', i + 10)
  return src.slice(i, j < 0 ? undefined : j)
}

checks++
const select = bodyOf(chat, 'handleSelectLook')
if (!select) fail(`${CHAT}: handleSelectLook is gone; this guard no longer covers the click on a look.`)
else {
  if (/confirm\(/.test(select)) fail(`${CHAT}: a click on a look still asks a discard-or-cancel question. On a capsule it must add the look; elsewhere adding must be offered.`)
  if (!/onCapsule[\s\S]*handleAddLooks\(/.test(select)) fail(`${CHAT}: a click on a look while a capsule is on the board does not add it (ADR-0152).`)
}

checks++
const saveCap = bodyOf(chat, 'handleSaveAsCapsule')
if (!saveCap) fail(`${CHAT}: handleSaveAsCapsule is gone.`)
else {
  if (/replacesCapsuleId\s*&&\s*saved\?\.data\?\.id\)\s*noteSavedCapsuleAs/.test(saveCap) || !/noteSavedCapsuleAs\(saved\.data\.id\)/.test(saveCap)) {
    fail(`${CHAT}: only a replacement adopts the capsule it saved, so pressing Save as Capsule twice makes two capsules (Janet Foutty's five Denvers).`)
  }
  if (!/boardLookIds:\s*lookIdsOnBoard\(/.test(saveCap)) fail(`${CHAT}: a saved capsule does not record which looks are on it.`)
}

checks++
if (!/disabled=\{nodes\.length === 0 \|\| buildingCapsule\}/.test(chat)) fail(`${CHAT}: Save Look is live on a board of several looks, which would save the capsule as one look.`)

const STORE = 'src/stores/canvasStore.ts'
const store = strip(readFileSync(ROOT + STORE, 'utf8'))
checks++
const note = store.match(/noteSavedCapsuleAs: \(id\) => set\(\{([^}]*)\}\)/)
if (!note) fail(`${STORE}: noteSavedCapsuleAs is gone.`)
else if (!/currentLookId: null/.test(note[1])) fail(`${STORE}: after a capsule save the board still thinks it is the look she started from, so Update Look would write the whole capsule over that look.`)

if (checks === 0) { console.error('\n❌ capsule-add-looks: inspected nothing.\n'); process.exit(1) }
console.log(`   ${checks} rule(s) checked; ${looksPlaced} looks placed on test boards; files: ${LAYOUT}, ${CHAT}, ${STORE}`)
if (L && looksPlaced === 0) { console.error('\n❌ capsule-add-looks: placed no looks, so the behaviour half measured nothing.\n'); process.exit(1) }

if (problems.length) {
  console.error(`\n❌ capsule-add-looks: ${problems.length} failure(s).\n`)
  process.exit(1)
}
console.log('\n✅ capsule-add-looks: looks go onto a capsule, as many as she wants, and saving updates it.\n')
