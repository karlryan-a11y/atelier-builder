#!/usr/bin/env node
/**
 * Capsule-rebuild guard.
 *
 * The gap this exists for: a GoodPix capsule is one flat scraped image plus `closet_item_ids`,
 * with no per-piece layout, so it cannot be reopened on the canvas. Looks have had a Rebuild
 * button for this since ADR-0076. Capsules never got one, so 21 of Maegan Watson's 26 capsules
 * showed a permanently disabled Edit button and nothing else. Reported by Cynthia in Slack,
 * 2026-09-04.
 *
 * Rebuild is only safe if FOUR things hold together, and each one has already been got wrong
 * once somewhere in this codebase:
 *
 *   1. The card fetches the pieces it offers to rebuild from. A surface that shows a field
 *      without fetching it opens empty and saves the emptiness back (ADR-0099, the Audit tab).
 *   2. The rebuild is loaded as a REPLACEMENT, never as an edit of the original. Saving over a
 *      GoodPix row rewrites `raw`, and `raw.image_url` is the picture live on the client's site.
 *   3. The save carries that replacement through, or the rebuild lands as an unfiled draft
 *      beside a still-live original — the exact "original left dark with a duplicate beside it"
 *      failure the looks version was written to fix.
 *   4. The original retires, it is never destroyed. The scraped composite is the only record of
 *      how GoodPix laid it out ("removing a category never destroys the record of what was in
 *      it", ADR-0108, same principle).
 *
 * Exits non-zero on any of those AND on finding nothing to inspect — a guard that measured
 * zero surfaces is a failure, not a pass.
 */
import { readFileSync } from 'node:fs'

const FILES = {
  hook:   'src/hooks/useLookCategories.ts',
  panel:  'src/components/categorize/CategorizePanel.tsx',
  store:  'src/stores/canvasStore.ts',
  chat:   'src/components/layout/ChatPanel.tsx',
  save:   'src/hooks/useCapsules.ts',
  replace:'src/lib/capsuleReplace.ts',
}

const src = {}
const problems = []
for (const [key, path] of Object.entries(FILES)) {
  try { src[key] = readFileSync(path, 'utf8') }
  catch { problems.push(`${path} is missing — the guard could not inspect it`); src[key] = '' }
}

const inspected = Object.values(src).filter(Boolean).length
if (inspected < Object.keys(FILES).length) {
  problems.push(`inspected ${inspected} of ${Object.keys(FILES).length} surfaces`)
}

/** Body of a `const NAME = ` / `function NAME(` block, to the next top-level close. */
function block(text, name) {
  const i = text.search(new RegExp(`(const|function|async function)\\s+${name}\\b`))
  if (i === -1) return ''
  return text.slice(i, i + 2600)
}

// 1. Fetch what you show.
const capsuleType = src.hook.split('export interface TaggableCapsule')[1]?.split('}')[0] ?? ''
if (!/closetItemIds\s*:/.test(capsuleType)) {
  problems.push('TaggableCapsule has no closetItemIds — Rebuild would have nothing to lay out')
}
const boardSelect = (src.hook.match(/from\('gp_boards'\)\s*\n?\s*\.select\(([^)]*)\)/) ?? [])[1] ?? ''
if (!boardSelect) problems.push('could not find the gp_boards select in useLookCategories')
else if (!boardSelect.includes('closet_item_ids')) {
  problems.push('the gp_boards select does not fetch closet_item_ids — Rebuild opens an empty canvas (ADR-0099)')
}

// 2. The card offers it, and loads it as a replacement rather than editing the original.
const cardActions = block(src.panel, 'capsuleCardActions')
if (!cardActions) problems.push('capsuleCardActions is not defined')
else if (!cardActions.includes('handleRebuildCapsule')) {
  problems.push('capsuleCardActions does not offer handleRebuildCapsule — a GoodPix capsule is uneditable')
}
const rebuild = block(src.panel, 'handleRebuildCapsule')
if (!rebuild) problems.push('handleRebuildCapsule is not defined')
else {
  if (!rebuild.includes('loadCapsuleAsRebuild')) {
    problems.push('handleRebuildCapsule does not use loadCapsuleAsRebuild')
  }
  if (/loadCapsule\(/.test(rebuild)) {
    problems.push('handleRebuildCapsule opens the ORIGINAL for in-place editing — a save would overwrite the image live on the client site')
  }
  if (!rebuild.includes('buildCanvasFromClosetItems')) {
    problems.push('handleRebuildCapsule does not lay the pieces out with buildCanvasFromClosetItems')
  }
}

// 3. The store carries the replacement, and the save passes it through.
for (const sym of ['replacesCapsuleId', 'loadCapsuleAsRebuild', 'noteSavedCapsuleAs']) {
  if (!src.store.includes(sym)) problems.push(`canvasStore has no ${sym}`)
}
const saveHandler = block(src.chat, 'handleSaveAsCapsule')
if (!saveHandler) problems.push('handleSaveAsCapsule is not defined')
else {
  if (!/replacesCapsuleId:\s*replacesCapsuleId/.test(saveHandler)) {
    problems.push('handleSaveAsCapsule does not pass replacesCapsuleId to saveCapsule — the rebuild would save beside a still-live original')
  }
  if (!saveHandler.includes('noteSavedCapsuleAs')) {
    problems.push('handleSaveAsCapsule never calls noteSavedCapsuleAs — a second Save would insert a third capsule')
  }
}
if (!src.save.includes('replaceGoodPixCapsule')) {
  problems.push('useCapsules.saveCapsule never calls replaceGoodPixCapsule')
} else if (!/isNew\s*&&\s*opts\.replacesCapsuleId/.test(src.save)) {
  problems.push('saveCapsule replaces on an UPDATE as well as an insert — an edit would retire an unrelated capsule')
}

// 4. Retire, never destroy, and hand the whole place over.
if (src.replace) {
  if (/\.delete\(/.test(src.replace)) {
    problems.push('capsuleReplace deletes the original — the scraped composite is the only record of the GoodPix layout')
  }
  if (!/is_deleted:\s*true/.test(src.replace)) problems.push('capsuleReplace does not retire the original')
  for (const [what, re] of [
    ['its filing',         /board_category_assignments/],
    ['its published state',/published:\s*original\.published/],
    ['its slot',           /sort_order:\s*original\.sort_order/],
  ]) {
    if (!re.test(src.replace)) problems.push(`capsuleReplace does not hand over ${what}`)
  }
}

console.log(`capsule rebuild: inspected ${inspected} surfaces`)
console.log(`  gp_boards select fetches closet_item_ids: ${boardSelect.includes('closet_item_ids') ? 'yes' : 'NO'}`)
console.log(`  capsuleCardActions offers Rebuild:        ${cardActions.includes('handleRebuildCapsule') ? 'yes' : 'NO'}`)
console.log(`  rebuild loads as a replacement:           ${rebuild.includes('loadCapsuleAsRebuild') ? 'yes' : 'NO'}`)
console.log(`  save hands the original's place over:     ${src.save.includes('replaceGoodPixCapsule') ? 'yes' : 'NO'}`)
console.log(`  original retired, not destroyed:          ${/is_deleted:\s*true/.test(src.replace) && !/\.delete\(/.test(src.replace) ? 'yes' : 'NO'}`)

if (inspected === 0) {
  console.error('\nFAIL\n  - the guard inspected nothing')
  process.exit(1)
}
if (problems.length) {
  console.error('\nFAIL')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('PASS — a GoodPix capsule can be rebuilt, and the rebuild takes its place without destroying it.')
