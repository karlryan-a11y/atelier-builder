#!/usr/bin/env node
/**
 * EDIT ITEM CAN ADD A SUBCATEGORY UNDER THE MAIN CATEGORY (Paige Berndt for Barbie Beltran, 2026-11-12:
 * "Can there be an option when I edit an item in the VC to add a subcategory to a category? ... bag charms
 * I have under handbags but I would like to have them in the handbags category under the subcategory
 * 'Bag Charms'").
 *
 * FAILS before: the Subcategory box listed only the subcategories already in her tree, and showed only when
 * the main category had some, so nothing in Edit Item could make Bag Charms.
 *
 * Runs the real helper (transpiled) on Barbie's Handbags rows as saved on 11/12, then checks the dialog and
 * the hook use it. Exits non-zero on a break AND on inspecting nothing (ADR-0106).
 */
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ts from 'typescript'

const ROOT = process.env.CHECK_ROOT || new URL('..', import.meta.url).pathname
const failures = []
let checked = 0
const need = (ok, msg) => { checked++; if (!ok) failures.push(msg) }
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')
const done = () => {
  if (!checked) { console.error('check-new-subcategory: inspected nothing'); process.exit(1) }
  if (failures.length) { console.error('check-new-subcategory FAILED\n - ' + failures.join('\n - ')); process.exit(1) }
  console.log(`check-new-subcategory: ok (${checked} checks)`)
}

const lib = read('src/lib/categoryTreeChoices.ts')
need(/export function planNewSubcategory\(/.test(lib), 'lib/categoryTreeChoices.ts has planNewSubcategory (what "＋ New subcategory…" does to her rows)')
if (failures.length) done()

const dir = mkdtempSync(path.join(tmpdir(), 'new-sub-'))
for (const f of ['categoryTreeChoices', 'categoryNesting', 'categorize']) {
  let js = ts.transpileModule(read(`src/lib/${f}.ts`), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  js = js.replace(/from '(?:@\/lib\/|\.\/)([A-Za-z]+)(?:\.ts)?'/g, "from './$1.mjs'")
  writeFileSync(path.join(dir, f + '.mjs'), js)
}
const { planNewSubcategory, treeChoices } = await import(path.join(dir, 'categoryTreeChoices.mjs'))

// Barbie Beltran's Handbags rows on 11/12 (parent in parent_slug), plus a top-level category and a home.
const H = 'handbags-and-small-leather-goods'
const rows = [
  { slug: H, label: 'Handbags & Small Leather Goods', parent_slug: null, sort_order: 14 },
  ...['totes', 'shoulder-bags', 'crossbody-bags', 'top-handle-bags', 'clutches-and-evening-bags', 'backpacks-and-travel-bags', 'wallets-and-small-leather-goods']
    .map((slug, i) => ({ slug, label: slug.replace(/-and-/g, ' & ').replace(/-/g, ' '), parent_slug: H, sort_order: 168 + i })),
  { slug: 'shoes', label: 'Shoes', parent_slug: null, sort_order: 13 },
  { slug: 'heels', label: 'Heels', parent_slug: 'shoes', sort_order: 160 },
  { slug: 'denim', label: 'Denim', parent_slug: null, sort_order: 40 },
  { slug: 'old', label: 'Old', parent_slug: null, sort_order: 41, is_hidden: true },
]
const homes = ['race-street', 'Race Street', 'main-residence']

const first = planNewSubcategory(rows, H, '  Bag  Charms ', homes)
need(first.action === 'add' && first.slug === 'bag-charms' && first.label === 'Bag Charms', `Bag Charms under Handbags is a new row bag-charms (got ${JSON.stringify(first)})`)
const after = [...rows, { slug: 'bag-charms', label: 'Bag Charms', parent_slug: H, sort_order: 0 }]
const again = planNewSubcategory(after, H, 'bag charms', homes)
need(again.action === 'reuse' && again.slug === 'bag-charms', `typing Bag Charms again reuses it, no second one (got ${JSON.stringify(again)})`)
need(planNewSubcategory(rows, H, 'TOTES').action === 'reuse', 'a name already inside the main category is reused')
need(planNewSubcategory(rows, H, 'Heels').action === 'no', 'a subcategory inside another main category is not taken from it')
need(planNewSubcategory(rows, H, 'Shoes').action === 'no', 'a main category with subcategories is not pushed three deep')
need(planNewSubcategory(rows, H, 'Handbags & Small Leather Goods').action === 'no', 'a category cannot sit inside itself')
need(planNewSubcategory(rows, H, 'Race Street', homes).action === 'no', 'a home is never made a subcategory')
need(planNewSubcategory(rows, H, '   ').action === 'no', 'an empty name makes nothing')
need(planNewSubcategory(rows, H, 'Old').action === 'no', 'a hidden category is not quietly moved')
const nest = planNewSubcategory(rows, H, 'Denim')
need(nest.action === 'nest' && nest.slug === 'denim', `her own top-level category with nothing inside moves in (got ${JSON.stringify(nest)})`)
// A main category with nothing inside yet still takes one; so does a client with no tree at all.
need(planNewSubcategory(rows, 'jewelry', 'Bag Charms').action === 'add', 'a main category with no subcategories yet can take a new one')
need(planNewSubcategory([], 'bags', 'Bag Charms').action === 'add', 'a client with no tree can add her first subcategory')
// Once made, the picker lists it under Handbags.
const t = treeChoices(after, { mine: [], more: [] }, homes)
need(t && t.mainOf.get('bag-charms') === H && (t.subsOf.get(H) ?? []).some((c) => c.label === 'Bag Charms'), 'Bag Charms is then there to pick under Handbags')

// The hook writes it the way her tree is read (both spellings of the parent), and asks for the row back.
const hook = read('src/hooks/useClientCategories.ts')
need(/addSubcategory = useCallback/.test(hook) && /planNewSubcategory\(rows, main, name, homes\)/.test(hook), 'useClientCategories.addSubcategory follows planNewSubcategory')
need(/group_label: parent, parent_slug: parent/.test(hook), 'a new subcategory saves its parent in group_label AND parent_slug')
const addSub = hook.slice(hook.indexOf('const addSubcategory'))
need(/\.select\('slug'\)/.test(addSub) && /saved nothing/.test(addSub), 'a refused write is not read as a success')
need(/addEventListener\(CHANGED/.test(hook) && /dispatchEvent\(new CustomEvent\(CHANGED/.test(hook), 'the other screens (her Collection rail) read her tree again after a subcategory is made')

// The dialog: the option shows under every main category, even one with nothing inside it, and for a flat client.
const dialog = read('src/components/layout/EditItemDialog.tsx')
need(/＋ New subcategory…/.test(dialog), 'Edit Item offers "＋ New subcategory…"')
need(!/treeSubs\.length > 0 &&/.test(dialog), 'the Subcategory box no longer hides when the main category has no subcategories')
need(/subBox\(treeSubs, treeSub\)/.test(dialog) && /subBox\(\[\], ''\)/.test(dialog), 'the Subcategory box shows for a client with a tree and one without')
need(/await addSubcategory\(subParent, subName, allHomes\)/.test(dialog) && /finalCategory = made\.slug/.test(dialog), 'Save makes the subcategory first, then files the piece under it')
need(/if \(!made\.ok\) \{ alert\(made\.message\); return \}/.test(dialog), 'a subcategory that cannot be made stops the save and says why')

done()
