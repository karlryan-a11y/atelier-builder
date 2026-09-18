#!/usr/bin/env node
/**
 * THE ✨ STYLE BUTTON: DOES IT PUT THINGS WHERE A STYLIST WOULD, AND DOES IT KEEP EVERYTHING?
 * ADR-0128.
 *
 * Karl, 2026-09-18: "the purpose of the magic button is to auto organize the text and items into a
 * styled look ... based on past styled looks" and "we don't want it to wipe" and "only brands we're
 * sure of". Graded two ways, both against the SHIPPED src/lib/styleFromTemplates.ts:
 *
 * A. HELD-OUT REAL LOOKS. Take a real look from the library, hide it (and every look on the same
 *    GoodPix board), give ✨ the same pieces, and measure how far each piece and each label lands
 *    from where the stylist put it — as a share of the board's diagonal. The OLD button (fixed
 *    spots per category from three reference looks, modelled below from src/lib/compose.ts) is
 *    graded on the same looks. Fails unless the new button beats the old on BOTH the median piece
 *    error and the share of pieces within 10% of where the stylist put them.
 *
 * B. NOTHING DELETED, NOTHING INVENTED. Shaped boards: every node that went in comes out; a
 *    stylist's note moves with its piece; a picture stays; a label is written only for a piece with
 *    a saved brand; a brand already on the board is moved, not written twice; the same board gives
 *    the same answer; her own look ranks first. --legacy grades the OLD button's "clear the board
 *    and re-add the pieces" and must FAIL.
 *
 * Exits non-zero on any failure and on grading nothing.
 *
 *   node scripts/check-style-templates.mjs            # 400 held-out looks + shaped cases
 *   node scripts/check-style-templates.mjs --legacy   # the old wiping button: must FAIL part B
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const T = await import('../src/lib/styleFromTemplates.ts')

const env = { ...process.env }
for (const f of ['../.env.local', '../.env']) {
  let t; try { t = readFileSync(new URL(f, import.meta.url), 'utf8') } catch { continue }
  for (const l of t.split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const LEGACY = process.argv.includes('--legacy')
const HOLDOUT = 400

const problems = []
const fail = (m) => { problems.push(m); if (problems.length <= 20) console.error(`   ❌ ${m}`) }

// ── B. shaped boards ──────────────────────────────────────────────────────────────────────────
// The OLD button, for --legacy: styleCanvas + handleStyle cleared the board and re-added only the
// pieces and fresh brand labels (CanvasToolbar.tsx before ADR-0128).
function legacyStyle(nodes, pieces) {
  const out = nodes.filter((n) => n.type === 'closet_item').map((n) => ({ ...n }))
  for (const p of pieces) if (p.brand) out.push({ id: `txt_${p.nodeId}`, type: 'text', content: p.brand, font_family: 'x', font_size: 32, fill: '#000', x: 0, y: 0, rotation: 0, z_index: 100 })
  return { nodes: out }
}
let shaped = 0
{
  const ok = (name, c) => { shaped++; if (!c) fail(`shaped: ${name}`) }
  const ci = (id, x, pieceId = id) => ({ id, type: 'closet_item', closet_item_id: pieceId, x, y: 100, scale: 1, target_height: 200, rotation: 0, flipped: false, z_index: 1, locked: false })
  const nodes = [
    ci('n_top', 100), ci('n_shoe', 400),
    { id: 'note', type: 'text', content: 'tuck in', font_family: 'x', font_size: 20, fill: '#000', x: 110, y: 330, rotation: 0, z_index: 5 },
    { id: 'lbl', type: 'text', content: 'Vince', font_family: 'x', font_size: 20, fill: '#000', x: 800, y: 800, rotation: 0, z_index: 6 },
    { id: 'pic', type: 'picture', src: 'https://x/y.png', x: 700, y: 50, width: 100, height: 100, rotation: 0, flipped: false, z_index: 2, locked: false },
  ]
  const pieces = [
    { nodeId: 'n_top', pieceId: 'n_top', type: 'top', brand: null },
    { nodeId: 'n_shoe', pieceId: 'n_shoe', type: 'shoes', brand: 'Vince' },
  ]
  const tpl = {
    look_id: 'L1', look_name: 'T', client_id: 'C1', board_id: 'B1', mix_key: 'shoes+top', types_key: 'shoes+top', board_w: 1080, board_h: 1080,
    slots: [{ type: 'top', cx: 540, cy: 300, w: 300, h: 400, rotation: 0, flipped: false, z: 2 }, { type: 'shoes', cx: 540, cy: 900, w: 200, h: 120, rotation: 0, flipped: false, z: 1 }],
    labels: [{ slot: 0, dx: -300, dy: -250, font_family: 'A', font_size: 30, fill: '#111', rotation: 0 }, { slot: 1, dx: 120, dy: 20, font_family: 'A', font_size: 30, fill: '#111', rotation: 0 }],
  }
  const board = { width: 1080, height: 1080 }
  const run = () => (LEGACY ? legacyStyle(nodes, pieces) : T.arrangeFromTemplate(board, nodes, pieces, tpl, () => ({ w: 150, h: 200 })))
  const r = run()
  const ids = new Set(r.nodes.map((n) => n.id))
  ok('every node that went in comes out (nothing wiped)', nodes.every((n) => ids.has(n.id)))
  ok('the picture is untouched', JSON.stringify(r.nodes.find((n) => n.id === 'pic')) === JSON.stringify(nodes[4]))
  if (!LEGACY) {
    const topBefore = { x: 100 + 75, y: 200 }, topAfter = { x: 540, y: 300 }
    const note = r.nodes.find((n) => n.id === 'note')
    ok('a note moves with the piece it sat beside', note && Math.abs(note.x - (110 + topAfter.x - topBefore.x)) < 1e-6 && Math.abs(note.y - (330 + topAfter.y - topBefore.y)) < 1e-6)
    ok('no label is written for a piece with no saved brand', !r.nodes.some((n) => n.type === 'text' && n.id.startsWith('tx_style_n_top')))
    ok('a brand already on the board is moved to the label spot, not written twice',
      r.nodes.filter((n) => n.type === 'text' && n.content === 'Vince').length === 1 && r.nodes.find((n) => n.id === 'lbl').x === 540 + 120)
    ok('each piece is centred on its slot', (() => { const t = r.nodes.find((n) => n.id === 'n_top'); return Math.abs(t.x + 150 * (400 / 200) / 2 - 540) < 1e-6 })())
    ok('the same board gives the same answer', JSON.stringify(run()) === JSON.stringify(r))
    const other = { ...tpl, look_id: 'L0', client_id: 'C2', board_id: 'B0' }
    ok('her own look ranks before another client\'s', T.rankTemplates(['top', 'shoes'], [other, tpl], { clientId: 'C1', board }).map((t) => t.look_id).join() === 'L1,L0')
    ok('the exact mix ranks before the same types in other numbers',
      T.rankTemplates(['top', 'shoes'], [{ ...tpl, look_id: 'L9', board_id: 'B9', mix_key: 'shoes+shoes+top' }, other], { clientId: 'C1', board })[0].look_id === 'L0')
    ok('two looks on one GoodPix board count once', T.rankTemplates(['top', 'shoes'], [tpl, { ...tpl, look_id: 'L2' }], { board }).length === 1)
    const two = T.arrangeFromTemplate(board, [ci('s1', 900), ci('s2', 100)], [{ nodeId: 's1', pieceId: 's1', type: 'shoes', brand: null }, { nodeId: 's2', pieceId: 's2', type: 'shoes', brand: null }],
      { ...tpl, slots: [{ ...tpl.slots[1], cx: 300 }, { ...tpl.slots[1], cx: 800 }], labels: [] }, () => ({ w: 100, h: 200 }))
    ok('two of a kind keep their left/right order', two.nodes.find((n) => n.id === 's2').x < two.nodes.find((n) => n.id === 's1').x)
  }
  console.log(`\n   ${shaped} shaped case(s)${LEGACY ? ' over the OLD button' : ''}`)
}

// ── A. held-out real looks ────────────────────────────────────────────────────────────────────
// The OLD placement, modelled from src/lib/compose.ts placeItems (the default path): fixed centre
// per category inside a 6%/5% margin frame, fixed target height scaled to the frame.
const OLD_RULES = { dress: [50, 43], top: [50, 17], bottom: [50, 50], outerwear: [30, 17], bag: [78, 45], shoes: [50, 82], jewelry: [80, 15], belt: [50, 36], accessory: [82, 25], other: [78, 65] }
function oldCentre(type, idx, count, board) {
  const mx = Math.round(board.width * 0.06), my = Math.round(board.height * 0.05)
  const fw = board.width - 2 * mx, fh = board.height - 2 * my
  const [xp, yp] = OLD_RULES[type] ?? OLD_RULES[type === 'scarf' || type === 'hat' ? 'accessory' : 'other']
  let cxp = xp
  if (count > 1) { const tw = fw * 0.7, sx = (fw - tw) / 2, sp = tw / count; cxp = ((sx + sp * (idx + 0.5)) / fw) * 100 }
  return { x: mx + (cxp / 100) * fw, y: my + (yp / 100) * fh }
}

let graded = 0, piecesGraded = 0, labelsGraded = 0
const newErr = [], oldErr = [], lblErr = []
if (!LEGACY) {
  const all = []
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from('look_templates')
      .select('look_id, look_name, client_id, board_id, mix_key, types_key, board_w, board_h, slots, labels').order('look_id').range(f, f + 999)
    if (error) throw error
    all.push(...data)
    if (data.length < 1000) break
  }
  const byMix = new Map(), byTypes = new Map()
  for (const t of all) {
    byMix.set(t.mix_key, [...(byMix.get(t.mix_key) ?? []), t])
    byTypes.set(t.types_key, [...(byTypes.get(t.types_key) ?? []), t])
  }
  // Deterministic spread across the library: every k-th look that has a partner elsewhere.
  const eligible = all.filter((t) => (byMix.get(t.mix_key) ?? []).some((o) => (o.board_id || o.look_id) !== (t.board_id || t.look_id)))
  const step = Math.max(1, Math.floor(eligible.length / HOLDOUT))
  for (let i = 0; i < eligible.length && graded < HOLDOUT; i += step) {
    const H = eligible[i]
    const board = { width: H.board_w, height: H.board_h }
    const hb = H.board_id || H.look_id
    const cands = [...new Set([...(byMix.get(H.mix_key) ?? []), ...(byTypes.get(H.types_key) ?? [])])]
    const types = H.slots.map((s) => s.type)
    const ranked = T.rankTemplates(types, cands, { clientId: H.client_id, board, exclude: (t) => (t.board_id || t.look_id) === hb })
    if (!ranked.length) continue
    // The board as a stylist would hand it over: pieces in, roughly left-to-right as she dropped
    // them (their x order only), a brand on every piece the real look labelled.
    const nodes = H.slots.map((s, j) => ({ id: `n${j}`, type: 'closet_item', closet_item_id: `p${j}`, x: s.cx - s.w / 2, y: 0, scale: 1, target_height: s.h, rotation: 0, flipped: false, z_index: 0, locked: false }))
    const pieces = H.slots.map((s, j) => ({ nodeId: `n${j}`, pieceId: `p${j}`, type: s.type, brand: H.labels.some((l) => l.slot === j) ? 'Brand' : null }))
    const r = T.arrangeFromTemplate(board, nodes, pieces, ranked[0], (id) => { const s = H.slots[Number(id.slice(1))]; return { w: s.w, h: s.h } })
    const diag = Math.hypot(board.width, board.height)
    const seenOfType = new Map()
    H.slots.forEach((s, j) => {
      const n = r.nodes.find((x) => x.id === `n${j}`)
      const w = (s.w / s.h) * n.target_height
      const cx = n.flipped ? n.x - w / 2 : n.x + w / 2, cy = n.y + n.target_height / 2
      newErr.push(Math.hypot(cx - s.cx, cy - s.cy) / diag)
      const same = H.slots.filter((o) => o.type === s.type).sort((a, b) => a.cx - b.cx)
      const idx = same.indexOf(s)
      const o = oldCentre(s.type, idx, same.length, board)
      oldErr.push(Math.hypot(o.x - s.cx, o.y - s.cy) / diag)
      seenOfType.set(s.type, (seenOfType.get(s.type) ?? 0) + 1)
      piecesGraded++
      const truth = H.labels.find((l) => l.slot === j)
      if (truth) {
        const made = r.nodes.find((x) => x.type === 'text' && x.id.startsWith(`tx_style_n${j}_`))
        if (made) { lblErr.push(Math.hypot(made.x - (s.cx + truth.dx), made.y - (s.cy + truth.dy)) / diag); labelsGraded++ }
      }
    })
    graded++
  }
}

const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN }
const within = (a, t) => a.length ? a.filter((x) => x <= t).length / a.length : 0
if (!LEGACY) {
  const nm = median(newErr), om = median(oldErr), nw = within(newErr, 0.10), ow = within(oldErr, 0.10)
  console.log(`\n   ${graded} held-out real looks, ${piecesGraded} pieces, ${labelsGraded} brand labels`)
  console.log(`   pieces, median distance from where the stylist put them: NEW ${(100 * nm).toFixed(1)}%   OLD ${(100 * om).toFixed(1)}%  (of the board diagonal)`)
  console.log(`   pieces within 10% of the stylist's spot:                  NEW ${(100 * nw).toFixed(1)}%   OLD ${(100 * ow).toFixed(1)}%`)
  console.log(`   labels, median distance:                                  NEW ${(100 * median(lblErr)).toFixed(1)}%   OLD n/a (fixed offsets)`)
  if (graded === 0) fail('no held-out look could be graded')
  else {
    if (!(nm < om)) fail(`the new button is not closer than the old: median ${(100 * nm).toFixed(1)}% vs ${(100 * om).toFixed(1)}%`)
    if (!(nw > ow)) fail(`the new button does not land more pieces near the stylist's spot: ${(100 * nw).toFixed(1)}% vs ${(100 * ow).toFixed(1)}%`)
  }
}

if (shaped === 0 && graded === 0) { console.error('\n❌ style-templates: nothing graded.\n'); process.exit(1) }
if (problems.length) {
  console.error(`\n❌ style-templates: ${problems.length} failure(s)${LEGACY ? ' (--legacy: this is the point)' : ''}.\n`)
  process.exit(1)
}
console.log(`\n✅ style-templates: arranges like past looks, and keeps everything on the board.\n`)
