#!/usr/bin/env node
/**
 * THE ✨ BUTTON LAYS OUT EVERY LOOK LIKE THE MICHELE SAMPLE LOOKS.
 *
 * Amaia Anderson asked for looks that format themselves; Karl, 2026-10-27: "the item placement is
 * perfect every time including the brand text", using the method that styled the Michele sample
 * looks (wsg-dashboard src/lib/proposalBuilder/layout.ts lookCanvas()). Copying a past look gave a
 * tiny Tory Burch bag, no label on the bag or the necklace, and a top against the edge.
 *
 * A. ✨ runs the house layout (CanvasToolbar -> lib/style.ts -> lib/houseLayout.ts), not a copy of
 *    a past look.
 * B. The five boards of the acceptance test, and each again pressed a second time (the mirror),
 *    on a portrait board, and with 4 accessories: every piece's visible box inside the board with
 *    a margin, no two pieces overlapping, the bag and the jewelry a real size, one Amalfi Coast
 *    label under every piece, no label on a piece.
 * C. With the dashboard checkout beside this one, a look with no outer layer comes out exactly
 *    where lookCanvas() puts it (the Michele look 4 mix).
 * D. Nothing deleted: a note moves with its piece, a brand already on the board is moved and not
 *    written twice, pictures and hidden or locked pieces stay, a piece with no brand gets no label,
 *    and pressing twice never adds a second label.
 *
 * Exits non-zero on any failure and on checking nothing.
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const failures = []
let checked = 0
const ok = (name, cond) => { checked++; if (!cond) failures.push(name) }

// ── A. the button runs the house layout ───────────────────────────────────────────────────────
const toolbar = readFileSync(path.join(here, '../src/components/canvas/CanvasToolbar.tsx'), 'utf8')
const style = readFileSync(path.join(here, '../src/lib/style.ts'), 'utf8')
const handler = toolbar.slice(toolbar.indexOf('const handleStyle'), toolbar.indexOf('const handleAddText'))
ok('✨ calls styleHouse (the house layout)', /styleHouse\(/.test(handler))
ok('✨ no longer copies a past look', !/styleFromPastLooks\(/.test(handler))
ok('styleHouse lays out with houseLayout()', /export async function styleHouse[\s\S]*houseLayout\(/.test(style))

let H
try { H = await import('../src/lib/houseLayout.ts') } catch (e) { failures.push(`src/lib/houseLayout.ts could not be loaded: ${e.message}`) }

if (H) {
  // Photos as they come: transparent margins around the piece (natural px), like real cut-outs.
  const P = {
    top: { natW: 900, natH: 1200, content: [80, 60, 820, 1100] },
    pants: { natW: 800, natH: 1600, content: [150, 40, 650, 1560] },
    loafers: { natW: 1200, natH: 800, content: [60, 260, 1140, 600] },
    bag: { natW: 1200, natH: 1200, content: [100, 300, 1100, 900] },
    necklace: { natW: 1000, natH: 1000, content: [330, 60, 670, 940] },
    jacket: { natW: 1000, natH: 1200, content: [40, 30, 960, 1180] },
    dress: { natW: 800, natH: 1800, content: [100, 30, 700, 1770] },
    pumps: { natW: 1000, natH: 700, content: [50, 120, 950, 640] },
    sunglasses: { natW: 1200, natH: 600, content: [80, 150, 1120, 470] },
    earrings: { natW: 800, natH: 800, content: [250, 120, 550, 700] },
    belt: { natW: 1400, natH: 500, content: [40, 180, 1360, 330] },
    hat: { natW: 1200, natH: 900, content: [40, 200, 1160, 720] },
  }
  const TYPE = { top: 'top', pants: 'bottom', loafers: 'shoes', bag: 'bag', necklace: 'jewelry', jacket: 'outerwear', dress: 'dress', pumps: 'shoes', sunglasses: 'accessory', earrings: 'jewelry', belt: 'belt', hat: 'hat' }
  const BRAND = { top: 'Reiss', pants: 'Staud', loafers: 'Versace', bag: 'Tory Burch', necklace: 'Ana Luisa', jacket: 'Ralph Lauren', dress: 'Cecilie Bahnsen', pumps: 'Stuart Weitzman', sunglasses: 'Versace', earrings: 'Chan Luu', belt: 'Veronica Beard', hat: 'Eric Javets' }
  const SETS = {
    'top + pants + loafers + Tory Burch bag + necklace': ['top', 'pants', 'loafers', 'bag', 'necklace'],
    'the same plus a jacket': ['top', 'pants', 'loafers', 'bag', 'necklace', 'jacket'],
    'dress + shoes + bag': ['dress', 'pumps', 'bag'],
    'dress + jacket + shoes + 2 accessories': ['dress', 'jacket', 'pumps', 'sunglasses', 'earrings'],
    'a set with 3 accessories': ['top', 'pants', 'loafers', 'bag', 'belt', 'hat'],
    'a set with 4 accessories': ['top', 'pants', 'loafers', 'bag', 'necklace', 'belt', 'hat'],
    'dress + jacket + shoes + 3 accessories': ['dress', 'jacket', 'pumps', 'bag', 'sunglasses', 'earrings'],
  }
  // Dropped the way a stylist drags them in: piled up near the middle.
  const board = (keys, extra = []) => {
    const nodes = keys.map((k, i) => ({ id: `n_${k}`, type: 'closet_item', closet_item_id: `p_${k}`, x: 300 + i * 40, y: 200 + i * 30, scale: 1, target_height: 300, rotation: 0, flipped: false, z_index: i, locked: false }))
    const pieces = keys.map((k) => ({ nodeId: `n_${k}`, pieceId: `p_${k}`, type: TYPE[k], brand: BRAND[k], ...P[k] }))
    return { nodes: [...nodes, ...extra], pieces }
  }
  // A label's drawn box, from its own font size (Amalfi Coast runs about 0.55 em a letter).
  const measure = (t, size) => t.length * size * 0.55
  const visible = (n, p) => {
    const [l, t, r, b] = p.content
    const s = n.scale
    return n.flipped ? [n.x - r * s, n.y + t * s, n.x - l * s, n.y + b * s] : [n.x + l * s, n.y + t * s, n.x + r * s, n.y + b * s]
  }
  const glyphs = (tx) => { const w = measure(tx.content, tx.font_size); const x = tx.x + ((tx.width ?? w) - w) / 2; return [x, tx.y, x + w, tx.y + tx.font_size * 1.1] }
  const cross = (a, b) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 0.5 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0.5

  const grade = (name, keys, bd, variant) => {
    const { nodes, pieces } = board(keys)
    const r = H.houseLayout(bd, nodes, pieces, { variant, measure })
    const M = 20 * Math.min(bd.width, bd.height) / 1080
    const boxes = new Map()
    for (const p of pieces) {
      const n = r.nodes.find((x) => x.id === p.nodeId)
      const b = visible(n, p)
      boxes.set(p.nodeId, b)
      ok(`${name}: ${p.pieceId} is inside the board with a margin (${b.map(Math.round)})`, b[0] >= M && b[1] >= M && b[2] <= bd.width - M && b[3] <= bd.height - M)
      ok(`${name}: ${p.pieceId} has no target_height left to override its size`, n.target_height === undefined)
    }
    const ids = [...boxes.keys()]
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) ok(`${name}: ${ids[i]} and ${ids[j]} do not overlap`, !cross(boxes.get(ids[i]), boxes.get(ids[j])))
    const k = Math.min(bd.width, bd.height) / 1080
    for (const p of pieces) {
      const [l, t, rr, b] = boxes.get(p.nodeId)
      const long = Math.max(rr - l, b - t)
      if (p.type === 'bag') ok(`${name}: the bag is a real size (${Math.round(long)} px across, want 140+)`, long >= 140 * k)
      if (p.type === 'jewelry' || p.type === 'accessory' || p.type === 'belt' || p.type === 'hat') ok(`${name}: the ${p.pieceId} is a real size (${Math.round(long)} px, want 100+)`, long >= 100 * k)
    }
    const texts = r.nodes.filter((n) => n.type === 'text')
    ok(`${name}: one label per piece (${texts.length} for ${pieces.length})`, texts.length === pieces.length)
    for (const p of pieces) {
      const [l, , rr, b] = boxes.get(p.nodeId)
      const mine = texts.filter((t) => t.content === p.brand && glyphs(t)[1] >= b - 0.5 && glyphs(t)[1] <= b + 40 * k && (glyphs(t)[0] + glyphs(t)[2]) / 2 > l && (glyphs(t)[0] + glyphs(t)[2]) / 2 < rr)
      ok(`${name}: "${p.brand}" sits right under ${p.pieceId}`, mine.length === 1)
    }
    for (const t of texts) {
      ok(`${name}: label "${t.content}" is in Amalfi Coast`, /Amalfi Coast/.test(t.font_family))
      ok(`${name}: label "${t.content}" is one line`, t.width === undefined || measure(t.content, t.font_size) <= t.width)
      const g = glyphs(t)
      ok(`${name}: label "${t.content}" is on the board`, g[0] >= 0 && g[2] <= bd.width && g[3] <= bd.height)
      for (const [id, b] of boxes) ok(`${name}: label "${t.content}" does not touch ${id}`, !cross(g, b))
    }
    return r
  }

  const SQUARE = { width: 1080, height: 1080 }
  for (const [name, keys] of Object.entries(SETS)) {
    grade(name, keys, SQUARE, 0)
    grade(`${name} (pressed again)`, keys, SQUARE, 1)
    grade(`${name} (portrait board)`, keys, { width: 1200, height: 1600 }, 0)
  }
  ok('a look with a dress and a jacket uses the dress-and-outer boxes', H.houseLayout(SQUARE, ...Object.values(board(SETS['dress + jacket + shoes + 2 accessories']))).layout === 'DRESS_OUTER')
  ok('a look with only bags is an even grid', H.houseLayout(SQUARE, ...Object.values(board(['bag', 'belt', 'hat']))).layout === 'GRID')
  grade('only accessories', ['bag', 'belt', 'hat'], SQUARE, 0)

  // ── C. exactly the Michele layout ───────────────────────────────────────────────────────────
  const dash = [path.join(here, '../../wsg-dashboard/src/lib/proposalBuilder/layout.ts'), path.join(process.env.HOME ?? '', 'Downloads/wsg-dashboard/src/lib/proposalBuilder/layout.ts')].find(existsSync)
  if (dash) {
    const L = await import(dash)
    const img = (k) => ({ itemId: `p_${k}`, brand: BRAND[k], w: P[k].natW, h: P[k].natH, bbox: P[k].content })
    // Every box set the same as lookCanvas, except NO_OUTER's shoe and accessories (houseLayout.ts
    // says why), where the top and the bottom still are.
    const cases = [
      ['with a jacket', ['top', 'pants', 'loafers', 'bag', 'necklace', 'jacket'], { outer: img('jacket'), top: img('top'), bottom: img('pants'), shoe: img('loafers'), acc: [img('bag'), img('necklace')] }, null],
      ['a dress', ['dress', 'pumps', 'bag'], { top: img('dress'), bottom: img('dress'), shoe: img('pumps'), acc: [img('bag')] }, null],
      ['a dress and a jacket', ['dress', 'jacket', 'pumps', 'sunglasses', 'earrings'], { outer: img('jacket'), top: img('dress'), bottom: img('dress'), shoe: img('pumps'), acc: [img('earrings'), img('sunglasses')] }, null],
      ['no outer layer', ['top', 'pants', 'loafers', 'bag', 'necklace'], { top: img('top'), bottom: img('pants'), shoe: img('loafers'), acc: [img('bag'), img('necklace')] }, ['p_top', 'p_pants']],
    ]
    for (const [what, keys, parts, only] of cases) {
      const want = L.lookCanvas(parts)
      const { nodes, pieces } = board(keys)
      const got = H.houseLayout(SQUARE, nodes, pieces, { measure: (t) => t.length * 4 })
      for (const w of want.nodes.filter((n) => n.type === 'closet_item' && (!only || only.includes(n.closet_item_id)))) {
        const g = got.nodes.find((n) => n.closet_item_id === w.closet_item_id)
        ok(`${what}: same spot as lookCanvas for ${w.closet_item_id} (want ${w.x},${w.y} x${w.scale}, got ${g?.x},${g?.y} x${g?.scale})`, g && Math.abs(g.x - w.x) < 0.02 && Math.abs(g.y - w.y) < 0.02 && Math.abs(g.scale - w.scale) < 1e-4)
      }
      for (const w of want.nodes.filter((n) => n.type === 'text' && (!only || only.some((id) => BRAND[id.slice(2)] === n.content)))) {
        const g = got.nodes.find((n) => n.type === 'text' && n.content === w.content)
        ok(`${what}: label "${w.content}" at the same height and centre as lookCanvas`, g && Math.abs(g.y - w.y) < 0.02 && Math.abs((g.x + g.width / 2) - (w.x + w.width / 2)) < 0.02 && g.font_size === w.font_size)
      }
    }
  } else console.log('   (wsg-dashboard not beside this checkout: the exact-match to lookCanvas is skipped)')

  // ── D. nothing deleted, nothing doubled ─────────────────────────────────────────────────────
  {
    const note = { id: 'note', type: 'text', content: 'tuck in', font_family: 'x', font_size: 20, fill: '#000', x: 150, y: 200, rotation: 0, z_index: 9 }
    const old = { id: 'old', type: 'text', content: 'TORY BURCH', font_family: 'Playfair', font_size: 40, fill: '#333', x: 900, y: 40, rotation: 0, z_index: 10 }
    const pic = { id: 'pic', type: 'picture', src: 'https://x/y.png', x: 10, y: 10, width: 100, height: 100, rotation: 0, flipped: false, z_index: 11, locked: false }
    const { nodes, pieces } = board(['top', 'pants', 'loafers', 'bag'], [note, old, pic])
    nodes.push({ id: 'n_hid', type: 'closet_item', closet_item_id: 'p_hid', x: 5, y: 5, scale: 0.3, rotation: 0, flipped: false, z_index: 1, locked: false, hidden: true })
    nodes.push({ id: 'n_lock', type: 'closet_item', closet_item_id: 'p_lock', x: 700, y: 700, scale: 0.3, rotation: 0, flipped: false, z_index: 1, locked: true })
    pieces.push({ nodeId: 'n_hid', pieceId: 'p_hid', type: 'scarf', brand: 'Hermès', ...P.belt }, { nodeId: 'n_lock', pieceId: 'p_lock', type: 'bag', brand: 'Chanel', ...P.bag })
    pieces.find((p) => p.nodeId === 'n_pants').brand = null
    const r = H.houseLayout(SQUARE, nodes, pieces, { measure })
    const ids = new Set(r.nodes.map((n) => n.id))
    ok('every node that went in comes out', nodes.every((n) => ids.has(n.id)))
    ok('the picture is untouched', JSON.stringify(r.nodes.find((n) => n.id === 'pic')) === JSON.stringify(pic))
    ok('a hidden piece is untouched', JSON.stringify(r.nodes.find((n) => n.id === 'n_hid')) === JSON.stringify(nodes.find((n) => n.id === 'n_hid')))
    ok('a locked piece is untouched', JSON.stringify(r.nodes.find((n) => n.id === 'n_lock')) === JSON.stringify(nodes.find((n) => n.id === 'n_lock')))
    ok('a brand already on the board becomes its label, not a second one', r.nodes.filter((n) => n.type === 'text' && n.content.toLowerCase() === 'tory burch').length === 1 && r.labelsMoved === 1)
    ok('the moved label is set in Amalfi Coast like the others', /Amalfi/.test(r.nodes.find((n) => n.id === 'old').font_family))
    ok('no label for a piece with no saved brand', r.unlabeled.join() === 'p_pants' && !r.nodes.some((n) => n.type === 'text' && n.id === 'tx_house_n_pants'))
    const top0 = nodes.find((n) => n.id === 'n_top'), top1 = r.nodes.find((n) => n.id === 'n_top'), noteAfter = r.nodes.find((n) => n.id === 'note')
    const c0 = { x: top0.x + (900 * 300 / 1200) / 2, y: top0.y + 150 }, c1 = { x: top1.x + 900 * top1.scale / 2, y: top1.y + 1200 * top1.scale / 2 }
    ok('a note moves with the piece it sat beside', Math.abs(noteAfter.x - (note.x + c1.x - c0.x)) < 0.02 && Math.abs(noteAfter.y - (note.y + c1.y - c0.y)) < 0.02)
    const again = H.houseLayout(SQUARE, r.nodes, pieces, { measure })
    ok('pressing again adds no second label', again.labelsAdded === 0 && again.nodes.filter((n) => n.type === 'text').length === r.nodes.filter((n) => n.type === 'text').length)
    ok('the same board gives the same answer', JSON.stringify(H.houseLayout(SQUARE, nodes, pieces, { measure })) === JSON.stringify(r))
    const flipped = board(['top', 'pants', 'loafers'])
    flipped.nodes[0].flipped = true
    const fr = H.houseLayout(SQUARE, flipped.nodes, flipped.pieces, { measure })
    const plain = H.houseLayout(SQUARE, ...Object.values(board(['top', 'pants', 'loafers'])), { measure })
    const vb = (res, p) => visible(res.nodes.find((n) => n.id === p.nodeId), p)
    // Mirrored, its visible box is the same size and centred on the same spot.
    const a = vb(fr, flipped.pieces[0]), b = vb(plain, flipped.pieces[0])
    ok('a flipped piece stays flipped and lands centred in the same box', fr.nodes[0].flipped === true && Math.abs((a[0] + a[2]) - (b[0] + b[2])) < 0.1 && Math.abs(a[1] - b[1]) < 0.05 && Math.abs((a[2] - a[0]) - (b[2] - b[0])) < 0.05)
  }
}

if (checked === 0) { console.error('check-house-layout: checked nothing'); process.exit(1) }
if (failures.length) { console.error(`check-house-layout FAILED (${failures.length} of ${checked}):\n  ` + failures.slice(0, 40).join('\n  ')); process.exit(1) }
console.log(`check-house-layout OK (${checked} checks)`)
