#!/usr/bin/env node
// @checks build guard
/**
 * THE COLLECTION RAIL SHOWS A SUBCATEGORY UNDER ITS CATEGORY (Cynthia Dada for Chris Cadieux,
 * #watson-atelier, 2026-10-16): "Blazers & Suit Jackets: Blazers & Sport Coats, Suit Jackets, Other
 * Tailored Jackets. Suits: Two-Piece Suits, Tuxedos & Formal Suits. These are how I need categories
 * and subcategories."
 *
 * FAILS before: the Custom block of the Collection rail was one alphabetical list, so his five
 * subcategories sat between Accessories and Weekend Bag Edit with nothing saying which category
 * they belong to, while his lookbook nested them. Now a category whose parent is also in the rail
 * is listed right under it, indented, in the order she set them up.
 *
 * Runs the real helper (transpiled), then checks the rail uses it. Exits non-zero on a break AND on
 * inspecting nothing (ADR-0106).
 */
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ts from 'typescript'

const ROOT = new URL('..', import.meta.url).pathname
const failures = []
let checked = 0
const need = (ok, msg) => { checked++; if (!ok) failures.push(msg) }
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')

const dir = mkdtempSync(path.join(tmpdir(), 'rail-nest-'))
for (const f of ['savedClosetCategories', 'categorize']) {
  const src = read(`src/lib/${f}.ts`)
  let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  js = js.replace(/from '(?:@\/lib\/|\.\/)([A-Za-z]+)(?:\.ts)?'/g, "from './$1.mjs'")
  writeFileSync(path.join(dir, f + '.mjs'), js)
}
const lib = await import(path.join(dir, 'savedClosetCategories.mjs'))
const nest = lib.nestRailSlugs
need(typeof nest === 'function', 'savedClosetCategories.ts exports nestRailSlugs, the rail order with subcategories under their category')

if (typeof nest === 'function') {
  // Chris Cadieux's tree as the rows are saved (parent in group_label, sort_order as she listed them).
  const parent = new Map([
    ['blazers-sport-coats', 'blazers-suit-jackets'], ['suit-jackets', 'blazers-suit-jackets'],
    ['other-tailored-jackets', 'blazers-suit-jackets'], ['two-piece-suits', 'suits'], ['tuxedos-formal-suits', 'suits'],
    ['jackets', 'outerwear'],
  ])
  const order = new Map([['blazers-suit-jackets', 1], ['blazers-sport-coats', 2], ['suit-jackets', 3], ['other-tailored-jackets', 4],
    ['suits', 5], ['two-piece-suits', 6], ['tuxedos-formal-suits', 7]])
  // The rail's flat list, alphabetical, as customRailSlugs gives it.
  const flat = ['blazers-sport-coats', 'blazers-suit-jackets', 'handkerchiefs', 'jackets', 'other-tailored-jackets', 'shirts',
    'suit-jackets', 'suits', 'tuxedos-formal-suits', 'two-piece-suits']
  const rows = nest(flat, (s) => parent.get(s), (s) => order.get(s) ?? 0)
  const shown = rows.map((r) => '  '.repeat(r.depth) + r.slug).join('\n')
  const want = [
    'blazers-suit-jackets', '  blazers-sport-coats', '  suit-jackets', '  other-tailored-jackets',
    'handkerchiefs', 'jackets', 'shirts',
    'suits', '  two-piece-suits', '  tuxedos-formal-suits',
  ].join('\n')
  need(shown === want, `Chris's rail nests his five subcategories under their two categories, in her order; got\n${shown}`)
  need(rows.length === flat.length && new Set(rows.map((r) => r.slug)).size === flat.length, 'every category in the rail is listed exactly once')
  need(rows.find((r) => r.slug === 'jackets')?.depth === 0, 'a category whose parent is not in the Custom rail (Jackets inside Outerwear) stays at the top')

  const none = nest(['49ers', 'travel'], () => undefined)
  need(none.map((r) => `${r.depth}${r.slug}`).join(',') === '049ers,0travel', 'a client with no tree gets exactly the list she had')

  const loop = new Map([['a', 'b'], ['b', 'a']])
  const cyc = nest(['a', 'b'], (s) => loop.get(s))
  need(cyc.length === 2, `a tree that loops (A inside B inside A) still lists both, once each; got ${JSON.stringify(cyc)}`)
}

const panel = read('src/components/categorize/CategorizePanel.tsx')
need(/nestRailSlugs\(\s*customRailSlugs\(/.test(panel), 'the Collection rail lists its Custom block through nestRailSlugs')
need(/depth=\{/.test(panel), 'the Collection rail indents a subcategory under its category')

if (checked === 0) { console.error('check-closet-rail-nesting: inspected nothing'); process.exit(1) }
if (failures.length) { console.error('check-closet-rail-nesting FAILED:\n  ' + failures.join('\n  ')); process.exit(1) }
console.log(`check-closet-rail-nesting OK (${checked} checks)`)
