#!/usr/bin/env node
// Take selected pieces out of one category in one step (Cynthia Dada for Peyton Wheeler, 2026-11-11:
// 71 pieces in Accessories and only Set category / Also add to, both of which put pieces IN).
// Shapes are Peyton's real ones: tights also in Accessories, a bag charm whose main category IS
// accessories. FAILS before: no lib/removeFromCategory.ts and no "Remove from" in the bulk bar.
// Exits non-zero on a break AND on checking nothing.
import { readFileSync, existsSync } from 'node:fs'

const LIB = 'src/lib/removeFromCategory.ts'
const fails = []
let checked = 0
const need = (ok, m) => { checked++; if (!ok) fails.push(m) }
const eq = (name, got, want) => need(JSON.stringify(got) === JSON.stringify(want), `${name}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)

if (!existsSync(LIB)) {
  fails.push(`${LIB} is missing: there is no way to take pieces out of a category`)
} else {
  const { removalFrom, NO_CATEGORY } = await import('../' + LIB)
  eq('the rail\'s "No category" row is the other slug', NO_CATEGORY, 'other')
  // 80 Denier Tights: main tights, also Accessories. Keeps Tights, loses Accessories only.
  eq('tights also in accessories', removalFrom('accessories', { primary: 'tights', also: ['accessories'] }), { custom_categories: null })
  // A hat also in Accessories and a home: the home stays.
  eq('hat also in accessories and a home', removalFrom('accessories', { primary: 'hats', also: ['accessories', 'creekside'] }), { custom_categories: ['creekside'] })
  // The Fish Bag Charm: main accessories, also accessories. Goes to No category, not to Handbags.
  eq('bag charm filed only as accessories', removalFrom('accessories', { primary: 'accessories', also: ['accessories'] }), { custom_categories: null, category: 'other' })
  // A piece whose main category is the one removed and has another Also in: that Also in stays.
  eq('main category removed, Also in kept', removalFrom('accessories', { primary: 'accessories', also: ['gloves'] }), { category: 'other' })
  // Not filed there: nothing written.
  eq('a piece not in the category', removalFrom('accessories', { primary: 'shoes', also: ['travel'] }), null)
  eq('No category itself is never "removed" into itself', removalFrom('other', { primary: 'other', also: [] }), null)
}

const col = readFileSync('src/components/categorize/CollectionTab.tsx', 'utf8')
need(/removalFrom\(/.test(col), 'Collection uses lib/removeFromCategory for its bulk Remove')
need(/<Minus [^>]*\/> Remove from \{removeLabel\}/.test(col), 'the bulk bar has a "Remove from <category>" button')
need(/\.update\(patch\)\.eq\('id', id\)\.eq\('client_id', clientId\)\.select\('id'\)/.test(col), 'each removal names the client and asks for its row back (ADR-0108)')

if (checked === 0) fails.push('checked nothing')
if (fails.length) { console.error('check-remove-from-category FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log(`check-remove-from-category: ok (${checked} checks)`)
