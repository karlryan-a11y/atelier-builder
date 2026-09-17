#!/usr/bin/env node
/**
 * Guard: on the Looks and Capsules tabs, a category click FILTERS, and a card click only
 * re-files a look when the stylist has turned tagging on.
 *
 * The bug this exists for (2026-09-15, Cynthia Dada on Janet Foutty): "When I click on a
 * category in the back end, it doesn't populate the looks in that category." The click picked
 * a tagging brush instead. The grid never changed, and every look clicked afterwards had that
 * category silently added or removed. Janet's 16 categories and 160 tags were intact; the
 * screen simply had no filter.
 *
 * Checked:
 *   1. filterByCategory returns only the looks in the picked category (and its nested ones),
 *      returns everything for "All", and returns everything while tagging is on.
 *   2. cardClickAction never tags with the switch off.
 *   3. mergeSubsetOrder keeps every look outside a filtered arrange in its slot, so dragging
 *      inside "Holiday Looks" cannot scramble the rest of her gallery.
 *   4. Select all takes the looks in view and leaves a selection made outside the filter
 *      alone, so a whole category can be added to another one in four clicks, with no
 *      keyboard (2026-09-17, Cynthia Dada: a Business Professional category holding both the
 *      FW and the SS looks).
 *   5. The panel actually routes through those, has no default category (the old code picked
 *      the first one for her), and the new copy has no em dashes.
 *
 * Reports the count exercised and exits non-zero at zero, per HARD-RULES.
 */
import { readFileSync } from 'node:fs'
import { filterByCategory, cardClickAction, mergeSubsetOrder, categoryIdsUnder, selectAllToggle, selectAllLabel } from '../src/lib/lookCategoryFilter.ts'

const PANEL = process.env.PANEL ?? 'src/components/categorize/CategorizePanel.tsx'
const failures = []
let checked = 0
const eq = (name, got, want) => {
  checked++
  if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
}

// ── 1. filtering ─────────────────────────────────────────────────────────────────────────
const cats = [
  { id: 'holiday', slug: 'holiday-looks', label: 'Holiday Looks', parent_slug: null },
  { id: 'zoom', slug: 'zoom-looks', label: 'Zoom Looks', parent_slug: null },
  { id: 'office', slug: 'office', label: 'Office', parent_slug: null },
  { id: 'fw-office', slug: 'fw-office', label: 'FW Office', parent_slug: 'office' },
]
const looks = [
  { id: 'a', categoryIds: ['holiday'] },
  { id: 'b', categoryIds: ['zoom'] },
  { id: 'c', categoryIds: ['holiday', 'zoom'] },
  { id: 'd', categoryIds: [] },
  { id: 'e', categoryIds: ['fw-office'] },
]
const ids = (xs) => xs.map((x) => x.id)
eq('Holiday Looks shows only its looks', ids(filterByCategory(looks, 'holiday', cats, false)), ['a', 'c'])
eq('All shows every look', ids(filterByCategory(looks, null, cats, false)), ['a', 'b', 'c', 'd', 'e'])
eq('tagging on shows every look, so there is something to add', ids(filterByCategory(looks, 'holiday', cats, true)), ['a', 'b', 'c', 'd', 'e'])
eq('a heading returns what is nested under it', ids(filterByCategory(looks, 'office', cats, false)), ['e'])
eq('nested ids resolve', [...categoryIdsUnder('office', cats)].sort(), ['fw-office', 'office'])

// ── 2. clicks ────────────────────────────────────────────────────────────────────────────
eq('browsing click with a category picked does nothing', cardClickAction({ shiftKey: false, selecting: false, tagging: false, categoryId: 'holiday' }), 'nothing')
eq('tagging click tags', cardClickAction({ shiftKey: false, selecting: false, tagging: true, categoryId: 'holiday' }), 'tag')
eq('tagging with no category picked does nothing', cardClickAction({ shiftKey: false, selecting: false, tagging: true, categoryId: null }), 'nothing')
eq('shift-click selects', cardClickAction({ shiftKey: true, selecting: false, tagging: false, categoryId: null }), 'select')
eq('click during a selection selects', cardClickAction({ shiftKey: false, selecting: true, tagging: true, categoryId: 'holiday' }), 'select')

// ── 3. reorder inside a filter ───────────────────────────────────────────────────────────
// Gallery 1..6; the filter holds 2, 4, 6 and she drags 6 to the front of it.
eq('filtered drag keeps everyone else in place', mergeSubsetOrder(['1', '2', '3', '4', '5', '6'], ['6', '2', '4']), ['1', '6', '3', '2', '5', '4'])
eq('unfiltered drag is unchanged', mergeSubsetOrder(['1', '2', '3'], ['3', '1', '2']), ['3', '1', '2'])

// ── 4. select all ───────────────────────────────────────────────────────────────
const sorted = (xs) => [...xs].sort()
eq('select all takes the looks in view', sorted(selectAllToggle(['a', 'c'], [])), ['a', 'c'])
eq('it leaves a selection made under another filter alone', sorted(selectAllToggle(['a', 'c'], ['x'])), ['a', 'c', 'x'])
eq('it completes a part-made selection', sorted(selectAllToggle(['a', 'c'], ['a'])), ['a', 'c'])
eq('pressed again it clears only what is in view', sorted(selectAllToggle(['a', 'c'], ['a', 'c', 'x'])), ['x'])
eq('an empty view changes nothing', sorted(selectAllToggle([], ['x'])), ['x'])
const lbl = (o) => selectAllLabel({ mode: 'looks', tagging: false, visibleCount: 14, selectedInViewCount: 0, ...o })
eq('it counts what it would take', lbl({}), 'Select all 14')
eq('with everything in view held it offers to let go', lbl({ selectedInViewCount: 14 }), 'Deselect all 14')
eq('it is absent while tagging, where "all" means her whole gallery', lbl({ tagging: true }), null)
eq('it is absent over an empty grid', lbl({ visibleCount: 0 }), null)
eq('it is absent off the looks and capsules tabs', lbl({ mode: 'collection' }), null)

// ── 5. the panel uses it ─────────────────────────────────────────────────────────────────
const src = readFileSync(PANEL, 'utf8')
const need = (name, ok) => { checked++; if (!ok) failures.push(`${PANEL}: ${name}`) }
need('the grid is filtered through filterByCategory', /filterByCategory\(/.test(src))
need('card clicks go through cardClickAction', /cardClickAction\(/.test(src))
need('a filtered arrange saves through mergeSubsetOrder', /mergeSubsetOrder\(/.test(src))
need('there is a Tag switch, off by default', /useState\(false\)/.test(src) && /setTagging\(/.test(src))
need('no category is picked for her by default', !/brush \?\? categories\[0\]/.test(src))
need('there is an All row', /All \{mode\}/.test(src))
need('the bar offers Select all', /selectAllToggle\(visibleIds, selected\)/.test(src) && /selectAllLabel\(/.test(src))
need('Select all is reachable before anything is selected', /\(selectAllText \|\| selected\.size > 0\)/.test(src))
need('Select all acts on what is in view', /visibleIds = useMemo\(\) =>|visibleIds = useMemo\(/.test(src) && /visible\.map\(\(i\) => i\.id\)/.test(src))
const toggles = src.split('\n').filter((l) => /toggleOnItem\(item, activeBrush\)/.test(l))
need(`toggleOnItem is called from exactly one place, the tag branch (found ${toggles.length})`,
  toggles.length === 1 && /action === 'tag'/.test(src.split('toggleOnItem(item, activeBrush)')[0].split('\n').slice(-2).join('\n')))
for (const s of ['Tagging is on.', 'to see only its', 'in this view', 'then press the + button above']) {
  const line = src.split('\n').find((l) => l.includes(s)) ?? ''
  need(`copy "${s}" exists and has no em dash`, line !== '' && !line.includes('—'))
}

console.log(`look category filter: ${checked} checks against ${PANEL} and src/lib/lookCategoryFilter.ts`)
if (checked === 0) { console.error('FAIL: inspected nothing'); process.exit(1) }
if (failures.length) {
  console.error('\nFAIL')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('PASS')
