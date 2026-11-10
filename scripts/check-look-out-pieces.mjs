#!/usr/bin/env node
/**
 * THE TRANSITIONS CARD NAMES EVERY PIECE THE OPENED LOOK IS MISSING.
 *
 * Paige Berndt, 2026-11-10, Alicia Hidalgo: "some items that have been transitioned appear listed
 * below the look, but when I click on the look, there are actually more pieces missing than what
 * was originally indicated." Her 'Untitled Look' card read "2 pieces removed · by the client,
 * Nov 9"; opened, the look was missing four (an Anne Klein blazer and a Hobbs blouse had gone
 * earlier). The card read `transitioned_item_ids`, which keeps only the latest transition.
 *
 * Holds three things:
 *   1. lib/lookOutPieces.ts gives the board's list: every piece IN THE PICTURE she no longer has,
 *      whoever took it out and whenever, and not a pool piece that was never in the picture.
 *   2. The caption counts them all and never claims one "by X, date" for pieces that went at
 *      different times or by different people.
 *   3. The card (hooks/useTransitions.ts) and the opened look (lib/goodpixBoard.ts) both ask
 *      lib/lookOutPieces.ts, so the two cannot drift apart again.
 *
 * Runs the SHIPPED modules (Node strips the types natively). No database.
 */
import { readFileSync } from 'node:fs'

const { piecesOutOfLook, lookCandidateIds } = await import('../src/lib/lookOutPieces.ts')
const { causeCaption } = await import('../src/lib/transitionCaption.ts')

const problems = []
const assert = (name, ok) => { if (!ok) problems.push(name) }

// ── 1. The Untitled Look, as it stands in Alicia's data ──────────────────────────────────────────
const img = (o) => ({ type: 'image', left: 0, top: 0, width: 100, height: 100, ...o })
const layout = {
  v: 1,
  objects: [
    img({ closetItemId: 'blazer' }),
    img({ productId: 'blouse' }),            // her own piece carried only as productId (ADR-0132)
    img({ closetItemId: 'flat' }),
    img({ closetItemId: 'shoe' }),
    img({ closetItemId: 'earrings' }),
    img({ closetItemId: 'pant' }),
    { type: 'textbox', text: 'tuck in' },
  ],
  pool: [{ id: 'pool-boot', urls: [] }],    // tried on the board, never in the picture
}
const look = { source: 'goodpix', closetItemIds: ['blazer', 'blouse', 'flat', 'shoe', 'earrings', 'pant', 'pool-boot'], layout }
const P = (id, o = {}) => [id, { id, name: id, brand: null, urls: [], ...o }]
const pieces = new Map([
  P('blazer', { brand: 'Anne Klein', transitionedAt: '2026-09-08T19:49:04Z' }),
  P('blouse', { brand: 'Hobbs', transitionedAt: '2026-09-08T19:50:00Z' }),
  P('flat', { transitionedAt: '2026-11-10T02:40:00Z' }),
  P('shoe', { transitionedAt: '2026-11-10T02:43:35Z' }),
  P('earrings'), P('pant'),
  P('pool-boot', { transitionedAt: '2026-08-01T00:00:00Z' }),
])
const recordedCauses = ['shoe', 'flat']    // what transitioned_item_ids holds: the latest event only

const candidates = lookCandidateIds(look)
assert('candidates include a piece the picture carries only as productId', candidates.includes('blouse'))
const out = piecesOutOfLook(look, pieces).map((o) => o.id)
assert(`card names all 4 missing pieces in the look's order (got ${out.join(',')})`, out.join(',') === 'blazer,blouse,flat,shoe')
assert('card does not count a pool piece that was never in the picture', !out.includes('pool-boot'))
assert('more than the recorded causes: the earlier transition is on the card', out.length > recordedCauses.length)

// Without a stored arrangement the look's own list decides, as on the board's grid.
const noLayout = piecesOutOfLook({ source: 'goodpix', closetItemIds: ['blazer', 'pant', 'gone-row'], layout: null }, pieces)
assert('no arrangement: transitioned and missing rows are both named', noLayout.map((o) => `${o.id}:${o.reason}`).join(',') === 'blazer:transitioned,gone-row:missing')

// An Atelier look: its saved board decides, and a deleted picture she placed stays (restyleSavedBoard).
const node = (id) => ({ id: `n-${id}`, type: 'closet_item', closet_item_id: id, x: 0, y: 0, scale: 1, rotation: 0, flipped: false, z_index: 1, locked: false })
const board = piecesOutOfLook({ source: 'builder', closetItemIds: ['pant'], boardNodes: [node('blazer'), node('combo'), node('pant')] },
  new Map([...pieces, P('combo', { isDeleted: true })]))
assert(`builder look: the board's transitioned piece, not the deleted picture (got ${board.map((o) => o.id).join(',')})`, board.map((o) => o.id).join(',') === 'blazer')

// ── 2. What the card says ────────────────────────────────────────────────────────────────────────
const who = (id) => {
  const p = pieces.get(id)
  return p && { id, name: p.name, brand: p.brand, source: ['blazer', 'blouse'].includes(id) ? 'stylist' : 'client', transitionedAt: p.transitionedAt }
}
const mixed = causeCaption(out, who, '2026-11-10T02:43:35Z')
assert(`headline counts every piece (got "${mixed.headline}")`, /^4 pieces removed/.test(mixed.headline))
assert(`mixed people and dates: no single "by X" on the headline (got "${mixed.headline}")`, !/by /.test(mixed.headline))
assert('mixed: each piece says who took it out', mixed.pieces.every((p) => /^by (a stylist|the client)/.test(p.note ?? '')))
assert('mixed: the blazer is credited to a stylist, the shoe to the client',
  /stylist/.test(mixed.pieces.find((p) => p.id === 'blazer')?.note ?? '') && /client/.test(mixed.pieces.find((p) => p.id === 'shoe')?.note ?? ''))

const same = causeCaption(['flat', 'shoe'], who, '2026-11-10T02:43:35Z')
assert(`one event: said once on the headline (got "${same.headline}")`, /^2 pieces removed · by the client, /.test(same.headline) && same.pieces.every((p) => p.note === null))

const deleted = causeCaption(['shoe', 'x'], (id) => (id === 'x' ? { id, name: 'x', brand: null, source: null, reason: 'deleted' } : who(id)), null)
assert('a deleted piece says so instead of a transition', deleted.pieces.find((p) => p.id === 'x')?.note === 'deleted from her collection')

// ── 3. One rule, two screens ─────────────────────────────────────────────────────────────────────
const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
const hook = read('hooks/useTransitions.ts')
assert('the card (useTransitions) asks lib/lookOutPieces.ts', /piecesOutOfLook\(/.test(hook))
assert('the card fetches the arrangement and the board it decides from', /gp_layout/.test(hook) && /canvas_state->nodes/.test(hook))
const gp = read('lib/goodpixBoard.ts')
assert('the opened GoodPix look asks lib/lookOutPieces.ts too', /goodPixInPicture\(/.test(gp) && !/piecesInLayout\(/.test(gp))

if (problems.length) {
  console.error('\n❌ look-out-pieces: the Transitions card and the opened look disagree:')
  for (const p of problems) console.error('   - ' + p)
  console.error('')
  process.exit(1)
}
console.log('✅ look-out-pieces: the card names every piece the opened look is missing, with who and when.')
