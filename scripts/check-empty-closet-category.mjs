#!/usr/bin/env node
// @checks build guard
/**
 * A COLLECTION CATEGORY WITH NO PIECES IN IT YET (Cynthia Dada, #watson-atelier, 2026-10-20):
 * "Can you make a way to add categories without adding items to it? Like how you can add
 * categories in looks."
 *
 * FAILS before: Collection categories came only from the pieces (`category` and
 * `custom_categories`), so a category nobody had filed a piece under could not exist. The New
 * category box at the bottom of the rail was hidden on the Collection tab.
 *
 * Now a category typed into that box is saved as a `client_categories` row of kind 'custom'. The
 * rail lists it at 0 pieces, and Set category, Also add to, Add Item and Edit Item offer it. Her
 * site is unchanged: it builds its chips from piece counts and drops anything at zero.
 *
 * Runs the real helpers (transpiled), then checks both screens use them. Exits non-zero on a break
 * AND on inspecting nothing (ADR-0106).
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

const dir = mkdtempSync(path.join(tmpdir(), 'empty-cat-'))
for (const f of ['savedClosetCategories', 'categorize']) {
  let src
  try { src = read(`src/lib/${f}.ts`) } catch { failures.push(`src/lib/${f}.ts is missing`); continue }
  let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  js = js.replace(/from '(?:@\/lib\/|\.\/)([A-Za-z]+)(?:\.ts)?'/g, "from './$1.mjs'")
  writeFileSync(path.join(dir, f + '.mjs'), js)
}

if (failures.length === 0) {
  const { savedCustomCategories, withSavedCategories, customRailSlugs } = await import(path.join(dir, 'savedClosetCategories.mjs'))
  const rows = [
    { slug: 'wide-leg-jeans', label: 'Wide Leg Jeans', kind: 'custom', same_as: null, is_hidden: false },
    { slug: 'gym', label: 'Gym', kind: 'custom', same_as: null, is_hidden: true },
    { slug: 'handbags', label: 'handbags', kind: 'garment', same_as: 'bags', is_hidden: false },
    { slug: 'jackets', label: 'Jackets', kind: 'garment', parent_slug: 'outerwear', same_as: null, is_hidden: false },
    { slug: 'bottoms', label: 'Bottoms', kind: 'garment', same_as: null, is_hidden: false },
    { slug: 'dresses', label: 'Dresses', kind: 'custom', same_as: null, is_hidden: false },
  ]
  const saved = savedCustomCategories(rows)
  need(saved.length === 1 && saved[0].slug === 'wide-leg-jeans' && saved[0].label === 'Wide Leg Jeans',
    `only her own new, visible, non-standard categories are saved ones; got ${JSON.stringify(saved)}`)

  const fromItems = [{ slug: '49ers', label: '49ers' }, { slug: 'wide-leg-jeans', label: 'Wide-leg jeans' }]
  const merged = withSavedCategories(fromItems, saved)
  need(merged.map((c) => c.slug).join(',') === '49ers,wide-leg-jeans', `a saved category with pieces is listed once; got ${JSON.stringify(merged)}`)
  need(merged[1].label === 'Wide Leg Jeans', 'a saved category keeps the name she typed, as the rail shows it')
  need(withSavedCategories([{ slug: '49ers', label: '49ers' }], saved).some((c) => c.slug === 'wide-leg-jeans'),
    'an empty saved category is offered in the pickers')
  need(withSavedCategories(fromItems, []) === fromItems, 'with nothing saved the pickers get exactly the list they got before')

  const counts = new Map([['__total__', 5], ['tops', 3], ['49ers', 2], ['creekside', 4], ['zero-left', 0]])
  const notHome = (s) => s !== 'creekside'
  need(customRailSlugs(counts, [], notHome).join(',') === '49ers', 'with nothing saved the Custom rail is what it was')
  need(customRailSlugs(counts, ['wide-leg-jeans'], notHome).join(',') === '49ers,wide-leg-jeans', 'an empty saved category shows in the rail')
  need(customRailSlugs(counts, ['49ers'], notHome).join(',') === '49ers', 'a saved category with pieces is listed once')
  need(customRailSlugs(counts, ['creekside'], notHome).join(',') === '49ers', 'a home stays out of Custom')
}

const panel = read('src/components/categorize/CategorizePanel.tsx')
const tab = read('src/components/categorize/CollectionTab.tsx')
const hook = read('src/hooks/useClientCategories.ts')
need(/mode === 'collection' && \(\s*<div data-new-closet-category/.test(panel), 'the Collection tab shows a New category box at the bottom of the rail')
need(/onKeyDown=\{\(e\) => e\.key === 'Enter' && handleCreateClosetCategory\(\)\}/.test(panel) && /onClick=\{handleCreateClosetCategory\}/.test(panel), 'Enter and + both save the new category')
need(/customRailSlugs\(/.test(panel), 'the Collection rail lists her saved categories')
need(/createSavedCategory/.test(hook) && /kind: 'custom'/.test(hook), 'the hook saves a new collection category as kind custom')
need(/withSavedCategories\(/.test(tab), 'the Collection pickers offer her saved categories')
need(!/customCategories=\{customCats\}/.test(tab) || /const customCats = useMemo\(\(\) => withSavedCategories/.test(tab), 'Add Item and Edit Item get the saved categories too')

if (checked === 0) { console.error('check-empty-closet-category: inspected nothing'); process.exit(1) }
if (failures.length) { console.error('check-empty-closet-category FAILED:\n  ' + failures.join('\n  ')); process.exit(1) }
console.log(`check-empty-closet-category OK (${checked} checks)`)
