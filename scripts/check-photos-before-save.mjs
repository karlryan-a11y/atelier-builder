#!/usr/bin/env node
// @checks build guard
/**
 * ADR-0194. A BOARD'S PICTURE IS NEVER TAKEN WHILE ITS PHOTOS ARE STILL LOADING.
 *
 * Peyton, 2026-10-20: her London capsule (32 pieces) was saved while its photos were still on their
 * way. Labels draw at once, a photo only when it arrives, so the saved picture was brand names with
 * no clothes and that is what her site showed. Measured on that board: 0 of 95 photos drawn at
 * 2.5 seconds, 21 at 5, 63 at 9. The save checked for failed photos, never for loading ones.
 *
 * What this holds:
 *   1. waitForPhotos waits while photos load, and gives up (returns false) when they never arrive.
 *   2. inkCoverage reads a white picture as empty and a filled one as full.
 *   3. The canvas tracks every photo from the moment it starts loading until it arrives or fails.
 *   4. The canvas hands that list to Save and to the buttons.
 *   5. boardPictureForSave waits for the list BEFORE it exports, and refuses when time runs out.
 *   6. Save Look and Save/Update Capsule are greyed out while photos load.
 *   7. A nearly empty picture is recorded for the daily look-picture-guard.
 * Exits non-zero on any failure and on inspecting nothing (ADR-0106).
 */
import { readFileSync } from 'node:fs'
import { waitForPhotos, inkCoverage, NEARLY_EMPTY_COVERAGE } from '../src/lib/waitForPhotos.ts'

const ROOT = new URL('..', import.meta.url).pathname
const failures = []
let checked = 0
const check = (cond, msg) => { checked++; if (!cond) failures.push(msg) }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const read = (f) => strip(readFileSync(ROOT + f, 'utf8'))

// 1. The wait itself, run as it ships.
let left = ['a', 'b']
setTimeout(() => { left = ['b'] }, 30)
setTimeout(() => { left = [] }, 60)
const t0 = Date.now()
check(await waitForPhotos(() => left, { timeoutMs: 2000, pollMs: 5 }) === true, 'waitForPhotos did not report ready once every photo arrived.')
check(Date.now() - t0 >= 55, 'waitForPhotos returned before the last photo arrived.')
check(await waitForPhotos(() => ['stuck'], { timeoutMs: 50, pollMs: 5 }) === false, 'waitForPhotos never gives up on a photo that never arrives.')
check(await waitForPhotos(() => []) === true, 'waitForPhotos waits on a board with nothing loading.')

// 2. The near-empty measure.
const px = (n, rgba) => Array.from({ length: n }, () => rgba).flat()
check(inkCoverage(px(100, [255, 255, 255, 255])) === 0, 'inkCoverage counts a white picture as filled.')
check(inkCoverage(px(100, [0, 0, 0, 0])) === 0, 'inkCoverage counts transparent as filled (the board is white behind it).')
check(inkCoverage(px(100, [120, 90, 60, 255])) === 1, 'inkCoverage counts a filled picture as empty.')
check(NEARLY_EMPTY_COVERAGE > 0.037 && NEARLY_EMPTY_COVERAGE < 0.056,
  'NEARLY_EMPTY_COVERAGE must sit between Peyton\'s broken capsule (0.037) and the lowest good live picture (0.056).')

// 3. The canvas tracks loading photos on every path.
const hook = read('src/hooks/useCanvasImages.ts')
check(/setLoading\(\(prev\) => \(prev\.has\(id\) \? prev : new Set\(prev\)\.add\(id\)\)\)/.test(hook), 'useCanvasImages does not mark a photo as loading when it starts.')
check((hook.match(/settled\(\)/g) ?? []).length === 2, 'useCanvasImages does not clear "loading" both when a photo arrives and when it fails.')
check(/return \{ images, unusable, loading \}/.test(hook), 'useCanvasImages no longer hands out the loading list.')

// 4. ...and hands it to Save and the buttons.
const canvas = read('src/components/canvas/LookCanvas.tsx')
check(/registerLoadingPhotos\(\(\) => waiting\)/.test(canvas), 'LookCanvas does not tell Save which photos are still loading.')
check(/usePhotosLoading\.setState\(\{ count: waiting\.length \}\)/.test(canvas), 'LookCanvas does not tell the save buttons photos are loading.')

// 5. Save waits BEFORE the picture is taken.
const save = read('src/lib/boardPictureForSave.ts')
const waitAt = save.indexOf('await waitForPhotos(')
const exportAt = save.indexOf('exportCanvasImage(')
check(/export async function boardPictureForSave\(/.test(save), 'boardPictureForSave is not async, so it cannot wait for photos.')
check(waitAt > 0 && exportAt > waitAt, 'boardPictureForSave takes the picture before waiting for photos.')
check(/loadingPhotoNodeIds\(\)/.test(save), 'boardPictureForSave does not read which photos are still loading.')
check(/still loading, so nothing was saved/.test(save), 'boardPictureForSave does not refuse (and say why) when photos never arrive.')

// 6. The buttons wait too.
const chat = read('src/components/layout/ChatPanel.tsx')
check(/disabled=\{nodes\.length === 0 \|\| buildingCapsule \|\| photosLoading > 0\}/.test(chat), 'Save Look is clickable while photos are loading.')
check(/onClick=\{\(\) => setShowSaveAsCapsuleDialog\(true\)\}\s*disabled=\{photosLoading > 0\}/.test(chat), 'Save/Update Capsule is clickable while photos are loading.')
check((chat.match(/await boardPictureForSave\(/g) ?? []).length === 2, 'Save Look and Save as Capsule must both await boardPictureForSave.')

// 7. The safety net.
check(/flagIfNearlyEmpty\(png, what\)/.test(save) && /'save_picture_nearly_empty'/.test(save), 'A nearly empty picture is no longer recorded for the daily guard.')

if (checked === 0) { console.error('check-photos-before-save: inspected nothing'); process.exit(1) }
if (failures.length) { console.error('check-photos-before-save FAILED:\n  ' + failures.join('\n  ')); process.exit(1) }
console.log(`check-photos-before-save OK (${checked} checks)`)
