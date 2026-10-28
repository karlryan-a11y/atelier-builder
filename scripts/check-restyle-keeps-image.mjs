#!/usr/bin/env node
/**
 * RESTYLE KEEPS HER OWN IMAGE ON HER OWN BOARD.
 *
 * Cynthia Dada, 2026-10-26, Janet Foutty Looks 316 and 319: "I need the image to stay on the
 * board." She adds her own picture of the top and sweater together as a piece, hides the separate
 * top and sweater (ADR-0146), and archives the picture so it stays out of Janet's closet. Then a
 * shoe is transitioned and she restyles the look to swap it. Restyle stripped every piece that
 * was transitioned OR deleted, so the archived picture vanished and only the hidden garments were
 * left, invisible, on an empty-looking board.
 *
 * On an Atelier look's own saved board, only a transitioned piece comes off. Everything else stays
 * exactly where she left it: the archived picture at its spot and size, the hidden pieces hidden.
 *
 * Runs the SHIPPED module (Node strips the types natively). No database.
 */
const { restyleSavedBoard, boardPieceIds, selectRestylePieces } = await import('../src/lib/restyleSelection.ts')

const problems = []
const assert = (name, ok) => { if (!ok) problems.push(name) }

const node = (id, closet_item_id, o = {}) => ({
  id, type: 'closet_item', closet_item_id, x: 10, y: 20, scale: 0.5, rotation: 0, flipped: false, z_index: 1, locked: false, ...o,
})
const canvas = {
  version: 1,
  canvas: { width: 1080, height: 1080, background: '#ffffff' },
  nodes: [
    node('n-image', 'combo', { x: 412, y: 96, scale: 0.37, scale_y: 0.41, z_index: 4 }),
    node('n-blouse', 'blouse', { hidden: true }),
    node('n-cardigan', 'cardigan', { hidden: true }),
    node('n-skirt', 'skirt'),
    node('n-shoe', 'shoe'),
    { id: 't1', type: 'text', content: 'Tuck In', font_family: 'x', font_size: 30, fill: '#000', x: 0, y: 0, rotation: 0, z_index: 5 },
  ],
}
const P = (id, o = {}) => [id, { id, name: id, brand: null, ...o }]
const pieces = new Map([
  P('combo', { isDeleted: true, deletedAt: '2026-10-01T15:00:00Z' }),   // her picture, archived
  P('blouse'), P('cardigan'), P('skirt'),
  P('shoe', { transitionedAt: '2026-10-20T15:00:00Z' }),
])

const { canvas: out, omitted } = restyleSavedBoard(canvas, pieces)
const byId = new Map(out.nodes.map((n) => [n.id, n]))

assert('her archived picture is still on the board', byId.has('n-image'))
assert('her picture is in the same spot and size',
  JSON.stringify(byId.get('n-image')) === JSON.stringify(canvas.nodes[0]))
assert('the separate blouse is still on the board, still hidden', byId.get('n-blouse')?.hidden === true)
assert('the separate cardigan is still on the board, still hidden', byId.get('n-cardigan')?.hidden === true)
assert('the transitioned shoe comes off', !byId.has('n-shoe'))
assert('the skirt and the label stay', byId.has('n-skirt') && byId.has('t1'))
assert('only the shoe is named as left off',
  omitted.length === 1 && omitted[0].id === 'shoe' && omitted[0].reason === 'transitioned')
assert('the saved board itself is not changed', canvas.nodes.length === 6)
{
  // Must not change: a piece she took off the look is not on the saved board, so restyle cannot
  // bring it back. It only ever takes nodes off, and copies the rest as they are.
  const before = new Map(canvas.nodes.map((n) => [n.id, JSON.stringify(n)]))
  assert('restyle adds nothing that was not on her board', out.nodes.every((n) => before.get(n.id) === JSON.stringify(n)))}
{
  // A piece with no row at all cannot be drawn: it comes off and is named, never silently, and
  // her archived picture on the same board is not dragged off with it.
  const r = restyleSavedBoard({ ...canvas, nodes: [...canvas.nodes, node('n-ghost', 'ghost')] }, pieces)
  const ids = new Set(r.canvas.nodes.map((n) => n.id))
  assert('a piece with no row comes off and is named', !ids.has('n-ghost') && r.omitted.some((o) => o.id === 'ghost' && o.reason === 'missing'))
  assert('her picture survives beside a piece with no row', ids.has('n-image'))
}
{
  // The pieces are read by the BOARD's ids, not by closet_item_ids. A stale column that does not
  // list the picture (or the hidden garments) must not turn them into "missing".
  const staleColumn = ['skirt', 'shoe']
  const ids = boardPieceIds(canvas)
  for (const want of ['combo', 'blouse', 'cardigan', 'skirt', 'shoe']) {
    assert(`the read list includes ${want}, which is on the board`, ids.includes(want))
  }
  const readByColumn = new Map([...pieces].filter(([id]) => staleColumn.includes(id)))
  assert('reading by a stale column WOULD lose the picture (why the read uses the board)',
    !restyleSavedBoard(canvas, readByColumn).canvas.nodes.some((n) => n.id === 'n-image'))
  const readByBoard = new Map([...pieces].filter(([id]) => ids.includes(id)))
  assert('reading by the board keeps the picture',
    restyleSavedBoard(canvas, readByBoard).canvas.nodes.some((n) => n.id === 'n-image'))
}
{
  // Must not change: the GoodPix pool rule still leaves off a deleted piece and a transitioned one.
  const sel = selectRestylePieces(['combo', 'shoe', 'skirt'], pieces)
  assert('the GoodPix pool rule is unchanged', sel.keep.join() === 'skirt' && sel.omitted.map((o) => o.reason).join() === 'deleted,transitioned')
}

{
  // Saving the restyle keeps the look's name and notes. The look is still pulled while she
  // restyles it, so it is not in the canvas looks list; the Save dialog used to open blank and
  // the save renamed Janet's Look 155 to "Untitled Look". ChatPanel reads the open look by id
  // when the list does not have it, and the dialog is filled from that.
  const fs = await import('node:fs')
  const src = fs.readFileSync(new URL('../src/components/layout/ChatPanel.tsx', import.meta.url), 'utf8')
  const looksHook = fs.readFileSync(new URL('../src/hooks/useLooks.ts', import.meta.url), 'utf8')
  assert('the canvas looks list still leaves pulled looks out (why the read below is needed)', /\.is\('transitioned_at', null\)/.test(looksHook))
  assert('ChatPanel reads a pulled look by its id for the Save dialog',
    /from\('gp_looks'\)[\s\S]{0,300}\.eq\('id', currentLookId\)/.test(src) && /currentLook = listedLook \?\? pulledLook/.test(src))
  assert('the Save dialog opens with that look\'s name and notes',
    /initialName=\{currentLook\?\.name/.test(src) && /initialNotes=\{currentLook\?\.notes_internal/.test(src))
}

if (problems.length) {
  for (const p of problems) console.error(`   ❌ ${p}`)
  console.error(`\n❌ restyle-keeps-image: ${problems.length} failure(s).\n`)
  process.exit(1)
}
console.log('✅ restyle-keeps-image: her own picture stays, hidden pieces stay hidden, only the transitioned piece comes off.')
