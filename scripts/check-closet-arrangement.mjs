// HER COLLECTION'S ORDER (Cynthia Dada for Chris Cadieux, 2026-11-18): each suit's jacket and pants
// side by side, and a stylist can drag pieces into her own order, which the client sees on her
// lookbook. FAILS before: no lib/closetArrangement.ts, the grid is in added_at order with no drag.
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const LIB = 'src/lib/closetArrangement.ts'
const ORDER = 'src/lib/closetOrder.ts'
const fails = []
const need = (ok, m) => { if (!ok) fails.push(m) }
const lib = existsSync(LIB) ? readFileSync(LIB, 'utf8') : ''
const order = existsSync(ORDER) ? readFileSync(ORDER, 'utf8') : ''
const col = readFileSync('src/components/categorize/CollectionTab.tsx', 'utf8')
const hook = existsSync('src/hooks/useClosetOrder.ts') ? readFileSync('src/hooks/useClosetOrder.ts', 'utf8') : ''
const select = readFileSync('src/hooks/useClosetItems.ts', 'utf8')
need(lib, `${LIB} is missing`)
need(order, `${ORDER} is missing`)
need(/compareClosetRecency\(/.test(col), 'the grid starts newest first, by the same rule as her Collection page (closetOrder.ts)')
need(/'[^']*\blast_modified\b[^']*'/.test(select.match(/export const CLOSET_SELECT[\s\S]*?\n\n/)?.[0] ?? ''), 'the closet read carries last_modified, or GoodPix pieces sort differently from her page')
need(/arrangeCloset\(searched\.ranked, savedOrder\)/.test(col), 'the grid is shown in her order (suits paired, the saved order)')
need(/draggable=\{canArrange\}/.test(col) && /movedOrder\(full, visible\.map/.test(col), 'a card can be dragged and the drop saves the whole closet order')
need(/withClosetOrder\(row\.raw, next\)/.test(hook) && /\.select\('order:raw->closet_order'\)/.test(hook), 'the order is saved in her raw, keeping the rest, and the write asks for its row back (ADR-0108)')
// The lookbook reads the same two files. A checkout without the lookbook beside it skips the twin check.
for (const f of [LIB, ORDER]) {
  const twin = '../atelier-looks/' + f
  if (existsSync(twin)) need(readFileSync(twin, 'utf8') === readFileSync(f, 'utf8'), `${f} differs from atelier-looks: one rule, or the order she sees is not the stylist's`)
}
const looksPage = '../atelier-looks/src/pages/[microsite]/closet.astro'
if (existsSync(looksPage)) need(/arrangeCloset\(found\.ranked, savedClosetOrder\(/.test(readFileSync(looksPage, 'utf8')), 'her Collection page shows the same order')
// The rule itself, on Chris Cadieux's Suits as they were on 2026-11-19 (newest first).
if (lib) {
  const probe = `
    import { arrangeCloset } from './${LIB}'
    const p = (id, name, category, also = []) => ({ id, name, brand: 'Dior', category, custom_categories: also })
    const rows = [
      p('navyP', 'Navy Blue Wool Suit Pants', 'pants', ['suits']),
      p('silkP', 'Blue Silk Linen Tailored Suit Pants', 'two-piece-suits'),
      p('greyT', 'Medium Grey Subtle Blue Windowpane Check Straight-Leg Trousers', 'two-piece-suits'),
      p('greyB', 'Medium Grey Subtle Windowpane Check Single-Breasted Blazer', 'two-piece-suits'),
      p('anthJ', 'Gray Anthracite Wool Two-Piece Suit Jacket', 'suit-jackets', ['two-piece-suits']),
      p('anthP', 'Anthracite Wool Tailored Suit Pants', 'pants', ['suits']),
      p('darkJ', 'Made-to-Measure Dark Blue Wool Suit Jacket', 'two-piece-suits'),
      p('silkJ', 'Blue Two-Button Notch Lapel Silk Linen Suit Jacket', 'suit-jackets', ['two-piece-suits']),
    ]
    console.log(JSON.stringify({ auto: arrangeCloset(rows, []).map((r) => r.id), saved: arrangeCloset(rows, ['silkP', 'greyT', 'navyP', 'darkJ', 'silkJ', 'greyB', 'anthJ', 'anthP']).map((r) => r.id) }))`
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', probe], { encoding: 'utf8' })
  let got = null
  try { got = JSON.parse(r.stdout.trim().split('\n').pop()) } catch { fails.push('could not run the order rule: ' + (r.stderr || r.stdout).slice(0, 300)) }
  if (got) {
    need(got.auto.join() === 'navyP,darkJ,silkJ,silkP,greyB,greyT,anthJ,anthP', `Chris's Suits should read jacket then pants, each pair on its own line; got ${got.auto.join()}`)
    need(got.saved.join() === 'silkP,greyT,navyP,darkJ,silkJ,greyB,anthJ,anthP', `a saved order must win over the pairing; got ${got.saved.join()}`)
  }
}
if (fails.length) { console.error('check-closet-arrangement FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('check-closet-arrangement: ok (8 pieces arranged, both apps on one rule)')
