#!/usr/bin/env node
/**
 * ADR-0153, the stylist's half. SHE CAN MARK A LOOK SHE ALREADY BUILT, AND MARK MANY AT ONCE.
 *
 * Maegan Watson, 2026-09-23: "we need a more sophisticated solution for 'to be tried' looks."
 *
 * The Save box shipped first and the team used it at once: 65 looks marked across 2 clients in
 * four days. But it only reaches the look she is making RIGHT NOW. The 478 looks already carrying
 * "to be tried" in their NAME across 34 clients — the workaround this replaces — can only move
 * across if she can mark looks she built before, and in bulk. One at a time is not a migration
 * anybody performs; it is a feature that quietly never gets adopted.
 *
 * Four rules:
 *
 *   1. THE COLUMN IS LOADED. Categorize reads its own list; a column left out of that SELECT is
 *      `undefined` at runtime, so every look would look unmarked and the pill would read 0
 *      forever (ADR-0103).
 *   2. THERE IS A QUEUE. A status pill, so the marked looks are a place she can go rather than a
 *      state she has to hunt for card by card.
 *   3. SHE CAN MARK ONE, AND MANY. The card toggle and the bulk action on the selection she
 *      already makes.
 *   4. THE BULK WRITE IS CHUNKED. A big `.in()` write fails silently on this database, which is
 *      exactly how "marked 200 looks" reports success over a selection it never touched.
 *
 * Exits non-zero on failure and on inspecting nothing (ADR-0106).
 */
import { readFileSync, existsSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
const problems = []
const fail = (m) => { problems.push(m); console.error(`   ❌ ${m}`) }
let checks = 0
const strip = (s) => s
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const read = (rel) => {
  if (!existsSync(ROOT + rel)) { fail(`${rel}: file not found`); return '' }
  return strip(readFileSync(ROOT + rel, 'utf8'))
}

// 1. loaded
const LOAD = 'src/lib/lookCategoriesLoad.ts'
const load = read(LOAD)
checks++
if (!/to_try_at/.test(load)) fail(`${LOAD}: to_try_at is not in the Categorize SELECT, so every look reads as unmarked (ADR-0103).`)
checks++
if (!/toTryAt:/.test(load)) fail(`${LOAD}: the column is selected but never mapped onto the look.`)

// 2. a queue
const PANEL = 'src/components/categorize/CategorizePanel.tsx'
const panel = read(PANEL)
checks++
if (!/'totry'/.test(panel)) fail(`${PANEL}: there is no To try view, so marked looks are a state she must hunt for card by card.`)
checks++
if (!/label: `To try \(\$\{looks\.filter/.test(panel)) fail(`${PANEL}: the To try pill carries no count.`)
checks++
if (!/status === 'totry'\) return !!\(i as TaggableLook\)\.toTryAt && !i\.archived/.test(panel)) {
  fail(`${PANEL}: the To try view does not exclude archived looks. A look nobody can see is not one anybody is being asked to try.`)
}

// 3. one, and many
checks++
if (!/setLooksToTry\(\[look\.id\], !look\.toTryAt\)/.test(panel)) fail(`${PANEL}: no per-card toggle, so a look she built earlier can never be marked.`)
checks++
if (!/setLooksToTry\(\[\.\.\.selected\], true\)/.test(panel)) {
  fail(`${PANEL}: no bulk mark. The 478 looks named "to be tried" cannot be migrated one at a time (ADR-0153).`)
}

// 4. chunked, and it takes a list
const HOOK = 'src/hooks/useLookCategories.ts'
const hook = read(HOOK)
checks++
if (!/setLooksToTry = useCallback\(async \(lookIds: string\[\]/.test(hook)) {
  fail(`${HOOK}: setLooksToTry does not take a list, so there is nothing for a bulk action to call.`)
}
checks++
if (!/i \+= 50/.test(hook.slice(hook.indexOf('setLooksToTry'), hook.indexOf('setLooksToTry') + 1400))) {
  fail(`${HOOK}: the bulk write is not chunked. A big .in() write fails silently here, so "marked 200 looks" would report success over a selection it never touched.`)
}

console.log(`   ${checks} rule(s) checked across ${LOAD}, ${PANEL}, ${HOOK}`)
if (checks === 0) { console.error('\n❌ to-try-stylist: inspected nothing.\n'); process.exit(1) }
if (problems.length) { console.error(`\n❌ to-try-stylist: ${problems.length} failure(s).\n`); process.exit(1) }
console.log('\n✅ to-try-stylist: she can mark one, mark many, and see the queue.\n')
