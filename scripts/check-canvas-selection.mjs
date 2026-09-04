#!/usr/bin/env node
/**
 * Canvas selection guard.
 *
 * The bug this exists for, reported by Cynthia on 4 Sep: "the select function is working maybe
 * 15% of the time for me", "when i click on an item, it should select it. i don't want to click
 * it twice to select".
 *
 * Every solid garment on the board carries a pixel-perfect hit mask, so only its opaque pixels
 * are clickable. Selection was wired to Konva's `click`, and Konva fires `click` ONLY when the
 * shape under the pointer at press is the same shape at release. On a packing capsule a
 * two-pixel trackpad drift crosses a mask boundary, the two disagree, and no click event fires.
 * The release then read as "on the stage", which also cleared the whole selection, because the
 * clear never asked where the press had begun. Measured per visible garment pixel on the real
 * boards: 19.4% of presses could not fire a click on the 167-node capsule, 15.0% on the
 * 109-node one, 9.0% on a 23-node look.
 *
 * Two rules, and this guard holds both:
 *   1. A piece is selected on the PRESS, never on the click.
 *   2. A selection is cleared only when the PRESS began on empty board.
 *
 * Exits non-zero on a break AND on inspecting nothing - a guard that measured zero bindings is
 * a failure, not a pass.
 */
import { readFileSync } from 'node:fs'
import { selectionOnPress, shouldClearSelection } from '../src/lib/canvasSelection.ts'

const failures = []
let checked = 0

/* ---------- 1. The wiring, in LookCanvas.tsx ---------- */

const FILE = 'src/components/canvas/LookCanvas.tsx'
const src = readFileSync(FILE, 'utf8')

const count = (re) => (src.match(re) || []).length

// Each selectable node type declares one `onSelect` prop.
const declared = count(/^\s*onSelect: \(e: Konva\.KonvaEventObject/gm)
const onPress = count(/onMouseDown=\{onSelect\}/g)
const onTouch = count(/onTouchStart=\{onSelect\}/g)
const onClick = count(/on(?:Click|Tap)=\{onSelect\}/g)

checked += 4
if (declared === 0) failures.push(`${FILE}: no onSelect props found - the guard inspected nothing`)
if (onClick > 0) {
  failures.push(
    `${FILE}: ${onClick} selection handler(s) still bound to onClick/onTap. Konva drops the ` +
    `click when a two-pixel drift moves the pointer across a hit-mask edge, so the piece never ` +
    `gets selected. Bind onMouseDown/onTouchStart.`
  )
}
if (onPress !== declared) failures.push(`${FILE}: ${declared} onSelect prop(s) declared but ${onPress} bound to onMouseDown`)
if (onTouch !== declared) failures.push(`${FILE}: ${declared} onSelect prop(s) declared but ${onTouch} bound to onTouchStart`)

// Every place that wipes the selection must ask where the press began.
const clearSites = []
src.split('\n').forEach((line, i) => {
  if (/setSelectedNodeIds\(\[\]\)/.test(line)) clearSites.push(i + 1)
})
checked += 1
if (clearSites.length === 0) {
  failures.push(`${FILE}: no selection-clearing site found - the guard inspected nothing`)
}
for (const lineNo of clearSites) {
  checked++
  // The gate must sit within the ten lines above the clear.
  const window = src.split('\n').slice(Math.max(0, lineNo - 11), lineNo).join('\n')
  if (!/shouldClearSelection\(/.test(window)) {
    failures.push(
      `${FILE}:${lineNo}: clears the selection without shouldClearSelection(). A press that ` +
      `began on a piece and drifted onto empty board would wipe her whole selection.`
    )
  }
}
if (!/pressedEmpty\.current = e\.target === e\.target\.getStage\(\)/.test(src)) {
  checked++
  failures.push(`${FILE}: nothing records whether the press began on empty board`)
}

/* ---------- 2. The decisions, replayed as gestures ---------- */

const gesture = (name, g, want) => {
  checked++
  const got = shouldClearSelection(g)
  if (got !== want) failures.push(`gesture "${name}": expected clear=${want}, got ${got}`)
}

// The exact reported failure: press on a garment, two-pixel drift, release over a transparent
// gap. Must NOT deselect.
gesture('press on piece, drift, release on empty', { pressedEmpty: false, releasedEmpty: true, marquee: false }, false)
gesture('press on piece, release on piece', { pressedEmpty: false, releasedEmpty: false, marquee: false }, false)
// Clicking the board itself still deselects. That behaviour must survive the fix.
gesture('press and release on empty board', { pressedEmpty: true, releasedEmpty: true, marquee: false }, true)
// A marquee sets its own selection and must never be followed by a wipe.
gesture('marquee drag', { pressedEmpty: true, releasedEmpty: true, marquee: true }, false)
gesture('drift from empty onto a piece', { pressedEmpty: true, releasedEmpty: false, marquee: false }, false)

const press = (name, current, nodeId, mods, want) => {
  checked++
  const got = selectionOnPress(current, nodeId, mods)
  if (got.action !== want) failures.push(`press "${name}": expected "${want}", got "${got.action}"`)
}

press('first press on a piece', [], 'a', {}, 'replace')
press('press a different piece', ['a'], 'b', {}, 'replace')
press('press the piece already selected', ['a'], 'a', {}, 'replace')
// Pressing inside a multi-selection must keep the group, or dragging several pieces together
// breaks the moment she touches one of them.
press('press inside a multi-selection', ['a', 'b', 'c'], 'b', {}, 'keep-group')
press('press outside a multi-selection', ['a', 'b'], 'z', {}, 'replace')
press('shift press', ['a'], 'b', { shiftKey: true }, 'toggle')
press('cmd press', ['a'], 'b', { metaKey: true }, 'toggle')
press('touch press has no button', ['a'], 'b', { button: undefined }, 'replace')
// Right-click opens a menu. It never used to select, because `click` is left-button only, and
// moving to the press must not quietly change that.
press('right button', ['a'], 'b', { button: 2 }, 'ignore')
press('middle button', ['a'], 'b', { button: 1 }, 'ignore')

/* ---------- report ---------- */

if (failures.length) {
  console.error(`\ncheck-canvas-selection: FAIL (${failures.length} problem(s), ${checked} checks run)\n`)
  for (const f of failures) console.error('  - ' + f)
  console.error('')
  process.exit(1)
}
console.log(
  `check-canvas-selection: PASS - ${checked} checks over ${declared} selectable node type(s), ` +
  `${clearSites.length} selection-clearing site(s) and 15 replayed gestures.`
)
