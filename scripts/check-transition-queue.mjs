#!/usr/bin/env node
/**
 * THE TRANSITIONS QUEUE, MEASURED OVER REAL ROWS.
 *
 * The defects this exists to catch, all three reported by Paige Berndt on 2026-09-17 while she
 * was working a batch of transitions on Alicia Hidalgo:
 *
 *   1. "the piece that shows up below the transition look is not always the only piece being
 *      transitioned ... I would have just clicked retire." The card has named every recorded
 *      cause since ADR-0121 and the data is good — but the queue was ordered by date, a look's
 *      date is its FIRST cause, and so every badly damaged look sank to the bottom. Her front
 *      fifth averaged 1.23 causes; the middle fifth 2.30. This guard fails if a card with fewer
 *      pieces missing is placed above one with more.
 *
 *   2. Duplicate work. A GoodPix look points at the board it was composed on, and 47 of Alicia's
 *      boards carried two pulled looks each — identical picture, identical pieces, identical
 *      causes. 47 of her 235 cards asked for work she had already done. This guard fails if two
 *      cards cover identical work.
 *
 *   3. Pieces on the board she does not own. Restyle stripped the RECORDED CAUSES and nothing
 *      else, so a piece transitioned out without being recorded as a cause of this look (it
 *      happens when a GoodPix re-sync rewrites closet_item_ids afterwards), or a deleted piece,
 *      was laid straight back onto the canvas. Saving that pulls the look out of the lookbook
 *      again. This guard fails if the board Restyle would build contains a piece she no longer
 *      owns.
 *
 * And nothing may be LOST to the grouping: every pulled look must be covered by exactly one card.
 *
 * Runs the SHIPPED modules over production rows, not a copy of them. Exits non-zero on any
 * failure AND on inspecting zero cards, because a guard that measured nothing is a failure.
 *
 *   node scripts/check-transition-queue.mjs                    # every client with pulled looks
 *   node scripts/check-transition-queue.mjs "Alicia Hidalgo"   # one client
 *   node scripts/check-transition-queue.mjs --legacy           # model the OLD behaviour: must FAIL
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
// The shipped modules. Node strips the types natively (>= 22.18).
const { groupPulledLooks, orderQueue, queueSummary, queueHeadline } = await import('../src/lib/transitionQueue.ts')
const { selectRestylePieces, omitReason } = await import('../src/lib/restyleSelection.ts')

const env = { ...process.env }
for (const file of ['../.env.local', '../.env']) {
  let text
  try { text = readFileSync(new URL(file, import.meta.url), 'utf8') } catch { continue }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const URL_ = env.VITE_SUPABASE_URL ?? env.PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !KEY) {
  console.error('\n❌ transition-queue: needs VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.\n')
  process.exit(1)
}
const sb = createClient(URL_, KEY)

const args = process.argv.slice(2)
const LEGACY = args.includes('--legacy')
const ONLY = args.find((a) => !a.startsWith('--')) ?? null

const problems = []
const fail = (msg) => { problems.push(msg); if (problems.length <= 25) console.error(`   ❌ ${msg}`) }

// PostgREST truncates a SELECT at 1000 rows and says nothing about it.
async function page(table, select, apply) {
  const out = []
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(select)
    q = apply(q)
    const { data, error } = await q.range(from, from + 999)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

/**
 * SHAPED CASES first — the rules that production rows happen not to exercise today but will the
 * moment the data moves. Production is the proof that the queue is right NOW; these are the proof
 * that it stays right. They run against the shipped modules, never against --legacy.
 */
let shaped = 0
if (!LEGACY) {
  const L = (o) => ({ id: 'x', name: '', image: null, boardId: null, causeItemIds: [], closetItemIds: [], source: 'goodpix', transitionedAt: null, ...o })
  const assert = (name, ok) => { shaped += 1; if (!ok) fail(`shaped case: ${name}`) }
  const card = (l) => ({ key: l.id, look: l, siblings: [], lookIds: [l.id] })

  assert('a look with no board is never merged with another',
    groupPulledLooks([L({ id: 'a' }), L({ id: 'b' })]).length === 2)
  assert('one board, DIFFERENT pieces, stays two cards',
    groupPulledLooks([L({ id: 'a', boardId: 'B', closetItemIds: ['1'] }), L({ id: 'b', boardId: 'B', closetItemIds: ['2'] })]).length === 2)
  {
    const c = groupPulledLooks([L({ id: 'a', boardId: 'B', closetItemIds: ['1'] }), L({ id: 'b', boardId: 'B', closetItemIds: ['2'] })])
    assert('two cards on one board get distinct React keys', c[0].key !== c[1].key)
  }
  {
    const c = groupPulledLooks([
      L({ id: 'a', boardId: 'B', image: 'i', closetItemIds: ['1', '2'], causeItemIds: ['1'] }),
      L({ id: 'b', boardId: 'B', image: 'i', closetItemIds: ['2', '1'], causeItemIds: ['1'] }),
    ])
    assert('identical looks merge and BOTH ids are carried for Retire',
      c.length === 1 && c[0].lookIds.length === 2 && c[0].siblings.length === 1)
  }
  {
    const q = orderQueue([
      card(L({ id: 'a', causeItemIds: ['1'], transitionedAt: '2026-01-01' })),
      card(L({ id: 'b', causeItemIds: ['1', '2'], transitionedAt: '2026-05-01' })),
      card(L({ id: 'c', causeItemIds: ['1'], transitionedAt: '2025-01-01' })),
    ])
    assert('most pieces missing comes first even when it is the newest', q[0].look.id === 'b')
    assert('among equals, the one dark longest comes first', q[1].look.id === 'c')
  }
  {
    const s = queueSummary(groupPulledLooks([
      L({ id: 'a', boardId: 'B', image: 'i', causeItemIds: ['1', '2'] }),
      L({ id: 'b', boardId: 'B', image: 'i', causeItemIds: ['1', '2'] }),
    ]))
    assert('the summary counts looks AND cards, not one or the other',
      s.cards === 1 && s.looks === 2 && s.collapsed === 1 && s.multiPiece === 1 && s.worst === 2)
    assert('the headline names the merge', /duplicate card merged/.test(queueHeadline(s)))
  }
  assert('an empty queue still has a sentence', queueHeadline(queueSummary([])).length > 0)
  {
    const P = (id, o = {}) => [id, { id, name: id, brand: null, ...o }]
    const pieces = new Map([P('keep'), P('gone', { transitionedAt: '2026-09-08' }), P('del', { isDeleted: true }), P('soft', { deletedAt: '2026-09-01' })])
    const sel = selectRestylePieces(['keep', 'gone', 'del', 'soft', 'ghost', 'keep'], pieces)
    assert('only a piece she still owns reaches the board, and a repeat is one node',
      sel.keep.length === 1 && sel.keep[0] === 'keep')
    assert('every omission is NAMED, including the piece with no row at all',
      sel.omitted.length === 4 && sel.omitted.map((o) => o.reason).join() === 'transitioned,deleted,deleted,missing')
    assert('a look with no pieces omits nothing rather than throwing',
      selectRestylePieces([], pieces).omitted.length === 0)
  }
  console.log(`\n   ${shaped} shaped case(s) over the shipped queue + selection rules`)
}

const { data: clientRows } = await sb.from('gp_clients').select('id, name')
const clientName = new Map((clientRows ?? []).map((c) => [c.id, c.name]))

let lookRows = await page(
  'gp_looks',
  // No thumbnail_url: it is a base64 2160x2160 JPEG per look, and useTransitions no longer
  // reads it either (src/lib/lookImage.ts). A guard must not pull megabytes a run.
  'id, client_id, name, source, source_board_id, raw, closet_item_ids, transitioned_at, transitioned_item_ids, archived',
  (q) => q.not('transitioned_at', 'is', null),
)
lookRows = lookRows.filter((l) => !l.archived)
if (ONLY) {
  const wanted = new Set([...clientName].filter(([, n]) => n?.toLowerCase().includes(ONLY.toLowerCase())).map(([id]) => id))
  lookRows = lookRows.filter((l) => wanted.has(l.client_id))
}

const clientIds = [...new Set(lookRows.map((l) => l.client_id))]

// Every piece referenced by a pulled look, as it stands RIGHT NOW. Not the cause list.
const referenced = new Set()
for (const l of lookRows) for (const id of l.closet_item_ids ?? []) referenced.add(id)
const pieceById = new Map()
{
  const ids = [...referenced]
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const { data, error } = await sb.from('gp_closet_items')
      .select('id, name, name_override, brand, transitioned_at, is_deleted, deleted_at')
      .in('id', chunk)
    if (error) throw error
    for (const r of data ?? []) {
      pieceById.set(r.id, {
        id: r.id,
        name: (r.name_override?.trim() || r.name) ?? 'Untitled piece',
        brand: r.brand && r.brand !== 'None' ? r.brand : null,
        transitionedAt: r.transitioned_at ?? null,
        isDeleted: r.is_deleted ?? null,
        deletedAt: r.deleted_at ?? null,
      })
    }
  }
}

// Shape the rows the way useTransitions does, so the guard grades the same objects the tab gets.
const toQueueLook = (l) => ({
  id: l.id,
  name: l.name ?? 'Untitled Look',
  image: l.raw?.main_image_url ?? null,
  boardId: l.source_board_id ?? null,
  causeItemIds: Array.isArray(l.transitioned_item_ids) ? l.transitioned_item_ids : [],
  closetItemIds: Array.isArray(l.closet_item_ids) ? l.closet_item_ids : [],
  source: l.source ?? null,
  transitionedAt: l.transitioned_at ?? null,
})

// The OLD behaviour, for --legacy: one card per look, newest first, strip the causes only.
function legacyQueue(looks) {
  return [...looks]
    .sort((a, b) => String(b.transitionedAt ?? '').localeCompare(String(a.transitionedAt ?? '')))
    .map((look) => ({ key: look.id, look, siblings: [], lookIds: [look.id] }))
}
function legacyKeep(look) {
  const gone = new Set(look.causeItemIds)
  return look.closetItemIds.filter((id) => !gone.has(id))
}

let cardsSeen = 0
let looksSeen = 0
let boardsOnCanvas = 0
let piecesPlaced = 0
let piecesWithheld = 0
let clientsSeen = 0

for (const clientId of clientIds) {
  const who = clientName.get(clientId) ?? clientId
  const looks = lookRows.filter((l) => l.client_id === clientId).map(toQueueLook)
  if (looks.length === 0) continue
  clientsSeen += 1

  const cards = LEGACY ? legacyQueue(looks) : orderQueue(groupPulledLooks(looks))
  cardsSeen += cards.length
  looksSeen += looks.length

  // ── 1. Worst first ────────────────────────────────────────────────────────────────────
  for (let i = 1; i < cards.length; i++) {
    const prev = cards[i - 1].look.causeItemIds.length
    const here = cards[i].look.causeItemIds.length
    if (here > prev) {
      fail(`${who}: card ${i + 1} is missing ${here} pieces but sits below a card missing ${prev} — the damaged looks are buried`)
      break   // one report per client: the ordering is wrong once, not 200 times
    }
  }

  // ── 2. Each piece of work once ────────────────────────────────────────────────────────
  const workKey = (l) => [
    l.boardId?.trim() || `no-board:${l.id}`,
    l.image ?? '',
    [...l.closetItemIds].sort().join(','),
    [...l.causeItemIds].sort().join(','),
  ].join('|')
  const seenWork = new Map()
  for (const card of cards) {
    const k = workKey(card.look)
    if (!card.look.boardId?.trim()) continue   // no board: cannot be a duplicate of anything
    if (seenWork.has(k)) {
      fail(`${who}: "${card.look.name || 'Untitled Look'}" is the same board, picture, pieces and causes as "${seenWork.get(k)}" — two cards, one job`)
    } else {
      seenWork.set(k, card.look.name || 'Untitled Look')
    }
  }

  // ── 3. Nothing lost to the grouping ───────────────────────────────────────────────────
  const covered = new Map()
  for (const card of cards) for (const id of card.lookIds) covered.set(id, (covered.get(id) ?? 0) + 1)
  for (const look of looks) {
    const n = covered.get(look.id) ?? 0
    if (n === 0) fail(`${who}: pulled look ${look.id} is on no card at all — it dropped out of the queue`)
    else if (n > 1) fail(`${who}: pulled look ${look.id} is on ${n} cards`)
  }

  // ── 4. Nothing on the board she does not own ──────────────────────────────────────────
  for (const card of cards) {
    const look = card.look
    const keep = LEGACY
      ? legacyKeep(look)
      : selectRestylePieces(look.closetItemIds, pieceById).keep
    boardsOnCanvas += 1
    piecesPlaced += keep.length
    piecesWithheld += look.closetItemIds.length - keep.length

    for (const id of keep) {
      const piece = pieceById.get(id)
      if (!piece) {
        fail(`${who} / "${look.name || 'Untitled Look'}": would place ${id}, which is not in her collection at all`)
        continue
      }
      const reason = omitReason(piece)
      if (reason) {
        fail(`${who} / "${look.name || 'Untitled Look'}": would place ${piece.brand ? piece.brand + ' ' : ''}${piece.name} on the board — ${reason}`)
      }
    }
  }
}

// One real headline, so the wording is exercised too rather than only the arithmetic.
if (clientIds.length) {
  const sampleId = clientIds[0]
  const sampleLooks = lookRows.filter((l) => l.client_id === sampleId).map(toQueueLook)
  const sampleCards = LEGACY ? legacyQueue(sampleLooks) : orderQueue(groupPulledLooks(sampleLooks))
  const s = queueSummary(sampleCards)
  console.log(`\n   e.g. ${clientName.get(sampleId)}: "${queueHeadline(s)}" (worst card missing ${s.worst})`)
}

console.log(`\n   ${cardsSeen} card(s) over ${looksSeen} pulled look(s), ${clientsSeen} client(s)`)
console.log(`   ${looksSeen - cardsSeen} duplicate card(s) merged away`)
console.log(`   ${boardsOnCanvas} restyle board(s) graded: ${piecesPlaced} pieces placed, ${piecesWithheld} withheld as no longer hers`)

if (cardsSeen === 0 && shaped === 0) {
  console.error('\n❌ transition-queue: 0 cards inspected. Nothing was verified.\n')
  process.exit(1)
}
if (problems.length) {
  if (problems.length > 25) console.error(`   … and ${problems.length - 25} more`)
  console.error(`\n❌ transition-queue: ${problems.length} failure(s) over ${cardsSeen} card(s)${LEGACY ? ' (--legacy: this is the point)' : ''}.\n`)
  process.exit(1)
}
console.log(`\n✅ transition-queue: ${cardsSeen} card(s), worst first, each job once, nothing on a board she no longer owns.\n`)
