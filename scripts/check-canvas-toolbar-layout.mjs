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
if (!/data-canvas-toolbar[^>]*flex-wrap/.test(toolbar)) failures.push(`${TOOLBAR}: the toolbar cannot wrap, so a narrow column pushes buttons out of reach`)
checked++
if (!/<Sparkles/.test(toolbar)) failures.push(`${TOOLBAR}: the Style (sparkles) button is gone`)

if (checked === 0) failures.push('inspected nothing')
if (failures.length) {
  console.error(`check-canvas-toolbar-layout: ${failures.length} failure(s) of ${checked} checks`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`check-canvas-toolbar-layout: ${checked} checks passed on ${CANVAS} + ${TOOLBAR}`)
