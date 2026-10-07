#!/usr/bin/env node
/**
 * Add an image to a look (ADR-0171). Cynthia Dada, 2026-09-15 / 09-23 / 10-01: "add an image of
 * this scarf tied around the waist but need to keep the item on the board invisible so it's still
 * linked to this look."
 *
 * Holds: the picture lands as a PictureNode (never a piece), placed on the board at a sane size,
 * stored under a key upload-image accepts; the toolbar and a file drop both add it; an added
 * picture can lose its background; hiding a piece tells her where it went.
 * Fails on the code before ADR-0171 (no src/lib/addPicture.ts, no Add image).
 */
import { readFileSync, existsSync } from 'node:fs'
let checked = 0
const failures = []
const ok = (c, m) => { checked++; if (!c) failures.push(m) }

if (!existsSync(new URL('../src/lib/addPicture.ts', import.meta.url))) {
  console.error('check-add-picture: FAIL - src/lib/addPicture.ts does not exist, so a stylist cannot add her own image to a look')
  process.exit(1)
}
const src = readFileSync(new URL('../src/lib/addPicture.ts', import.meta.url), 'utf8')

// Pure rules, evaluated from the source (the module imports browser-only helpers).
const fitSrc = src.slice(src.indexOf('export function fitPictureOnBoard'), src.indexOf('/** True for files'))
const keySrc = src.slice(src.indexOf('export function pictureKey'), src.indexOf('/**\n * Where a new picture sits'))
const toJs = (s) => s.replace(/export function/, 'function').replace(/: \{ width: number; height: number \}/g, '').replace(/: (number|string|null|undefined|'png' \| 'jpg')(\s*\|\s*(null|undefined))*/g, '').replace(/clientId\b(?=[,)])/, 'clientId')
const fit = new Function(`${toJs(fitSrc)}; return fitPictureOnBoard`)()
const key = new Function(`${toJs(keySrc)}; return pictureKey`)()

const board = { width: 1200, height: 1500 }
const tall = fit(3024, 4032, board)
ok(tall.height === 675 && tall.width === 506, `a 12MP portrait photo should sit 45% of the board tall (675), got ${tall.width}x${tall.height}`)
ok(tall.x === Math.round((1200 - tall.width) / 2) && tall.y === Math.round((1500 - tall.height) / 2), 'a new picture is not centred')
const wide = fit(4000, 1000, board)
ok(wide.width <= 960, `a wide photo must not be wider than 80% of the board, got ${wide.width}`)
const tiny = fit(200, 300, board)
ok(tiny.height === 300, `a small picture must not be blown up past its own pixels, got ${tiny.height}`)
const k = key('5e8ec7c445496f1c3f4c6143', 'jpg', 1, 'abc')
ok(k === 'looks/pictures/5e8ec7c445496f1c3f4c6143/1-abc.jpg', `picture key shape: ${k}`)
ok(/^(looks|capsules|closet|intake|shopping)\//.test(k) && !k.includes('..'), 'upload-image would refuse this key')
ok(key('../evil', 'png', 1, 'x').startsWith('looks/pictures/evil/'), 'a client id must not be able to escape the folder')
ok(key(null, 'png', 1, 'x') === 'looks/pictures/unassigned/1-x.png', 'no client still gives a valid key')

ok(/type: 'picture'/.test(src) && /product_id: null/.test(src), 'an added image must be a PictureNode, never a closet piece')
ok(!/closet_item_id:/.test(src) && !/type: 'closet_item'/.test(src), 'addPicture must not create closet pieces')
ok(/canvas-picture-remove-bg/.test(src), 'no Remove background for an added picture')
ok(/ensureJpegFiles/.test(src), 'iPhone HEIC photos are not converted before upload')

const tb = readFileSync(new URL('../src/components/canvas/CanvasToolbar.tsx', import.meta.url), 'utf8')
ok(/aria-label="Add image"/.test(tb) && /data-add-image-input/.test(tb), 'the toolbar has no Add image button / file input')
ok(/accept="image\/\*,\.heic,\.heif"/.test(tb), 'the file input does not take iPhone HEIC photos')
ok(/addPictureFilesToBoard\(files, activeClientId\)/.test(tb), 'Add image does not put the picture on the board')
ok(/singleNode\?\.type === 'picture'[\s\S]{0,200}onRemovePictureBg/.test(tb), 'a selected picture has no Remove background button')
ok(/data-hidden-note/.test(tb) && /In this look/.test(tb) && /undo\(\)/.test(tb), 'hiding a piece does not say where it went or offer Undo')
ok(/SIZER_PICTURE/.test(tb), 'the toolbar strip does not reserve room for a picture selection (the board would jump)')

const lc = readFileSync(new URL('../src/components/canvas/LookCanvas.tsx', import.meta.url), 'utf8')
ok(/onDrop=\{[\s\S]{0,300}addPictureFilesToBoard/.test(lc), 'dropping a photo on the board does nothing')
ok(/types\?\.includes\('Files'\)/.test(lc), 'the drop handler must only take files, or it eats closet-rail drags')

if (failures.length) {
  console.error(`check-add-picture: FAIL (${failures.length} of ${checked})`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log(`check-add-picture: ok (${checked} assertions: placement, key, node type, toolbar, drop, remove-bg, hide note)`)
