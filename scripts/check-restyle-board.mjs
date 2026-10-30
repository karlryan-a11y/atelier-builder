#!/usr/bin/env node
/**
 * WHAT A TRANSITIONS CARD NAMES, WHAT RESTYLE TAKES OFF, AND THE NAME IT SAVES UNDER.
 *
 * Paige Berndt, 2026-10-28, on Danielle York's Transitions:
 *   1. "Look 155 shows that the Chanel Sheer Mesh Sleeveless Dress was removed, but that piece
 *      as you can see, is not part of the look." It was parked off the side of the board, copied
 *      over from Look 154. The card now names only let-go pieces IN THE PICTURE.
 *   2. "pieces that were not labeled as transitioned are being removed from the outfit that are
 *      still in her closet." Restyle took off pieces the team had archived. On a saved Atelier
 *      board only a piece she let go of comes off (GoodPix looks keep their pool rule,
 *      check-restyle-keeps-image).
 *   3. "when I restyle it is making me rename each look." The save box opened with an empty name
 *      on a look restyled in place, because the canvas's looks list leaves pulled looks out.
 *
 * Runs the shipped module (lib/restyleSelection.ts) over Look 155's shape, and reads ChatPanel
 * for the one row it must read. No database: it runs on every build.
 */
import { readFileSync } from 'node:fs'
const { planBuilderRestyle, placeOnBoard, restyleSavedBoard } = await import('../src/lib/restyleSelection.ts')

let n = 0
const problems = []
const assert = (name, ok) => { n += 1; if (!ok) { problems.push(name); console.error(`   ❌ ${name}`) } }

// Danielle York Look 155 as saved: a 1080 board, Look 154's Chanel Sheer Mesh dress parked at
// x 1845 (let go of), the Calvin Klein pinafore in the picture (archived by the team), a let-go
// piece whose corner sits just above the board (Look 111's bralette at y -1), and one far left
// whose photo size decides it (Look 75's skirt at x -340).
const N = (id, closet_item_id, o = {}) => ({ id, type: 'closet_item', closet_item_id, x: 100, y: 100, scale: 0.5, rotation: 0, flipped: false, z_index: 0, locked: false, ...o })
const canvas = { version: 1, canvas: { width: 1080, height: 1080, background: '#fff' }, nodes: [
  N('n1', 'mesh-dress', { x: 1845, y: -178 }),
  N('n2', 'pinafore', { x: 358, y: 75 }),
  N('n3', 'bralette', { x: 504, y: -1 }),
  N('n4', 'skirt', { x: -340, y: 331, scale: 0.256 }),
  N('n5', 'coat', { x: 98, y: 16 }),
  N('n6', 'flipped-off', { x: -5, y: 300, flipped: true }),
  N('n7', 'hidden-off', { x: 2000, y: 300, hidden: true }),
  { id: 't1', type: 'text', content: 'Chanel', x: 1900, y: 10 },
] }
const out = new Set(['mesh-dress', 'bralette', 'skirt', 'flipped-off', 'hidden-off'])
const letGo = (id) => (out.has(id) ? { id, name: id, brand: null, reason: 'transitioned' } : null)

let plan
try { plan = planBuilderRestyle(canvas, letGo) } catch (e) {
  console.error(`\n❌ restyle-board: planBuilderRestyle is missing or threw: ${e.message}\n`)
  process.exit(1)
}
assert('Look 155: a let-go piece parked off the side of the board is NOT named on the card',
  !plan.omitted.some((o) => o.id === 'mesh-dress') && plan.notInPicture.some((o) => o.id === 'mesh-dress'))
assert('a flipped piece whose corner is left of the board is off, not on the card',
  plan.notInPicture.some((o) => o.id === 'flipped-off'))
assert('a let-go piece whose corner sits a pixel above the board is in the picture and named',
  plan.omitted.some((o) => o.id === 'bralette'))
assert('a hidden piece is in the look wherever it sits (ADR-0146), so it is named',
  plan.omitted.some((o) => o.id === 'hidden-off'))
assert('a corner far to the left is not guessed: it is asked about, and named until measured',
  plan.unknown.join() === 'skirt' && plan.omitted.some((o) => o.id === 'skirt'))
const wide = planBuilderRestyle(canvas, letGo, new Map([['skirt', { width: 2000, height: 3000 }]]))
assert('measured: a 512px-wide skirt from x -340 reaches into the picture and is named',
  wide.omitted.some((o) => o.id === 'skirt') && wide.unknown.length === 0)
const narrow = planBuilderRestyle(canvas, letGo, new Map([['skirt', { width: 1000, height: 3000 }]]))
assert('measured: a 256px-wide skirt from x -340 ends before the board and is off',
  narrow.notInPicture.some((o) => o.id === 'skirt'))
const onBoard = new Set(plan.canvas.nodes.map((x) => x.closet_item_id ?? x.id))
assert('Restyle takes off EVERY node of a let-go piece, parked ones too (else the save keeps it pulled)',
  [...out].every((id) => !onBoard.has(id)))
assert('Restyle keeps the archived pinafore, the coat and the label',
  onBoard.has('pinafore') && onBoard.has('coat') && onBoard.has('t1'))
assert('the card names exactly the let-go pieces in the picture, once each',
  plan.omitted.map((o) => o.id).sort().join() === 'bralette,hidden-off,skirt')
{
  // Restyle on a saved board (restyleSavedBoard) runs the same plan from the pieces as they stand:
  // the archived pinafore stays, the parked mesh dress comes off and is named apart.
  const P = (id, o = {}) => [id, { id, name: id, brand: null, ...o }]
  const pieces = new Map([
    P('mesh-dress', { transitionedAt: '2026-10-21' }), P('pinafore', { isDeleted: true, deletedAt: '2026-09-21' }),
    P('bralette', { transitionedAt: '2026-10-21' }), P('skirt', { transitionedAt: '2026-10-21' }), P('coat'),
    P('flipped-off', { transitionedAt: '2026-10-21' }), P('hidden-off', { transitionedAt: '2026-10-21' }),
  ])
  const r = restyleSavedBoard(canvas, pieces)
  const ids = new Set(r.canvas.nodes.map((x) => x.closet_item_id ?? x.id))
  assert('an archived piece on a saved board is not a reason to take it off',
    ids.has('pinafore') && !r.omitted.some((o) => o.id === 'pinafore'))
  assert('Restyle names the same pieces the card does',
    r.omitted.map((o) => o.id).sort().join() === plan.omitted.map((o) => o.id).sort().join()
      && r.notInPicture.map((o) => o.id).sort().join() === plan.notInPicture.map((o) => o.id).sort().join())
}
// Konva writes a flip back as rotation 180 with scaleY negative: the photo then runs up and left.
assert('a flip saved as rotation 180 with negative scale_y, corner at the board\'s right, is in',
  placeOnBoard(N('r', 'r', { x: 1000, y: 900, rotation: 180, scale_y: -0.5 }), canvas.canvas, { width: 400, height: 400 }) === 'in')
assert('the same angle with its corner past the left edge is off',
  placeOnBoard(N('r', 'r', { x: -10, y: 900, rotation: -180, scale_y: 0.5 }), canvas.canvas) === 'off')

// 3. The save box's name on a look restyled in place.
const chat = readFileSync(new URL('../src/components/layout/ChatPanel.tsx', import.meta.url), 'utf8')
assert('ChatPanel reads the pulled look\'s own row when it is not in the looks list',
  /from\('gp_looks'\)[\s\S]{0,300}\.eq\('id', currentLookId\)/.test(chat) && /pulledLook/.test(chat))
assert('the save box falls back to the restyled look\'s name for an in-place restyle too',
  /restyleReference\.lookId === \(replacesLookId \?\? currentLookId\)/.test(chat))

if (problems.length) {
  console.error(`\n❌ restyle-board: ${problems.length} of ${n} case(s) failed.\n`)
  process.exit(1)
}
console.log(`✅ restyle-board: ${n} case(s): the card names the picture, Restyle takes off only what she let go of, the name is kept.`)
