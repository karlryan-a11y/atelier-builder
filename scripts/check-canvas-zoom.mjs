#!/usr/bin/env node
/**
 * Canvas zoom guard.
 *
 * Cynthia, 4 Sep: "Can we get a zoom in feature when working on capsules? It would be great to
 * zoom in when working with smaller items on a board for formatting."
 *
 * Measured on the Melbourne + Sydney packing capsule: the 1080px board is fitted to about 596px
 * on screen, the median piece is 49px on its short side, 18 of 61 pieces are under 40px, and the
 * smallest is 19px.
 *
 * The danger zoom introduces is not visual, it is that the stage scale is now a stylist-set
 * number rather than a constant, and the look EXPORT photographs that same stage. If the export
 * ever stops resetting the stage to 1:1, every capsule she saves while zoomed in ships to the
 * client at the wrong size and the wrong crop, and it looks fine on her screen the whole time.
 * That is what most of this guard is for.
 *
 * Exits non-zero on a break AND on inspecting nothing.
 */
import { readFileSync } from 'node:fs'
import { clampZoom, nextZoom, zoomLabel, ZOOM_STEPS, MIN_ZOOM, MAX_ZOOM } from '../src/lib/canvasView.ts'

const failures = []
let checked = 0

/* ---------- 1. The steps ---------- */

const is = (name, got, want) => {
  checked++
  if (got !== want) failures.push(`${name}: expected ${want}, got ${got}`)
}

is('fit is the floor', MIN_ZOOM, 1)
is('zooming out from fit stays at fit', nextZoom(1, -1), 1)
is('zooming in from fit', nextZoom(1, 1), ZOOM_STEPS[1])
is('zooming in from the top stays at the top', nextZoom(MAX_ZOOM, 1), MAX_ZOOM)
is('zooming out from the top steps down', nextZoom(MAX_ZOOM, -1), ZOOM_STEPS[ZOOM_STEPS.length - 2])
is('a value between steps rounds up when zooming in', nextZoom(1.3, 1), 1.5)
is('a value between steps rounds down when zooming out', nextZoom(1.3, -1), 1.25)
is('below the floor clamps', clampZoom(0.2), MIN_ZOOM)
is('above the ceiling clamps', clampZoom(99), MAX_ZOOM)
is('nonsense clamps rather than throwing', clampZoom(NaN), MIN_ZOOM)
// The readout is something she says out loud to another stylist. Always a whole percent.
is('the readout at fit', zoomLabel(1), '100%')
is('the readout at the top', zoomLabel(MAX_ZOOM), '400%')
for (const step of ZOOM_STEPS) {
  checked++
  if (!/^\d+%$/.test(zoomLabel(step))) failures.push(`the readout for ${step} is "${zoomLabel(step)}", not a whole percent`)
}
// Walking every step up and back down must land exactly where it started.
checked++
let walk = MIN_ZOOM
for (let i = 0; i < ZOOM_STEPS.length + 3; i++) walk = nextZoom(walk, 1)
for (let i = 0; i < ZOOM_STEPS.length + 3; i++) walk = nextZoom(walk, -1)
if (walk !== MIN_ZOOM) failures.push(`walking to the top and back landed on ${walk}, not ${MIN_ZOOM}`)

/* ---------- 2. The wiring ---------- */

const FILE = 'src/components/canvas/LookCanvas.tsx'
const src = readFileSync(FILE, 'utf8')

checked++
if (ZOOM_STEPS.length === 0) failures.push('there are no zoom steps - the guard inspected nothing')

const need = (re, message) => {
  checked++
  if (!re.test(src)) failures.push(`${FILE}: ${message}`)
}

need(/const SCALE = FIT \* zoom/, 'the stage scale is not fit times zoom, so the buttons move nothing')
// Zoom past the fit means the board is bigger than the space it has. Without a scroll container
// the far side of a capsule becomes unreachable.
need(/ref=\{fitRef\}[^>]*overflow-auto/, 'the board is not in a scroll container, so zooming in puts pieces out of reach')
need(/m-auto/, 'the board is centred with justify/align rather than auto margins, which clips its top and left edges once it overflows')
need(/passive: false/, 'the pinch handler is passive, so it cannot stop the browser zooming the whole page instead')

// The one that protects the client.
const exportBlock = src.slice(src.indexOf('registerCanvasExport'), src.indexOf('return () => unregisterCanvasExport()'))
checked++
if (!exportBlock) {
  failures.push(`${FILE}: no export block found - the guard inspected nothing`)
} else {
  const reset = exportBlock.indexOf('stage.scale({ x: 1, y: 1 })')
  const capture = exportBlock.indexOf('stage.toDataURL(')
  const restore = exportBlock.indexOf('stage.scale({ x: prevScaleX, y: prevScaleY })')
  checked += 3
  if (reset < 0) failures.push(`${FILE}: the export does not reset the stage to 1:1, so a look saved while zoomed would ship to the client at the wrong size`)
  if (capture < 0) failures.push(`${FILE}: the export block no longer calls toDataURL`)
  if (restore < 0) failures.push(`${FILE}: the export does not restore the stage scale, so the board would stay at 1:1 after a save`)
  if (reset >= 0 && capture >= 0 && reset > capture) failures.push(`${FILE}: the export captures BEFORE resetting the scale`)
  if (restore >= 0 && capture >= 0 && restore < capture) failures.push(`${FILE}: the export restores the scale BEFORE capturing`)
}

// absolutePosition() already carries the stage scale. Multiplying by it again put the text edit
// box at a fraction of the right offset - barely noticeable at a fixed fit scale, badly wrong
// once she can zoom.
need(/textarea\.style\.top = `\$\{stageBox\.top \+ textPosition\.y\}px`/, 'the text edit box multiplies absolutePosition by the stage scale again, so it lands in the wrong place once the board is zoomed')

/* ---------- report ---------- */

if (failures.length) {
  console.error(`\ncheck-canvas-zoom: FAIL (${failures.length} problem(s), ${checked} checks run)\n`)
  for (const f of failures) console.error('  - ' + f)
  console.error('')
  process.exit(1)
}
console.log(
  `check-canvas-zoom: PASS - ${checked} checks over ${ZOOM_STEPS.length} zoom steps ` +
  `(${zoomLabel(MIN_ZOOM)} to ${zoomLabel(MAX_ZOOM)}), plus the export scale reset that keeps zoom out of a saved look.`
)
