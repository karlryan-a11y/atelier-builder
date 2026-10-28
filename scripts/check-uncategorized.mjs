#!/usr/bin/env node
// @checks build guard
/**
 * Uncategorized guard (Paige 10/13, Karl 10/14). A look is uncategorized when it is in no category
 * she files by: a home or a season alone does not count, nor does a hidden category. The Looks rail
 * has an Uncategorized row with File into…, and the Collection rail shows No category at the top
 * instead of Other at the bottom. Exits non-zero on a break AND on inspecting nothing.
 */
import { readFileSync } from 'node:fs'
import { isUncategorized } from '../src/lib/lookCategoryFilter.ts'

const failures = []
let checked = 0
const is = (name, got, want) => { checked++; if (got !== want) failures.push(`${name}: expected ${want}, got ${got}`) }
const cats = [
  { id: 'eve', is_hidden: false, is_residence: false, season: null },
  { id: 'nyc', is_hidden: false, is_residence: true, season: null },
  { id: 'fw', is_hidden: false, is_residence: false, season: 'fw' },
  { id: 'old', is_hidden: true, is_residence: false, season: null },
]
is('no categories at all', isUncategorized([], cats), true)
is('a home alone', isUncategorized(['nyc'], cats), true)
is('a season alone', isUncategorized(['fw'], cats), true)
is('a home and a season', isUncategorized(['nyc', 'fw'], cats), true)
is('a hidden category alone', isUncategorized(['old'], cats), true)
is('a category she files by', isUncategorized(['eve'], cats), false)
is('a category plus a home', isUncategorized(['eve', 'nyc'], cats), false)
is('an id no category has', isUncategorized(['gone'], cats), true)

const panel = readFileSync(new URL('../src/components/categorize/CategorizePanel.tsx', import.meta.url), 'utf8')
for (const [what, re] of [
  ['the Uncategorized rail row', /data-uncategorized/],
  ['File into… for the selection', /data-file-into/],
  ['the grid filters to uncategorized', /showUncat \? byCat\.filter\(\(i\) => isUncategorized\(i\.categoryIds, categories\)\)/],
  ['No category at the top of the Collection rail', /data-no-category/],
  ['Other is not listed again at the bottom', /slugs\.filter\(\(s\) => s !== 'other' &&/],
]) { checked++; if (!re.test(panel)) failures.push(`CategorizePanel.tsx: ${what} is missing`) }

if (checked === 0) { console.error('check-uncategorized: inspected nothing'); process.exit(1) }
if (failures.length) { console.error('check-uncategorized FAILED:\n  ' + failures.join('\n  ')); process.exit(1) }
console.log(`check-uncategorized OK (${checked} checks)`)
