#!/usr/bin/env node
/**
 * ADR-0137. PICKING ONE LOOK IS A CLICK, ON EVERY CARD GRID.
 *
 * Cynthia Dada, 2026-09-22: "Can we please have a select button when adding looks to other
 * categories? I don't always need to select all. Right now I'm selecting all and then deselecting
 * the looks I don't want in the category I'm adding to."
 *
 * Picking them one at a time already worked. The FIRST one had to be shift-clicked
 * (lib/lookCategoryFilter.ts, cardClickAction: `shiftKey || selecting`), and after that a plain
 * click toggled. That is why deselecting felt natural to her and starting did not, and why Select
 * all and undo 20 of 23 was the only route she could find.
 *
 * Categorize renders cards in TWO places — the sortable arrange grid on "On lookbook" and the
 * plain grid everywhere else. A checkbox on one of them is the bug again for whoever is on the
 * other, so this guard enumerates the card renderers and requires every one of them to use the
 * shared component. HARD-RULES: when you change something everywhere, list everywhere.
 *
 * Exits non-zero on failure and on inspecting nothing (ADR-0106).
 */
import { readFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname
const problems = []
const fail = (m) => { problems.push(m); console.error(`   ❌ ${m}`) }

const strip = (s) => s
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

/** Every file that draws a look or capsule card the stylist can select. */
const CARD_RENDERERS = [
  'src/components/categorize/LookArrangeGrid.tsx',
  'src/components/categorize/CategorizePanel.tsx',
]
const SHARED = 'src/components/categorize/SelectCheckbox.tsx'

let inspected = 0

// The shared component has to exist and actually be a checkbox a screen reader can announce.
const shared = strip(readFileSync(ROOT + SHARED, 'utf8'))
inspected++
for (const [needle, why] of [
  ['role="checkbox"', 'it is not announced as a checkbox'],
  ['aria-checked', 'its state is not announced'],
  ['stopPropagation', 'clicking it would also fire the card click behind it'],
  ['anySelected', 'a half-made selection would vanish on mouse-out'],
]) {
  if (!shared.includes(needle)) fail(`${SHARED}: ${why} (missing ${needle})`)
}

// Every card renderer uses it, and none of them is the only one that does.
for (const rel of CARD_RENDERERS) {
  let text
  try { text = strip(readFileSync(ROOT + rel, 'utf8')) } catch {
    fail(`${rel} is gone; this guard no longer covers what it claims to`); continue
  }
  inspected++
  if (!/<SelectCheckbox/.test(text)) {
    fail(`${rel}: draws selectable cards with no SelectCheckbox. Picking one look must be a click here too, not a shift-click (ADR-0137).`)
  }
  // The checkbox must ask for a SELECT, not a tag: cardClickAction only returns 'select' when
  // shiftKey is true or a selection is already running.
  const call = text.match(/onToggle=\{\(\)\s*=>\s*onCardClick\(([^)]*)\)\}/)
  if (!call) {
    fail(`${rel}: the checkbox does not route through onCardClick, so it can drift from what a shift-click does.`)
  } else if (!/,\s*true\s*$/.test(call[1])) {
    fail(`${rel}: the checkbox calls onCardClick without forcing select (got "${call[1]}"). With tagging on it would FILE the look instead of picking it.`)
  }
  // And the corner badge has to move, or the checkbox lands on top of it.
  if (!/BADGE_OFFSET_WHEN_SELECTABLE/.test(text)) {
    fail(`${rel}: the top-left badge does not shift, so the checkbox covers the order number or the Live/Draft pill.`)
  }
}

// The shift-click route must still work: it is what the muscle memory uses.
const filter = strip(readFileSync(ROOT + 'src/lib/lookCategoryFilter.ts', 'utf8'))
inspected++
if (!/opts\.shiftKey\s*\|\|\s*opts\.selecting/.test(filter)) {
  fail(`src/lib/lookCategoryFilter.ts: shift-click no longer selects. The checkbox is an addition, not a replacement (ADR-0137).`)
}

if (inspected === 0) { console.error('\n❌ card-select: inspected nothing.\n'); process.exit(1) }
console.log(`   ${inspected} file(s) inspected: ${CARD_RENDERERS.length} card renderer(s), the shared checkbox, and the shift-click rule`)

if (problems.length) {
  console.error(`\n❌ card-select: ${problems.length} failure(s).\n`)
  process.exit(1)
}
console.log('\n✅ card-select: every card grid offers a checkbox, and shift-click still works.\n')
