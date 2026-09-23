#!/usr/bin/env node
/**
 * ADR-0148. REBUILD REPLACES THE LOOK IT OPENED. IT DOES NOT DUPLICATE IT.
 *
 * Cynthia Dada, 2026-09-23, on Peyton Look 182: "I'm trying to update the pants in this look by
 * restyling but when I go to save, it acts like I'm saving a new look, not updating a look."
 *
 * She was right, and she was describing the design. Categorize has two ways onto the canvas and
 * they look identical on screen:
 *
 *   Restyle, from the Transitions queue, REPLACED: loadLookAsReplacement, so the new row
 *   inherits the published state, the slot and the category filing, and the original is archived
 *   and still recoverable (ADR-0076, nothing overwritten).
 *
 *   Rebuild in canvas DUPLICATED: loadLookAsNew, so the Save box opened with an empty name, said
 *   Save rather than Update, and she was left with two looks and a manual dance to retire the
 *   first one.
 *
 * There was never a reason for Rebuild to do less. The rule this guards is that they cannot drift
 * apart again, because the only visible difference between them is which button she pressed.
 *
 * Exits non-zero on failure and on inspecting nothing (ADR-0106).
 */
import { readFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
const problems = []
const fail = (m) => { problems.push(m); console.error(`   ❌ ${m}`) }
let checks = 0

const strip = (s) => s
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const PANEL = 'src/components/categorize/CategorizePanel.tsx'
const panel = strip(readFileSync(ROOT + PANEL, 'utf8'))

/** The body of one handler, up to the next function declaration. */
const bodyOf = (name) => {
  const i = panel.indexOf(`function ${name}(`)
  if (i < 0) return null
  const j = panel.indexOf('\n  function ', i + 10)
  return panel.slice(i, j < 0 ? undefined : j)
}

for (const name of ['handleRebuildLook', 'handleRestyleTransitionedLook']) {
  const body = bodyOf(name)
  checks++
  if (!body) { fail(`${PANEL}: ${name} is gone; this guard no longer covers what it claims to.`); continue }
  if (/loadLookAsNew\(/.test(body)) {
    fail(`${PANEL}: ${name} opens the board as a NEW look, so saving leaves the stylist with two looks and the original still live (ADR-0148). Both paths replace.`)
  }
  if (!/loadLookAsReplacement\(/.test(body)) {
    fail(`${PANEL}: ${name} does not use loadLookAsReplacement, so the look it opened is never retired and never hands over its slot.`)
  }
}

// The Save button has to say what will happen. "Save" on a replacement is what made her think
// she was about to end up with two.
const CHAT = 'src/components/layout/ChatPanel.tsx'
const chat = strip(readFileSync(ROOT + CHAT, 'utf8'))
checks++
if (!/currentLookId \|\| replacesLookId \? 'Update Look'/.test(chat)) {
  fail(`${CHAT}: the Save button does not read "Update Look" on a replacement, so it still tells her she is making a second look (ADR-0148).`)
}
// And the name box must open with the look's own name, or she retypes it from another tab.
checks++
if (!/initialName=\{currentLook\?\.name \|\| restyledLookName\}/.test(chat)) {
  fail(`${CHAT}: the Save box no longer opens with the original's name (ADR-0132).`)
}

// The replacement itself must still hand over the slot and the filing rather than just archive.
const TRANS = 'src/lib/lookTransitions.ts'
const trans = strip(readFileSync(ROOT + TRANS, 'utf8'))
for (const [needle, why] of [
  ['look_category_assignments', 'the rebuilt look would reappear outside its categories, which reads to a client as lost'],
  ['published: original.published', 'a look that was live would come back as a draft, so the client would simply lose it'],
  ['sort_order: original.sort_order', 'the rebuilt look would jump to a different place in her gallery'],
  ['archived: true', 'the original would stay live beside its replacement, which is the duplicate all over again'],
]) {
  checks++
  if (!trans.includes(needle)) fail(`${TRANS}: ${why} (missing ${needle}).`)
}

if (checks === 0) { console.error('\n❌ rebuild-replaces: inspected nothing.\n'); process.exit(1) }
console.log(`   ${checks} rule(s) checked across ${PANEL}, ${CHAT}, ${TRANS}`)

if (problems.length) {
  console.error(`\n❌ rebuild-replaces: ${problems.length} failure(s).\n`)
  process.exit(1)
}
console.log('\n✅ rebuild-replaces: both ways onto the canvas replace the look they opened.\n')
