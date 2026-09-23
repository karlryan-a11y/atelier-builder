#!/usr/bin/env node
/**
 * ADR-0146. A HIDDEN PIECE IS OFF THE BOARD AND STILL IN THE LOOK.
 *
 * Cynthia Dada, 2026-09-23: "Can you please create a tool to make an item invisible on the board
 * ... I need to add an image of this scarf tied around the waist but need to keep the item on the
 * board invisible so it's still linked to this look."
 *
 * The whole value is in the second half. Deleting the scarf would have taken it out of the look,
 * so the client would no longer see it under Pieces in this look and could no longer shop it.
 * Hiding keeps the node, and `closet_item_ids` is built FROM the nodes (hooks/useLooks.ts), so
 * the link survives by construction rather than by remembering to preserve it.
 *
 * Three ways this can go wrong, so three rules:
 *
 *   1. THE LINK. The look's piece list must still be derived from every closet_item node, with no
 *      filter for hidden. The moment a `hidden` test appears in that derivation, hiding becomes
 *      deleting and the client silently loses the piece.
 *   2. THE PICTURE. The saved board image is this stage (render/composite.ts calls
 *      stage.toDataURL), so hiding has to happen in the render list, once. Filtering somewhere
 *      else would draw it into the client's picture while the screen said hidden.
 *   3. THE WAY BACK. A hidden piece cannot be clicked. If the In this look panel cannot bring it
 *      back, "hide" is a trap: the stylist has no route to the thing she just made invisible.
 *
 * Exits non-zero on failure and on inspecting nothing (ADR-0106).
 */
import { readFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
const problems = []
const fail = (m) => { problems.push(m); console.error(`   ❌ ${m}`) }
let checks = 0

const strip = (s) => s
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const read = (rel) => strip(readFileSync(ROOT + rel, 'utf8'))

// ── 1. the link survives ──────────────────────────────────────────────────────────────────
const LOOKS = 'src/hooks/useLooks.ts'
const looks = read(LOOKS)
checks++
const deriv = looks.match(/\.filter\(\(n\) => n\.type === 'closet_item'([\s\S]{0,200})/)
if (!deriv) {
  fail(`${LOOKS}: the closet_item_ids derivation has moved. This guard no longer covers what it claims to.`)
} else if (/hidden/.test(deriv[0])) {
  fail(`${LOOKS}: closet_item_ids now excludes hidden pieces, so hiding a piece REMOVES it from the look and the client loses it (ADR-0146). That is the one thing hiding must not do.`)
}

// ── 2. hidden is applied once, in the render list ─────────────────────────────────────────
const CANVAS = 'src/components/canvas/LookCanvas.tsx'
const canvas = read(CANVAS)
checks++
const sorted = canvas.match(/const sortedNodes = useMemo\(([\s\S]*?)\n  \)/)
if (!sorted) {
  fail(`${CANVAS}: sortedNodes is gone; the single render list this depends on has moved.`)
} else if (!/hidden/.test(sorted[1])) {
  fail(`${CANVAS}: the render list no longer skips hidden pieces, so a piece marked hidden still draws on the board and into the client's saved picture (ADR-0146).`)
}
checks++
if (!/type === 'closet_item' && n\.hidden/.test(canvas.replace(/\s+/g, ' ').replace(/ && /g, ' && '))
    && !/closet_item'\s*&&\s*n\.hidden/.test(canvas)) {
  fail(`${CANVAS}: hiding is not scoped to closet pieces. A plain picture has no link worth keeping, so hiding one is just a confusing delete.`)
}

// ── 3. there is a way back ────────────────────────────────────────────────────────────────
const PANEL = 'src/components/canvas/LookItemsPanel.tsx'
const panel = read(PANEL)
checks++
if (!/hidden/.test(panel)) {
  fail(`${PANEL}: the In this look panel does not know about hidden pieces, so a hidden piece cannot be found again (ADR-0146).`)
}
checks++
if (!/updateNodes\(/.test(panel) || !/hidden: false/.test(panel)) {
  fail(`${PANEL}: nothing in the panel un-hides a piece. A hidden piece cannot be clicked on the board, so this is the only route back and without it hide is a trap.`)
}
checks++
if (!/aria-label/.test(panel)) {
  fail(`${PANEL}: the un-hide control is not announced, and it is an icon-only button.`)
}

// ── 4. there is a way in ──────────────────────────────────────────────────────────────────
const TOOLBAR = 'src/components/canvas/CanvasToolbar.tsx'
const toolbar = read(TOOLBAR)
checks++
if (!/hidden: true/.test(toolbar)) {
  fail(`${TOOLBAR}: no control hides the selected piece, so the feature cannot be reached.`)
}

if (checks === 0) { console.error('\n❌ hidden-piece: inspected nothing.\n'); process.exit(1) }
console.log(`   ${checks} rule(s) checked across ${LOOKS}, ${CANVAS}, ${PANEL}, ${TOOLBAR}`)

if (problems.length) {
  console.error(`\n❌ hidden-piece: ${problems.length} failure(s).\n`)
  process.exit(1)
}
console.log('\n✅ hidden-piece: hidden on the board, still in the look, and findable again.\n')
