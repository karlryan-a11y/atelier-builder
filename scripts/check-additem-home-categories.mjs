#!/usr/bin/env node
// @checks build
/**
 * ADD ITEM SHOWS THE PICKED HOME'S CATEGORIES. (Cynthia Dada for Keil Cadieux, 2026-11-19)
 *
 * "When adding new items to a specific residence under a client's site, I should only be able to
 * see the categories under that residence." Confirmed: pick Carlton Landing and the category list
 * shows only the categories her Carlton Landing pieces already use; the same for Creekside.
 *
 * lib/homeCategories.ts decides it from the same per-piece categories the Collection rail counts
 * (CollectionTab categoriesByItem, homes included through useItemHomes), so "a Carlton Landing
 * piece" means what the Carlton Landing row on the rail means. The homes themselves stay in the
 * list so she can switch homes. No home picked, or a home with no pieces yet: the full list.
 * FAILS before: there is no lib/homeCategories.ts and Add Item never looks at the home.
 */
import { readFileSync, existsSync } from 'node:fs'
const fails = []
const need = (ok, m) => { if (!ok) fails.push(m) }

need(existsSync('src/lib/homeCategories.ts'), 'src/lib/homeCategories.ts exists')
if (existsSync('src/lib/homeCategories.ts')) {
  const { categoriesByHome, homesPickedIn, categoriesForHomes } = await import('../src/lib/homeCategories.ts')
  const homes = new Map([['creekside', 'Creekside'], ['carlton-landing', 'Carlton Landing']])
  const cats = new Map([
    ['a', ['dresses', 'at home', 'creekside']],
    ['b', ['athletic-tops', 'carlton-landing']],
    ['c', ['dresses', 'carlton-landing', 'creekside']],
    ['d', ['handbags', '__no_home__']],
  ])
  const byHome = categoriesByHome(cats, homes)
  const eq = (a, b, what) => need(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)
  eq([...(byHome.get('carlton-landing') ?? [])].sort(), ['athletic-tops', 'dresses'], 'Carlton Landing uses what its pieces use, never a home')
  eq([...(byHome.get('creekside') ?? [])].sort(), ['at home', 'dresses'], 'Creekside uses what its pieces use')

  eq(homesPickedIn('carlton-landing', [], homes), ['carlton-landing'], 'a home picked under Category counts')
  eq(homesPickedIn('dresses', ['creekside'], homes), ['creekside'], 'a home picked under Also in counts')
  eq(homesPickedIn('dresses', ['handbags'], homes), [], 'no home picked')
  eq(homesPickedIn('creekside', [], new Map()), [], 'a client without homes never filters')

  const allowedCL = categoriesForHomes(['carlton-landing'], byHome, homes)
  need(allowedCL && allowedCL('athletic-tops') && allowedCL('dresses'), 'Carlton Landing lists its own categories')
  need(allowedCL && !allowedCL('at home') && !allowedCL('handbags'), 'Carlton Landing hides categories only Creekside (or no home) uses')
  need(allowedCL && allowedCL('creekside') && allowedCL('carlton-landing'), 'both homes stay listed so she can switch')
  const allowedCS = categoriesForHomes(['creekside'], byHome, homes)
  need(allowedCS && allowedCS('at home') && !allowedCS('athletic-tops'), 'switching to Creekside changes the list')
  eq(categoriesForHomes([], byHome, homes), null, 'no home picked: the full list, as today')
  eq(categoriesForHomes(['lake-house'], byHome, new Map([...homes, ['lake-house', 'Lake House']])), null, 'a home with no pieces yet: the full list')
}

const dlg = readFileSync('src/components/layout/AddItemDialog.tsx', 'utf8')
need(/categoriesForHomes\(/.test(dlg), 'Add Item filters its lists by the picked home')
need(/<CategoryOptions[^>]*omit=\{/.test(dlg), 'the Category list is filtered too, not only Also in')
const tab = readFileSync('src/components/categorize/CollectionTab.tsx', 'utf8')
need(/<AddItemDialog[^>]*homeCategories=\{/.test(tab), 'Collection passes each home\'s categories to Add Item')

if (fails.length) { console.error('check-additem-home-categories FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('check-additem-home-categories: ok')
