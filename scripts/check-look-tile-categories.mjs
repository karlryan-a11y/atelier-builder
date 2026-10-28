#!/usr/bin/env node
/**
 * Looks grid tiles show where a look is FILED, and can file it (Maegan, Zoom clip 2026-09-29).
 * The tile used to print look.tags, which is not filing (ADR-0149): 16 of Janet Foutty's 99 tiles
 * named categories the look was not in. Shapes below are Janet's real ones (Look 138 tagged
 * "Easy Professional, Fall/Winter" and filed in nothing; Look 175 tagged three, filed Fall/Winter).
 * Exits non-zero on a break AND on inspecting nothing.
 */
import { readFileSync } from 'node:fs'
import { lookTileFiling, tilePickerCategories } from '../src/lib/lookTileCategories.ts'

const failures = []
let checked = 0
const eq = (name, got, want) => {
  checked++
  if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
}
const cats = [
  { id: 'old', label: 'Fw Office Denim', sort_order: 0, is_hidden: true },
  { id: 'ep', label: 'Easy Professional', sort_order: 1 },
  { id: 'bp', label: 'Business Professional', sort_order: 3 },
  { id: 'sp', label: 'Speaking & Panel', sort_order: 4 },
  { id: 'co', label: 'Colorado', sort_order: 9, is_residence: true },
  { id: 'fw', label: 'Fall/Winter', sort_order: 17, season: 'fw' },
  { id: 'ss', label: 'Spring/Summer', sort_order: 18, season: 'ss' },
]

eq('Look 138: tagged but filed nowhere', lookTileFiling([], cats), { labels: [], uncategorized: true })
eq('Look 175: only Fall/Winter', lookTileFiling(['fw'], cats), { labels: ['Fall/Winter'], uncategorized: true })
eq('Look 174: her order, not the order filed', lookTileFiling(['sp', 'bp'], cats), { labels: ['Business Professional', 'Speaking & Panel'], uncategorized: false })
eq('a season is listed last, like her look page', lookTileFiling(['fw', 'ep'], cats), { labels: ['Easy Professional', 'Fall/Winter'], uncategorized: false })
eq('a hidden category is not shown and does not count', lookTileFiling(['old'], cats), { labels: [], uncategorized: true })
eq('a home alone is shown but still needs a category', lookTileFiling(['co'], cats), { labels: ['Colorado'], uncategorized: true })
eq('an id she has no category for', lookTileFiling(['gone', 'ep'], cats), { labels: ['Easy Professional'], uncategorized: false })
eq('the picker lists what she can see, in her order', tilePickerCategories(cats).map((c) => c.id), ['ep', 'bp', 'sp', 'co', 'fw', 'ss'])

// The tile is wired to the filing, not the tags, and can file from the grid.
const gallery = readFileSync(new URL('../src/components/canvas/LookGallery.tsx', import.meta.url), 'utf8')
const panel = readFileSync(new URL('../src/components/layout/ChatPanel.tsx', import.meta.url), 'utf8')
for (const [file, src, what, re, want] of [
  ['LookGallery.tsx', gallery, 'the tile no longer prints look.tags', /look\.tags/, false],
  ['LookGallery.tsx', gallery, 'the tile lists its filing', /lookTileFiling\(/, true],
  ['LookGallery.tsx', gallery, 'the labels are not cut off', /data-look-categories[^>]*truncate/, false],
  ['LookGallery.tsx', gallery, 'No category on a look that needs one', /No category/, true],
  ['LookGallery.tsx', gallery, 'the category picker', /data-look-category-picker/, true],
  ['LookGallery.tsx', gallery, 'a click on the picker does not load the look', /data-look-categories-button[\s\S]{0,400}stopPropagation/, true],
  ['ChatPanel.tsx', panel, 'the grid files through the same assignLook as Categorize', /useLookCategories\(/, true],
  ['ChatPanel.tsx', panel, 'the Save box re-reads a filing changed from a tile', /filingKey/, true],
]) {
  checked++
  if (re.test(src) !== want) failures.push(`${file}: ${what}`)
}

if (checked === 0) { console.error('check-look-tile-categories: inspected nothing'); process.exit(1) }
if (failures.length) { console.error('check-look-tile-categories FAILED:\n  ' + failures.join('\n  ')); process.exit(1) }
console.log(`check-look-tile-categories OK (${checked} checks)`)
