#!/usr/bin/env node
/**
 * Canvas toolbar layout guard.
 *
 * Karl, 18 Sep: "the buttons are overlapping. where did the magic button go?"
 *
 * The zoom controls (added 4 Sep) and the grid toggle were `absolute left-3` / `absolute right-3`
 * over a centred toolbar. On a narrow canvas column the zoom cluster covered Portrait and Square,
 * and the grid toggle sat exactly on top of the Style (sparkles) button, the last item in the
 * toolbar. The button was still there, just unreachable.
 *
 * Rule: nothing in the toolbar row may be absolutely positioned, the zoom and grid groups must not
 * shrink, and the toolbar must be able to wrap rather than run under its neighbours.
 *
 * Cynthia Dada, 25 Sep: "Can you please fix this auto zoom that's happening? It messes up when I'm
 * trying to move text." / "It also does it when I select garments". The wrap above made the
 * toolbar's HEIGHT depend on what was selected, and the board is fitted to the space under it, so
 * the board shrank under her cursor on every press. Second rule: the toolbar's height depends on
 * the width alone. The selection controls live in a strip that reserves the tallest set any
 * selection can bring up (invisible, inert copies in the same grid cell), drawn by ONE component
 * so a new button reserves its own room, and nothing else in the row changes size with state.
 * The outcome itself is measured by `node scripts/perf/style-harness.mjs --steady-board`.
 *
 * Exits non-zero on a break AND on inspecting nothing.
 */
import { readFileSync } from 'node:fs'

const failures = []
let checked = 0

const CANVAS = 'src/components/canvas/LookCanvas.tsx'
const TOOLBAR = 'src/components/canvas/CanvasToolbar.tsx'
const canvas = readFileSync(CANVAS, 'utf8')
const toolbar = readFileSync(TOOLBAR, 'utf8')

// The row runs from its opening div to the start of the board's scroll container.
const start = canvas.indexOf('data-toolbar-row')
const end = canvas.indexOf('ref={fitRef}')
checked++
if (start < 0 || end < 0 || end <= start) {
  failures.push(`${CANVAS}: could not find the toolbar row (data-toolbar-row) before the board - the guard inspected nothing`)
} else {
  const row = canvas.slice(start, end)
  checked++
  if (!row.includes('<CanvasToolbar />')) failures.push(`${CANVAS}: the toolbar row no longer contains <CanvasToolbar />`)
  checked++
  const abs = row.match(/className=[{"`][^\n]*\babsolute\b[^\n]*/g) ?? []
  if (abs.length) failures.push(`${CANVAS}: ${abs.length} absolutely positioned element(s) in the toolbar row; they float over the toolbar on a narrow screen:\n    ${abs.join('\n    ')}`)
  checked++
  if (!/data-zoom-controls[^>]*shrink-0/.test(row)) failures.push(`${CANVAS}: the zoom controls are not a shrink-0 flex sibling`)
  checked++
  if (!/data-grid-toggle[\s\S]{0,200}shrink-0/.test(row)) failures.push(`${CANVAS}: the grid toggle is not a shrink-0 flex sibling`)
  checked++
  if (!/min-w-0[^>]*>\s*<CanvasToolbar \/>/.test(row)) failures.push(`${CANVAS}: the toolbar is not in a min-w-0 slot, so it cannot give up width`)
}

checked++
if (!/data-toolbar-base[^>]*flex-wrap/.test(toolbar)) failures.push(`${TOOLBAR}: the toolbar cannot wrap, so a narrow column pushes buttons out of reach`)

// ---- the board holds still (25 Sep) ----
const ctxStart = toolbar.indexOf('data-toolbar-context')
checked++
if (ctxStart < 0) {
  failures.push(`${TOOLBAR}: no fixed selection strip (data-toolbar-context); selecting something changes the toolbar's height and re-fits the board under her cursor`)
} else {
  const ctx = toolbar.slice(ctxStart)
  checked++
  if (!/SIZERS\.map[\s\S]{0,200}inert[\s\S]{0,120}invisible \[grid-area:1\/1\][\s\S]{0,200}<SelectionControls nodes=\{nodes\}/.test(ctx)) failures.push(`${TOOLBAR}: the strip does not reserve room with invisible, inert <SelectionControls> sizers in its grid cell`)
  checked++
  if (!/\[grid-area:1\/1\][^>]*>\s*\{hasSelection \?\s*\(\s*<SelectionControls nodes=\{selectedNodes\}/.test(ctx)) failures.push(`${TOOLBAR}: the real selection controls are not drawn by <SelectionControls> in the same grid cell as the sizers`)
}
// Every set of controls a selection can show must have a sizer: one text label, one piece, three pieces.
checked++
if (!/const SIZERS[^=]*=\s*\[\s*\[SIZER_TEXT\],\s*\[SIZER_PIECE\],\s*\[SIZER_PIECE,[^\]]+,[^\]]+\]/.test(toolbar)) failures.push(`${TOOLBAR}: SIZERS must cover a text label, a single piece and three pieces (align + distribute)`)
// No selection-dependent markup outside the strip.
checked++
const base = ctxStart < 0 ? toolbar : toolbar.slice(toolbar.indexOf('data-toolbar-base'), ctxStart)
if (/hasSelection|singleNode|selectedNodes/.test(base)) failures.push(`${TOOLBAR}: the base row renders something that depends on the selection; its height would change with it`)
checked++
if (/\{styleRun && \(/.test(toolbar)) failures.push(`${TOOLBAR}: the Style result appears and disappears in the base row; it must sit in a fixed slot`)
// The zoom readout ("100%" vs "400%") must not change the width the toolbar gets to wrap in.
checked++
if (start >= 0 && !/title="Fit the whole board"/.test(canvas)) failures.push(`${CANVAS}: zoom readout button not found`)
else if (!/className="w-12[^"]*"\s*title="Fit the whole board"/.test(canvas)) failures.push(`${CANVAS}: the zoom readout has no fixed width, so zooming re-wraps the toolbar and re-fits the board`)
checked++
if (!/<Sparkles/.test(toolbar)) failures.push(`${TOOLBAR}: the Style (sparkles) button is gone`)

if (checked === 0) failures.push('inspected nothing')
if (failures.length) {
  console.error(`check-canvas-toolbar-layout: ${failures.length} failure(s) of ${checked} checks`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`check-canvas-toolbar-layout: ${checked} checks passed on ${CANVAS} + ${TOOLBAR}`)
