#!/usr/bin/env node
/**
 * MAEGAN'S STANDARD CATEGORIES IN EVERY PICKER (Maegan, #watson-atelier, 2026-10-20): every
 * client's Wardrobe is filed in her 19 categories and their sub-categories, with Collections such
 * as Eveningwear and Resort & Beach that pieces are tagged into from the builder.
 *
 * FAILS before: the builder had no standard tree, and Set category, Also add to, Add Item and Edit
 * Item offered only today's fixed list and her customs, so a piece could not be filed under Day
 * Dresses or tagged into Resort & Beach unless another piece already was.
 *
 * Checks the real list (transpiled): 19 categories, 103 sub-categories, the two Collections, and
 * that unset means the women's tree. Then that it is the SAME list her Wardrobe page files by
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
  need(t.STANDARD_COLLECTIONS.map((c) => c.label).join(',') === 'Eveningwear,Resort & Beach', 'Collections are Eveningwear and Resort & Beach')
  need(t.closetTreeOf(null)?.kind === 'women' && t.closetTreeOf('off') === null, 'unset is the women\'s tree, off keeps today\'s closet')

  // The same list, word for word, as her Wardrobe page and the camera.
  const block = (s) => (s.match(/const WOMEN_LIST[\s\S]*?\n\]/) || [''])[0]
  const looks = path.join(ROOT, '..', 'atelier-looks', 'src/lib/standardTree.ts')
  if (existsSync(looks)) need(block(readFileSync(looks, 'utf8')) === block(src), 'the women\'s list differs from atelier-looks src/lib/standardTree.ts')
  else console.log('  standard tree: atelier-looks is not beside this checkout, compared this copy only')
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
console.log(`  standard tree ok - ${checked} checks: 19 categories, 103 sub-categories, Collections, every picker`)
