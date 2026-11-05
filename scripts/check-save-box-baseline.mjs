#!/usr/bin/env node
/**
 * A NEW LOOK SAVED WITH CATEGORIES TICKED IS FILED IN THEM. Cynthia Dada, 2026-11-05.
 *
 * Janet Foutty's Look 401: duplicated, Fall/Winter and Easy Professional ticked in Save Look, saved,
 * and Categorize showed it UNCATEGORIZED. "It's happening to looks not duplicated too." The Save box
 * used one list both as the pills it showed and as the baseline the save compares against, so
 * after any first save the next new look opened "already filed" in the last look's categories and
 * the save wrote nothing. See src/lib/saveBoxFiling.ts.
 *
 * Part 1 runs saveBoxStart on each case from her acceptance test, then the same difference
 * applyLookFiling writes. Part 2 holds ChatPanel to using it: the save compares against the
 * baseline, never against the shown ticks.
 *
 * Exits non-zero on failure and on inspecting nothing (ADR-0106).
 */
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'

const ROOT = new URL('..', import.meta.url).pathname
const problems = []
let checks = 0
const fail = (m) => { problems.push(m); console.error(`   ❌ ${m}`) }

// ── 1. the rule, on her cases ─────────────────────────────────────────────────────────────
const LIB = 'src/lib/saveBoxFiling.ts'
let saveBoxStart = null
if (!existsSync(ROOT + LIB)) {
  checks++
  fail(`${LIB} is missing: nothing keeps what the Save box SHOWS apart from what the save COMPARES against.`)
} else {
  const js = ts.transpileModule(readFileSync(ROOT + LIB, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
  const file = join(mkdtempSync(join(tmpdir(), 'save-box-')), 'saveBoxFiling.mjs')
  writeFileSync(file, js)
  ;({ saveBoxStart } = await import(file))
}

// What applyLookFiling writes for a baseline and a selection (src/lib/lookFiling.ts).
const k = (s) => s.trim().toLowerCase()
const diff = (baseline, selected) => ({
  added: selected.filter((s) => !baseline.map(k).includes(k(s))),
  removed: baseline.filter((b) => !selected.map(k).includes(k(b))),
})
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())

const X = ['Fall/Winter', 'Easy Professional']
const cases = [
  {
    name: '1. duplicate of a look filed in X, saved with X ticked',
    start: { filedLookId: null, filed: { labels: X, ok: true }, legacyTags: [], copiedFrom: X },
    tick: X, shown: X, added: X, removed: [],
  },
  {
    name: '2. brand-new look right after a save in X, X ticked',
    // filed = the look saved a moment ago: exactly the stale value that used to become the baseline
    start: { filedLookId: null, filed: { labels: X, ok: true }, legacyTags: [], copiedFrom: [] },
    tick: X, shown: [], added: X, removed: [],
  },
  {
    name: '3. existing look with tags but no filing, saved as it opens',
    start: { filedLookId: 'look-c', filed: { labels: [], ok: true }, legacyTags: X, copiedFrom: [] },
    tick: X, shown: X, added: X, removed: [],
  },
  {
    name: '4. unticking a category the look IS filed in removes it',
    start: { filedLookId: 'look-a', filed: { labels: X, ok: true }, legacyTags: X, copiedFrom: [] },
    tick: ['Easy Professional'], shown: X, added: [], removed: ['Fall/Winter'],
  },
  {
    name: 'a look saved with nothing changed writes nothing',
    start: { filedLookId: 'look-a', filed: { labels: X, ok: true }, legacyTags: [], copiedFrom: [] },
    tick: X, shown: X, added: [], removed: [],
  },
]

if (saveBoxStart) {
  for (const c of cases) {
    checks++
    const s = saveBoxStart(c.start)
    const d = diff(s.ok ? s.baseline : [], c.tick)
    if (!same(s.shown, c.shown)) fail(`${c.name}: opens with ${JSON.stringify(s.shown)} ticked, expected ${JSON.stringify(c.shown)}`)
    if (!same(d.added, c.added) || !same(d.removed, c.removed)) {
      fail(`${c.name}: the save files ${JSON.stringify(d.added)} and unfiles ${JSON.stringify(d.removed)}, expected ${JSON.stringify(c.added)} / ${JSON.stringify(c.removed)}`)
    }
  }
  checks++
  const failed = saveBoxStart({ filedLookId: 'look-a', filed: { labels: [], ok: false }, legacyTags: X, copiedFrom: [] })
  if (failed.ok) fail('a failed filing read is reported as ok, so the save could strip the look out of its categories')
}

// ── 2. ChatPanel uses it ──────────────────────────────────────────────────────────────────
const PANEL = 'src/components/layout/ChatPanel.tsx'
const panel = readFileSync(ROOT + PANEL, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
checks++
if (!/saveBoxStart\(/.test(panel)) fail(`${PANEL}: the Save box's start is not worked out by saveBoxStart.`)
checks++
if (!/applyLookFiling\(savedId, activeClient\.id, lookFilingOk \? lookFilingBaseline : \[\]/.test(panel)) {
  fail(`${PANEL}: the save compares against the ticks the box was opened with, not against where the look is filed, so a new look opened with ticks is filed nowhere.`)
}
checks++
// After a first save the board is still a new look (no currentLookId): its filing must not
// become the next look's baseline.
const after = panel.slice(panel.indexOf('applyLookFiling(savedId'))
const reread = after.slice(0, after.indexOf('refetchFiling()'))
if (/setLookFilingBaseline\(/.test(reread) && !/if \(currentLookId \|\| replacesLookId\)/.test(reread)) {
  fail(`${PANEL}: after saving a NEW look, its filing becomes the baseline of the next new look on the board.`)
}

console.log(`   ${checks} rule(s) checked across ${LIB}, ${PANEL}`)
if (checks === 0) { console.error('\n❌ save-box-baseline: inspected nothing.\n'); process.exit(1) }
if (problems.length) { console.error(`\n❌ save-box-baseline: ${problems.length} failure(s).\n`); process.exit(1) }
console.log('\n✅ save-box-baseline: a look saved with categories ticked is filed in them, new, duplicated or old.\n')
