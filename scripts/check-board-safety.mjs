#!/usr/bin/env node
/**
 * ADR-0168. A BOARD NEVER FREEZES, NEVER SAVES WITHOUT ITS PICTURE, AND A LOOK OPENS AS SAVED.
 *
 * Cynthia Dada, 2026-10-06/07, Holly McClellan:
 *   "I've tried to make this look 3 different times and it gets stuck where I can't move anything
 *    around and it won't save."  The look saved anyway, as "mh", with no picture.
 *   "I was trying to restyle a look for Holly and the look shows up like this": a plain grid.
 *
 * Reproduced on the live builder in Chrome 152. One photo loaded without CORS (the board's
 * "tainted but visible" fallback) made Konva's hit canvas unreadable: every pointer event threw
 * SecurityError and toDataURL returned "". Save wrote the look with no picture and said nothing.
 * The "Styled in N looks" shortcut rebuilt Atelier looks as GoodPix grids.
 *
 * What this holds, file by file:
 *   1. Board pictures load ONLY through lib/loadBoardImage, which has no non-CORS fallback.
 *   2. Every board save asks lib/boardPictureForSave first and never exports on its own; the
 *      Saving state is cleared in a finally.
 *   3. A picture that does not upload stops the save (lib/uploadBoardPicture), for looks and capsules.
 *   4. Create-capsule never saves with an empty picture.
 *   5. Categorize opens a look only through openLookOnCanvas.
 *
 * ROOT=<dir> checks another tree (used to show it fails on the prior main).
 * Exits non-zero on any failure and on inspecting nothing (ADR-0106).
 */
import { readFileSync, existsSync } from 'node:fs'

const ROOT = (process.env.ROOT ?? new URL('..', import.meta.url).pathname).replace(/\/?$/, '/')
const problems = []
let checks = 0
const fail = (m) => { problems.push(m); console.error(`   ❌ ${m}`) }
const check = (cond, msg) => { checks++; if (!cond) fail(msg) }
const strip = (s) => s
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const read = (f) => existsSync(ROOT + f) ? strip(readFileSync(ROOT + f, 'utf8')) : null
const bodyOf = (src, name) => {
  const i = src.indexOf(`const ${name} = useCallback(`)
  if (i < 0) return null
  const j = src.indexOf('\n  const handle', i + 20)
  return src.slice(i, j < 0 ? undefined : j)
}

// 1. Board pictures
const loader = read('src/lib/loadBoardImage.ts')
check(!!loader, 'src/lib/loadBoardImage.ts is missing: there is no single safe way onto a board.')
if (loader) {
  const images = loader.match(/new window\.Image\(\)/g) ?? []
  const cors = loader.match(/crossOrigin = 'anonymous'/g) ?? []
  check(images.length > 0 && images.length === cors.length,
    'lib/loadBoardImage.ts creates a picture without crossOrigin: that is the tainted fallback that froze the board.')
}
// The fallback that froze the board: an onerror that loads the picture again WITHOUT CORS.
const TAINTED_FALLBACK = /onerror\s*=\s*\(\)\s*=>\s*\{[^}]*new (window\.)?Image\(/
for (const f of ['src/hooks/useCanvasImages.ts', 'src/render/composite.ts', 'src/render/capsuleGrid.ts']) {
  const s = read(f)
  check(!!s, `${f} is gone; this guard no longer covers it.`)
  if (!s) continue
  check(/loadBoardImage/.test(s), `${f} does not load pictures through lib/loadBoardImage.`)
  check(!TAINTED_FALLBACK.test(s), `${f} retries a failed picture without CORS; one tainted picture freezes the board (ADR-0168).`)
}
// The on-screen board builds no picture of its own at all.
const hook = read('src/hooks/useCanvasImages.ts')
check(!!hook && !/new (window\.)?Image\(\)/.test(hook), 'hooks/useCanvasImages.ts builds its own picture loader instead of lib/loadBoardImage.')
const grid = read('src/render/capsuleGrid.ts')
check(!!grid && /if \(!src\.startsWith\('data:'\)\) return loadBoardImage\(src\)/.test(grid),
  'render/capsuleGrid.ts loads web pictures without lib/loadBoardImage (it had a tainted fallback).')

// 2. Every board save asks for its picture first
const chat = read('src/components/layout/ChatPanel.tsx')
check(!!chat, 'ChatPanel.tsx is gone; this guard no longer covers the saves.')
if (chat) {
  check(!/exportCanvasImage\(/.test(chat), 'ChatPanel exports the board itself instead of asking lib/boardPictureForSave.')
  for (const [name, flag] of [['handleSave', 'setSaving(false)'], ['handleSaveAsCapsule', 'setSavingCapsule(false)'], ['handleCreateCapsule', 'setSavingCapsule(false)']]) {
    const body = bodyOf(chat, name)
    check(!!body, `ChatPanel: ${name} is gone; this guard no longer covers it.`)
    if (!body) continue
    if (name !== 'handleCreateCapsule') {
      check(/boardPictureForSave\(\)/.test(body), `ChatPanel: ${name} saves without asking boardPictureForSave, so a look can save with no picture.`)
    }
    check(new RegExp(`finally \\{\\s*${flag.replace(/[()]/g, '\\$&')}`).test(body), `ChatPanel: ${name} does not clear its Saving state in a finally, so a failure leaves it stuck.`)
    check(/\.error/.test(body) && /alert\(/.test(body), `ChatPanel: ${name} does not tell the stylist when the save failed.`)
  }
  const create = bodyOf(chat, 'handleCreateCapsule')
  check(!!create && /if \(!data\.compositeBase64\)/.test(create), 'ChatPanel: Create capsule can save with an empty picture.')
}

// 3. A picture that does not upload stops the save
for (const f of ['src/hooks/useLooks.ts', 'src/hooks/useCapsules.ts']) {
  const s = read(f)
  check(!!s, `${f} is gone; this guard no longer covers it.`)
  if (!s) continue
  check(/uploadBoardPicture\(/.test(s) && /if \(!up\.ok\) return \{ error/.test(s),
    `${f}: a picture that fails to upload is skipped and the row written anyway.`)
  check(!/functions\/v1\/upload-image/.test(s), `${f} uploads on its own instead of through lib/uploadBoardPicture.`)
}

// 4. Create-capsule never saves an empty picture
const dlg = read('src/components/canvas/CreateCapsuleDialog.tsx')
check(!!dlg && !/compositeBase64: ''/.test(dlg), "CreateCapsuleDialog saves a capsule with no picture when the picture fails.")

// 5. One way to open a look
const panel = read('src/components/categorize/CategorizePanel.tsx')
check(!!panel, 'CategorizePanel.tsx is gone; this guard no longer covers it.')
if (panel) {
  check(/function openLookOnCanvas\(/.test(panel), 'CategorizePanel has no openLookOnCanvas: buttons decide on their own how to open a look.')
  const calls = [...panel.matchAll(/(?<!function )\b(handleRebuildLook|handleEditLook)\(/g)].length
  const inside = /function openLookOnCanvas\([^)]*\) \{\s*return look\.source === 'builder' \? handleEditLook\(look\) : handleRebuildLook\(look\)\s*\}/.test(panel)
  check(inside && calls === 2,
    `CategorizePanel opens looks outside openLookOnCanvas (${calls} direct calls). The "Styled in N looks" shortcut did this and opened Atelier looks as grids.`)
}

console.log(`check-board-safety: ${checks} checks across 10 files, ${problems.length} problem(s)`)
if (checks === 0) { console.error('   ❌ inspected nothing'); process.exit(1) }
process.exit(problems.length ? 1 : 0)
