#!/usr/bin/env node
/**
 * ADR-0169. THE SELECTION BOX WORKS FROM THE MARGIN AND PAST THE EDGE.
 *
 * Cynthia Dada, 2026-10-07: "I can't select all of the text on the board to move it. This also
 * happens when there is text and garments on a board."
 *
 * Reproduced on the live builder with her board (six labels, three of them against the top
 * edge): a box begun in the grey margin selected nothing; a box begun on the board and released
 * past its edge selected nothing and left the pink box stuck to the cursor. The box listened only
 * to Konva's stage events, which stop at the board's edge.
 *
 * This guard holds:
 *   1. WIRING (LookCanvas.tsx): the box is followed on the window (mousemove + mouseup), the
 *      margin starts one, and the stage no longer owns the move/release.
 *   2. HER DRAGS, replayed through lib/canvasSelection on her board's geometry: from the margin,
 *      and from the board out past the top edge, both select all six labels; a press that does not
 *      travel stays a click.
 *
 * ROOT=<dir> checks another tree (to show it fails on the prior main). Exits non-zero on failure
 * and on inspecting nothing (ADR-0106).
 */
import { readFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ROOT = (process.env.ROOT ?? new URL('..', import.meta.url).pathname).replace(/\/?$/, '/')
const problems = []
let checks = 0
const check = (cond, msg) => { checks++; if (!cond) { problems.push(msg); console.error(`   ❌ ${msg}`) } }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

// 1. Wiring
const FILE = 'src/components/canvas/LookCanvas.tsx'
const src = existsSync(ROOT + FILE) ? strip(readFileSync(ROOT + FILE, 'utf8')) : ''
check(!!src, `${FILE} is gone; this guard no longer covers the selection box.`)
check(!/onMouseMove=\{handleStageMouseMove\}|onMouseUp=\{handleStageMouseUp\}/.test(src),
  `${FILE}: the stage still owns the box's move/release, so a drag that leaves the board loses its release and the box sticks.`)
check(/window\.addEventListener\('mousemove'/.test(src) && /window\.addEventListener\('mouseup'/.test(src),
  `${FILE}: the box is not followed on the window, so it stops at the board's edge.`)
check(/const el = fitRef\.current[\s\S]{0,1500}?beginMarquee\(ev\.clientX, ev\.clientY\)[\s\S]{0,200}?el\.addEventListener\('mousedown', onDown\)/.test(src),
  `${FILE}: a press in the grey margin does not start a box. On a full board the margin is the only empty place.`)
check(/useEffect\(\(\) => \(\) => endMarquee\.current\?\.\(\)/.test(src),
  `${FILE}: window listeners are not removed when the board unmounts.`)

// 2. Her drags, replayed
let lib = null
try { lib = await import(pathToFileURL(ROOT + 'src/lib/canvasSelection.ts').href) } catch { /* reported below */ }
const has = lib && typeof lib.marqueeRect === 'function' && typeof lib.toBoardPoint === 'function' && typeof lib.boxesOverlap === 'function'
check(has, 'lib/canvasSelection has no marqueeRect/toBoardPoint/boxesOverlap: the box geometry is not defined in one place.')

if (has) {
  const { marqueeRect, toBoardPoint, boxesOverlap } = lib
  // Her board as measured on the builder: 1080 square at scale 0.373, on screen at (495, 228).
  const LEFT = 495, TOP = 228, SCALE = 403 / 1080
  const labels = [
    { x: 20, y: 15, width: 330, height: 50 }, { x: 380, y: 15, width: 330, height: 50 }, { x: 740, y: 15, width: 330, height: 50 },
    { x: 40, y: 580, width: 220, height: 50 }, { x: 420, y: 580, width: 220, height: 50 }, { x: 790, y: 580, width: 220, height: 50 },
  ]
  const drag = (name, from, to) => {
    const a = toBoardPoint(from[0], from[1], LEFT, TOP, SCALE)
    const b = toBoardPoint(to[0], to[1], LEFT, TOP, SCALE)
    const r = marqueeRect(a, b, SCALE)
    const n = r ? labels.filter((l) => boxesOverlap(r, l)).length : 0
    check(n === 6, `"${name}" selected ${n} of 6 labels.`)
  }
  drag('from the grey margin, top-left, across the board', [470, 218], [885, 560])
  drag('from the board out past the top-right edge', [505, 615], [925, 216])
  drag('entirely around the board, margin to margin', [470, 210], [920, 650])
  check(marqueeRect({ x: 100, y: 100 }, { x: 103, y: 102 }, SCALE) === null, 'a press that barely moved is treated as a box, not a click.')
  check(marqueeRect({ x: 100, y: 100 }, { x: 140, y: 100 }, SCALE) !== null, 'a real drag is not treated as a box.')
}

console.log(`check-marquee: ${checks} checks, ${problems.length} problem(s)`)
if (checks === 0) { console.error('   ❌ inspected nothing'); process.exit(1) }
process.exit(problems.length ? 1 : 0)
