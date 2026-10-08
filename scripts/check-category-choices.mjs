#!/usr/bin/env node
/**
 * Category dropdowns list HER categories first (Karl, 2026-10-07). Chris Cadieux's dropdowns opened
 * on Dresses, Tops, Skirts... with Jewelry, Handbags and Swim above his own Shirts and Jackets.
 * FAILS on the code before this commit (no lib/categoryChoices.ts; the four dropdowns listed the
 * fixed taxonomy first). atelier-looks holds the same rule (tests/categoryChoices.test.ts).
 */
import { readFileSync, existsSync } from 'node:fs'
let checked = 0
const failures = []
const ok = (c, m) => { checked++; if (!c) failures.push(m) }
if (!existsSync(new URL('../src/lib/categoryChoices.ts', import.meta.url))) {
  console.error('check-category-choices: FAIL - src/lib/categoryChoices.ts does not exist'); process.exit(1)
}
const src = readFileSync(new URL('../src/lib/categoryChoices.ts', import.meta.url), 'utf8')
const fn = src.slice(src.indexOf('export function splitCategoryChoices'))
  .replace('export function', 'function')
  .replace(/:\s*CategoryChoice\[\]/g, '').replace(/:\s*Set<string> \| null \| undefined/g, '')
  .replace(/\):\s*\{[^}]*\}\s*\{/, ') {')
const labels = { dresses: 'Dresses', tops: 'Tops', skirts: 'Skirts', pants: 'Pants', jeans: 'Denim', shorts: 'Shorts', outerwear: 'Outerwear', swim: 'Swim', shoes: 'Shoes', bags: 'Handbags', jewelry: 'Jewelry', belts: 'Belts', hats: 'Hats', other: 'Other' }
const split = new Function('CATEGORY_LABELS', `const FIXED = Object.entries(CATEGORY_LABELS).filter(([s]) => s !== 'other').map(([slug, label]) => ({ slug, label })); ${fn}; return splitCategoryChoices`)(labels)

// Chris Cadieux, 2026-10-07: stored shirts/jackets/sweaters/ties/vests are custom; pants, jeans,
// shoes, belts, hats, shorts are fixed.
const custom = ['jackets', 'shirts', 'sweaters', 'ties', 'vests'].map((s) => ({ slug: s, label: s[0].toUpperCase() + s.slice(1) }))
const used = new Set(['shirts', 'jackets', 'shoes', 'pants', 'jeans', 'sweaters', 'belts', 'ties', 'hats', 'shorts', 'vests'])
const r = split(custom, used)
const mine = r.mine.map((c) => c.label)
ok(r.grouped, 'Chris has categories, so the dropdown should be grouped')
ok(mine.join(',') === 'Belts,Denim,Hats,Jackets,Pants,Shirts,Shoes,Shorts,Sweaters,Ties,Vests', `his own categories first, got ${mine.join(',')}`)
ok(!mine.includes('Dresses') && !mine.includes('Jewelry') && !mine.includes('Skirts'), 'a category he does not use is listed as his')
ok(r.more.map((c) => c.label).includes('Dresses'), 'nothing is removed: Dresses must still be offered under More')
const empty = split([], new Set())
ok(!empty.grouped && empty.more.length === Object.keys(labels).length - 1, 'a client with no categories gets the plain list')

const files = {
  'src/components/layout/EditItemDialog.tsx': 1,
  'src/components/layout/AddItemDialog.tsx': 1,
  'src/components/categorize/CollectionTab.tsx': 2,
}
for (const [f, n] of Object.entries(files)) {
  const s = readFileSync(new URL('../' + f, import.meta.url), 'utf8')
  ok((s.match(/<CategoryOptions /g) ?? []).length === n, `${f} should use <CategoryOptions> ${n} time(s)`)
  ok(/useUsedCategories\(\)/.test(s), `${f} does not read the client's used categories`)
}
if (failures.length) { console.error(`check-category-choices: FAIL (${failures.length} of ${checked})`); for (const f of failures) console.error('  - ' + f); process.exit(1) }
console.log(`check-category-choices: ok (${checked} assertions: Chris Cadieux's real categories, plain list for a new client, 4 dropdowns wired)`)
