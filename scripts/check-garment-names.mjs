#!/usr/bin/env node
/**
 * Garment names are read as the garment they are. Chris Cadieux, 2026-10-06 (Cynthia Dada): a sync
 * showed his shirts and trousers under "Dresses" and a T-shirt under jewelry. detectCategory read
 * "Dress Shirt" / "Dress Trousers" as dresses (and the first-word rule read any name starting
 * "Dress" as one), and "faux-layering" as jewelry because it ends in "ring". FAILS on the code
 * before this commit (6 of 14). atelier-looks carries the same rule (tests/categorizeNames.test.ts).
 */
import { detectCategory } from '../src/lib/categorize.ts'
const cases = [
  ['Linen Button Up Dress Shirt', 'tops'], ['Classic MTM Standard Dress Shirt', 'tops'],
  ['Navy Blue Tailored Dress Trousers', 'pants'], ['Dress Shoes Oxford', 'shoes'],
  ['Cotton jersey crew neck T-shirt with faux-layering', 'tops'],
  ['Floral Margaret Satin Sheath Belted Shirt Dress', 'dresses'], ['dress-zimmermann-blue', 'dresses'],
  ['Midi Dress', 'dresses'], ['Shirtdress Linen', 'dresses'], ['Gold Signet Ring', 'jewelry'],
  ['Diamond Rings', 'jewelry'], ['Hoop Earrings', 'jewelry'], ['Earring Studs', 'jewelry'], ['Bootcut Jeans', 'jeans'],
]
const failures = cases.filter(([n, want]) => detectCategory(n) !== want).map(([n, want]) => `"${n}" -> ${detectCategory(n)}, want ${want}`)
if (failures.length) { console.error(`check-garment-names: FAIL (${failures.length} of ${cases.length})`); for (const f of failures) console.error('  - ' + f); process.exit(1) }
console.log(`check-garment-names: ok (${cases.length} names, Chris Cadieux's included)`)
