#!/usr/bin/env node
// @checks guard
/**
 * EDIT ITEM PICKS ONE OF HER MAIN CATEGORIES, THEN A SUBCATEGORY INSIDE IT (Paige Berndt for Barbie
 * Beltran, 2026-11-11: "we need all categories to be visible and selectable in the category dropdown
 * when editing an item. Ideally, we would be able to select a main category and then choose a
 * subcategory within it.")
 *
 * FAILS before: Barbie's tree (20 main categories, 111 subcategories) is stored in client_categories
 * .parent_slug, which nothing read, so Edit Item showed one flat list of 45 that had no Tops & Blouses
 * and offered her homes (Main Residence, Race Street) as garment types.
 *
 * Runs the real helper (transpiled) on her tree as saved, then checks the readers and the screens use it.
 * Exits non-zero on a break AND on inspecting nothing (ADR-0106).
 */
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ts from 'typescript'

const ROOT = new URL('..', import.meta.url).pathname
const failures = []
let checked = 0
const need = (ok, msg) => { checked++; if (!ok) failures.push(msg) }
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')

need(existsSync(path.join(ROOT, 'src/lib/categoryTreeChoices.ts')), 'src/lib/categoryTreeChoices.ts (the two-step picker) exists')
if (failures.length) { console.error('check-category-tree-picker FAILED\n - ' + failures.join('\n - ')); process.exit(1) }

const dir = mkdtempSync(path.join(tmpdir(), 'tree-pick-'))
for (const f of ['categoryTreeChoices', 'categoryNesting', 'categorize']) {
  let js = ts.transpileModule(read(`src/lib/${f}.ts`), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  js = js.replace(/from '(?:@\/lib\/|\.\/)([A-Za-z]+)(?:\.ts)?'/g, "from './$1.mjs'")
  writeFileSync(path.join(dir, f + '.mjs'), js)
}
const { treeChoices } = await import(path.join(dir, 'categoryTreeChoices.mjs'))

// Barbie Beltran's tree as saved on 2026-11-11 (parent in parent_slug, group_label empty), main -> its subcategories.
const TREE = {
  'blazers-and-tailored-jackets': ['blazers', 'suit-jackets', 'evening-and-formal-jackets', 'other-tailored-jackets', 'tailored-vests-waistcoats'],
  'suits-and-matching-sets': ['pant-suits', 'skirt-suits', 'dress-suits', 'matching-sets'],
  dresses: ['day-dresses', 'work-and-professional-dresses', 'cocktail-dresses', 'evening-and-formal-gowns', 'shirt-dresses', 'knit-dresses', 'specialty-dresses'],
  skirts: ['mini-skirts', 'midi-skirts', 'maxi-skirts'],
  'pants-and-jeans': ['tailored-trousers', 'casual-pants', 'chinos', 'jeans', 'leggings'],
  'tops-and-blouses': ['blouses-and-dressy-tops', 'button-front-shirts', 't-shirts', 'tank-tops-and-camisoles', 'bodysuits', 'polo-shirts', 'overshirts'],
  'sweaters-and-knitwear': ['pullover-sweaters', 'turtlenecks-and-mock-necks', 'cardigans', 'zip-sweaters', 'sweater-vests', 'knit-tops'],
  outerwear: ['coats', 'jackets', 'vests', 'capes-and-specialty-outerwear'],
  shorts: ['tailored-shorts', 'casual-shorts', 'denim-shorts'],
  athletic: ['performance-tops', 'performance-bottoms', 'training-shorts', 'sports-bras', 'compression-and-base-layers', 'sport-specific-apparel'],
  athleisure: ['sweatshirts-and-hoodies', 'joggers-and-sweatpants', 'casual-leggings', 'track-jackets-and-pants', 'matching-lounge-sets'],
  swimwear: ['one-piece-swimsuits', 'bikinis', 'tankinis-and-swim-separates', 'rash-guards'],
  shoes: ['heels', 'flats', 'loafers', 'sneakers', 'boots-and-booties', 'sandals-and-slides', 'espadrilles-and-wedges', 'performance-shoes', 'slippers'],
  'handbags-and-small-leather-goods': ['totes', 'shoulder-bags', 'crossbody-bags', 'top-handle-bags', 'clutches-and-evening-bags', 'backpacks-and-travel-bags', 'wallets-and-small-leather-goods'],
  belts: ['dress-belts', 'casual-belts', 'statement-belts', 'waist-and-corset-belts'],
  accessories: ['scarves-and-shawls', 'hats', 'gloves', 'sunglasses-and-eyewear', 'hair-accessories', 'other-accessories'],
  'lingerie-hosiery-and-sleepwear': ['bras', 'underwear', 'shapewear', 'slips-and-camisoles', 'tights-and-hosiery', 'socks', 'pajamas-and-robes'],
  'jewelry-and-timepieces': ['watches', 'earrings', 'necklaces-and-pendants', 'bracelets', 'rings', 'brooches-and-pins', 'other-jewelry'],
  'specialty-garments': ['bridal-and-wedding-attire', 'traditional-and-cultural-clothing', 'costume-and-theme-clothing', 'other-specialty-clothing'],
  collections: ['eveningwear', 'resort-and-beach', 'golf', 'tennis', 'fur-and-shearling', 'ski-and-snow', 'travel', 'workwear'],
}
const title = (s) => s.replace(/-and-/g, ' & ').replace(/-/g, ' ').replace(/(^|\s)(\w)/g, (_m, p, c) => p + c.toUpperCase())
const rows = []
let n = 0
for (const [main, subs] of Object.entries(TREE)) {
  rows.push({ slug: main, label: title(main), parent_slug: null, sort_order: ++n })
  for (const s of subs) rows.push({ slug: s, label: title(s), parent_slug: main, sort_order: 100 + ++n })
}
rows.find((r) => r.slug === 't-shirts').label = 'T-Shirts'
// What her single list offered on live (11/11): pieces' categories, her homes among them, and the standard ones.
const single = {
  mine: ['activewear', 'denim', 'main-residence', 'race-street', 'thermal', 'the-four-seasons', 't-shirts', 'eveningwear', 'knitwear-and-sweaters'].map((slug) => ({ slug, label: title(slug) })),
  more: [{ slug: 'tops', label: 'Tops' }, { slug: 'bags', label: 'Handbags' }],
}
const homes = ['the-four-seasons', 'Montana', 'main-residence', 'Race Street', 'storage', 'Storage', 'thermal', 'Thermal']

const t = treeChoices(rows, single, homes)
need(!!t, 'her tree gives the two-step picker')
if (t) {
  need(t.mains.length === 20, `all 20 of her main categories are offered first (got ${t.mains.length})`)
  need(t.mains[5]?.label === 'Tops & Blouses', `Tops & Blouses is in her order, sixth (got ${t.mains[5]?.label})`)
  const subs = (t.subsOf.get('tops-and-blouses') ?? []).map((c) => c.label)
  need(subs.length === 7 && subs[2] === 'T-Shirts', `Tops & Blouses opens its 7 subcategories with T-Shirts third (got ${subs.join(', ')})`)
  need([...t.subsOf.values()].reduce((a, l) => a + l.length, 0) === 111, 'all 111 subcategories sit under a main category')
  need(t.mainOf.get('t-shirts') === 'tops-and-blouses', 'a T-Shirts piece opens on Tops & Blouses > T-Shirts')
  const offered = [...t.mains, ...t.others].map((c) => c.slug)
  for (const h of ['main-residence', 'race-street', 'thermal', 'the-four-seasons']) need(!offered.includes(h), `the home ${h} is not offered as a category`)
  need(!offered.includes('t-shirts') && !offered.includes('eveningwear'), 'a subcategory is not also a main choice')
  need(offered.includes('activewear') && offered.includes('tops') && offered.includes('denim'), 'every other category is still offered under More categories')
}
// A client with no tree keeps the single list.
need(treeChoices([{ slug: 'knitwear', label: 'Knitwear', parent_slug: null, sort_order: 0 }], single, homes) === null, 'a client with no nesting keeps today\'s single list')
// A hidden category or a Same as row does not nest.
need(treeChoices([{ slug: 'x', label: 'X', parent_slug: 'y', sort_order: 0, is_hidden: true }], single) === null, 'a hidden category nests nothing')

// The readers: her parent_slug is read in the builder and on her lookbook, the same way.
const hook = read('src/hooks/useClientCategories.ts')
need(/parent_slug'\)/.test(hook) && /parent_slug: parentOfRow\(r\)/.test(hook), 'useClientCategories reads a parent from group_label or parent_slug')
need(/group_label: next,\s*\/\/[^\n]*\n\s*parent_slug: next/.test(hook), 'moving a category in Nesting writes both spellings, so the old one cannot put it back')
const looks = path.join(ROOT, '../atelier-looks/src/lib/queries.ts')
if (existsSync(looks)) need(/r\.parent_slug/.test(readFileSync(looks, 'utf8')), 'atelier-looks getClientCategories reads parent_slug too (the twin)')
// The screens.
const dialog = read('src/components/layout/EditItemDialog.tsx')
need(/treeChoices\(/.test(dialog) && /aria-label="Subcategory"/.test(dialog), 'Edit Item shows Category then Subcategory from her tree')
// The canvas closet opens Edit Item with no residenceSlugs (judge, 2026-11-12: Main Residence, Race Street, Thermal and
// The Four Seasons were offered on Barbie there), so the dialog reads her homes itself and hands them to treeChoices.
need(/from\('look_categories'\)[^\n]*\.eq\('is_residence', true\)/.test(dialog) && /treeChoices\(treeRows, split, \[\.\.\.homes/.test(dialog), 'Edit Item reads her homes itself, whichever screen opened it')
const inbox = read('src/components/intake/IntakeInbox.tsx')
need(/aria-label="Subcategory"/.test(inbox), 'Needs Review > Uploads picks main category then subcategory')
need(/fileUploadCategory\(item\.id/.test(inbox), 'Needs Review > Uploads Approve files the piece under the card\'s category')

if (!checked) { console.error('check-category-tree-picker: inspected nothing'); process.exit(1) }
if (failures.length) { console.error('check-category-tree-picker FAILED\n - ' + failures.join('\n - ')); process.exit(1) }
console.log(`check-category-tree-picker: ok (${checked} checks)`)
