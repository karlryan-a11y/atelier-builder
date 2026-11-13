#!/usr/bin/env node
/**
 * MAEGAN'S STANDARD CATEGORIES IN EVERY PICKER (Maegan, #watson-atelier, 2026-10-20; men's list
 * and "every new client" from Karl, 11/12): a client switched on is filed in her women's or men's
 * 19 categories and their sub-categories, with Collections that pieces are tagged into here.
 *
 * FAILS before: the builder had no standard tree, and Set category, Also add to, Add Item and Edit
 * Item offered only today's fixed list and her customs, so a piece could not be filed under Day
 * Dresses or tagged into Resort & Beach unless another piece already was.
 *
 * Checks the real lists (transpiled): 19/103 women's, 19/85 men's, the Collections, and that unset
 * (every existing client) means no tree. Then that they are the SAME lists her Wardrobe page files by
 * (atelier-looks) and the camera files new pieces by (wsg-dashboard wgip.ts), when those checkouts
 * sit beside this one, and that all four pickers pass it. Exits non-zero on a break AND on
 * inspecting nothing (ADR-0106).
 */
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ts from 'typescript'

const ROOT = new URL('..', import.meta.url).pathname
const failures = []
let checked = 0
const need = (ok, msg) => { checked++; if (!ok) failures.push(msg) }
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')

let src = ''
try { src = read('src/lib/standardTree.ts') } catch { failures.push('src/lib/standardTree.ts is missing') }
if (src) {
  const dir = mkdtempSync(path.join(tmpdir(), 'std-tree-'))
  writeFileSync(path.join(dir, 'standardTree.mjs'), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
  const t = await import(path.join(dir, 'standardTree.mjs'))
  need(t.WOMEN_CATEGORIES.length === 19, `19 women's categories; got ${t.WOMEN_CATEGORIES.length}`)
  need(t.WOMEN_SUBS.length === 103, `103 women's sub-categories; got ${t.WOMEN_SUBS.length}`)
  need(t.MEN_CATEGORIES?.length === 19, `19 men's categories; got ${t.MEN_CATEGORIES?.length}`)
  need(t.MEN_SUBS?.length === 85, `85 men's sub-categories; got ${t.MEN_SUBS?.length}`)
  need(t.STANDARD_COLLECTIONS.map((c) => c.label).join(',') === 'Eveningwear,Resort & Beach', 'Collections are Eveningwear and Resort & Beach')
  need(t.MEN_COLLECTIONS?.map((c) => c.label).join(',') === 'Eveningwear & Black Tie,Resort & Beach,Golf,Tennis,Fur & Shearling,Ski & Snow,Travel,Workwear', "men's Collections are Maegan's eight")
  // Karl, 11/12: only new clients (switched on when the site is made); every existing client is unset and unchanged.
  need(t.closetTreeOf(null) === null && t.closetTreeOf(undefined) === null && t.closetTreeOf('off') === null, "unset keeps today's pickers")
  need(t.closetTreeOf('women')?.kind === 'women' && t.closetTreeOf('men')?.kind === 'men', 'women and men switch the lists on')
  const rows = t.standardTreeRows(t.closetTreeOf('men'))
  need(rows.filter((r) => !r.parent_slug).length === 19 && rows.filter((r) => r.parent_slug).length === 85, "the men's tree as Edit Item's two-step rows")
  need(/standardTreeRows\(closetTree\)/.test(read('src/components/layout/EditItemDialog.tsx')), 'Edit Item picks a main category then a sub-category from her standard list')
  // The preview showed Dresses with no Subcategory box at all (11/12): the box must show her standard sub-categories.
  need(/if \(!canSub && !\(closetTree && subs\.length\)\) return null/.test(read('src/components/layout/EditItemDialog.tsx')), "Edit Item's Subcategory box shows the standard sub-categories")
  need(/StandardTreePanel/.test(read('src/components/categorize/NestingTab.tsx')), "Nesting shows the Women's / Men's switch")

  // The same lists, word for word, as her Wardrobe page and the camera.
  const block = (name) => (s) => (s.match(new RegExp(`const ${name}[\\s\\S]*?\\n\\]`)) || [''])[0]
  const looks = path.join(ROOT, '..', 'atelier-looks', 'src/lib/standardTree.ts')
  if (existsSync(looks)) {
    const other = readFileSync(looks, 'utf8')
    for (const name of ['WOMEN_LIST', 'MEN_LIST', 'MEN_COLLECTIONS', 'STANDARD_COLLECTIONS']) need(block(name)(src) !== '' && block(name)(other) === block(name)(src), `${name} differs from atelier-looks src/lib/standardTree.ts`)
  } else console.log('  standard tree: atelier-looks is not beside this checkout, compared this copy only')
  const wgip = path.join(ROOT, '..', 'wsg-dashboard', 'src/lib/captureV2/wgip.ts')
  if (existsSync(wgip)) {
    const w = readFileSync(wgip, 'utf8')
    const subs = t.WOMEN_SUBS.filter((s) => !w.includes(`"${s.label}"`)).map((s) => s.label)
    const cats = t.WOMEN_CATEGORIES.filter((c) => !w.includes(`"${c.label}"`)).map((c) => c.label)
    need(subs.length === 0 && cats.length === 0, `the camera's list (wgip.ts) lacks ${[...cats, ...subs].join(', ')}`)
  }
}

for (const f of ['src/components/categorize/CollectionTab.tsx', 'src/components/layout/EditItemDialog.tsx', 'src/components/layout/AddItemDialog.tsx']) {
  const s = read(f)
  const pickers = (s.match(/<CategoryOptions /g) || []).length
  const withTree = (s.match(/<CategoryOptions [^>]*tree=\{/g) || []).length
  need(pickers > 0 && pickers === withTree, `${f}: ${withTree} of ${pickers} category pickers offer her standard categories`)
}

if (checked === 0) failures.push('inspected nothing')
if (failures.length) { console.error('standard tree FAILED:\n  ' + failures.join('\n  ')); process.exit(1) }
console.log(`  standard tree ok - ${checked} checks: women's 19/103, men's 19/85, Collections, new clients only, every picker`)
