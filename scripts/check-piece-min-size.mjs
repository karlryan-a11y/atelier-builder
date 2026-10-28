#!/usr/bin/env node
// @checks build guard
/**
 * Piece resize floor guard (Cynthia, 2026-10-14: a horsebit flat on a Landscape capsule would not
 * get smaller). Only the LONGER side has a floor (MIN_PIECE_SCREEN_PX), so a wide, short shoe can
 * get as short as it needs. And every resize handle on the canvas must use resizeAllowed, so the old
 * "< 20 on either side" rule cannot come back on one Transformer and not the others.
 * Exits non-zero on a break AND on inspecting nothing.
 */
import { readFileSync } from 'node:fs'
import { resizeAllowed, MIN_PIECE_SCREEN_PX } from '../src/lib/canvasView.ts'

const failures = []
let checked = 0
const is = (name, got, want) => { checked++; if (got !== want) failures.push(`${name}: expected ${want}, got ${got}`) }

is('a flat 40 wide and 8 tall can be resized', resizeAllowed({ width: 40, height: 8 }), true)
is('a boot 6 wide and 30 tall can be resized', resizeAllowed({ width: 6, height: 30 }), true)
is('a flipped piece (negative width) counts by size', resizeAllowed({ width: -40, height: 8 }), true)
is('the floor is on the longer side', resizeAllowed({ width: MIN_PIECE_SCREEN_PX - 1, height: MIN_PIECE_SCREEN_PX - 1 }), false)
is('at the floor is allowed', resizeAllowed({ width: MIN_PIECE_SCREEN_PX, height: 3 }), true)
is('a zero-height piece is refused', resizeAllowed({ width: 40, height: 0 }), false)
is('not a number is refused', resizeAllowed({ width: NaN, height: 40 }), false)
is('the floor is below the old 20', MIN_PIECE_SCREEN_PX < 20, true)

const src = readFileSync(new URL('../src/components/canvas/LookCanvas.tsx', import.meta.url), 'utf8')
const uses = (src.match(/boundBoxFunc=\{\(oldBox, newBox\) => \(resizeAllowed\(newBox\) \? newBox : oldBox\)\}/g) ?? []).length
is('piece, picture and group resize handles all use resizeAllowed', uses, 3)
checked++
if (/Math\.abs\(newBox\.height\) < \d+/.test(src)) failures.push('a resize handle still floors the height on its own')

if (checked === 0) { console.error('check-piece-min-size: inspected nothing'); process.exit(1) }
if (failures.length) { console.error('check-piece-min-size FAILED:\n  ' + failures.join('\n  ')); process.exit(1) }
console.log(`check-piece-min-size OK (${checked} checks)`)
