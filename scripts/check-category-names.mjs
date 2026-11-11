// A stylist renames any closet category for one client from Categorize > Nesting (Cynthia Dada for
// Peyton Wheeler, 11/11), and the new name shows everywhere that client's categories are listed:
// the Nesting cards and chips, the Collection rail and cards, the canvas closet, the category
// pickers, and her lookbook. FAILS before: no rename in Nesting, and every surface used the
// standard name only.
// The builder writes gp_clients.raw.category_names; atelier-looks reads it with its own twin, so the
// key, the tidy-up and the read must match on both sides or her saved name silently never shows.
import { readFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const fails = []
const need = (ok, m) => { if (!ok) fails.push(m) }
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

const libPath = 'src/lib/categoryNames.ts'
const twinPath = '../atelier-looks/src/lib/categoryNames.ts'
need(existsSync(libPath), 'src/lib/categoryNames.ts is missing')
const lib = existsSync(libPath) ? await import(pathToFileURL(path.resolve(libPath)).href) : null
const twin = existsSync(twinPath) ? await import(pathToFileURL(path.resolve(twinPath)).href) : null // a checkout without the lookbook beside it skips the twin

if (lib) {
  const raw = { custom_heading: 'Bags', other: 1 }
  const one = lib.withCategoryName(raw, 'blazers-tailored-jackets', '  Blazers   & Suiting ', 'Blazers & Tailored Jackets')
  need(one?.category_names?.['blazers-tailored-jackets'] === 'Blazers & Suiting', 'a rename is saved, tidied, under the category')
  need(one?.custom_heading === 'Bags' && one?.other === 1, 'a rename keeps everything else in raw')
  need(raw.category_names === undefined, 'a rename does not change the raw it was given')
  const two = lib.withCategoryName(one, 'Jackets', 'Coats & Jackets', 'Jackets')
  need(two?.category_names?.jackets === 'Coats & Jackets' && two?.category_names?.['blazers-tailored-jackets'] === 'Blazers & Suiting', 'a second rename keeps the first')
  need(lib.withCategoryName(two, 'jackets', '', 'Jackets') === null, 'an empty name is refused')
  need(lib.withCategoryName(two, 'jackets', '    ', 'Jackets') === null, 'a name of only spaces is refused')
  const back = lib.withCategoryName(two, 'jackets', 'Jackets', 'Jackets')
  need(back && !('jackets' in back.category_names), 'typing the name it had takes the saved name off')
  const none = lib.withCategoryName(back, 'blazers-tailored-jackets', 'Blazers & Tailored Jackets', 'Blazers & Tailored Jackets')
  need(none && !('category_names' in none), 'with no names left the key comes off raw')
  const names = lib.categoryNamesOf(two)
  need(lib.nameForCategory('jackets', names, 'Jackets') === 'Coats & Jackets', 'a saved name is what she reads')
  need(lib.nameForCategory('coats', names, 'Coats') === 'Coats', 'a category with no saved name keeps its name')
  need(lib.nameForCategory('jackets', lib.categoryNamesOf({}), 'Jackets') === 'Jackets', 'a client with no names reads as before')
  need(lib.categoryNamesOf({ category_names: { jackets: '   ' } }).jackets === undefined, 'a blank saved name is ignored')
  need(lib.cleanCategoryName('x'.repeat(80)).length === lib.CATEGORY_NAME_MAX, 'a long name is capped')
  if (twin) {
    for (const r of [two, { category_names: { 'Blazers & Tailored Jackets': ' A  b ', jeans: '', 'é-x': 'Y' } }, {}, null, { category_names: 'no' }]) {
      need(JSON.stringify(twin.categoryNamesOf(r)) === JSON.stringify(lib.categoryNamesOf(r)), 'atelier-looks reads saved names differently: keep lib/categoryNames.ts the same on both sides')
    }
    need(twin.CATEGORY_NAME_MAX === lib.CATEGORY_NAME_MAX, 'atelier-looks caps the name at a different length')
    need(twin.cleanCategoryName(' a   b ') === lib.cleanCategoryName(' a   b '), 'atelier-looks tidies a name differently')
  }
}

// The key must be the same one the nesting tree uses, or a renamed "Blazers & Tailored Jackets" row misses.
const nesting = await import(pathToFileURL(path.resolve('src/lib/categoryNesting.ts')).href)
if (lib) {
  for (const s of ['blazers-tailored-jackets', 'Blazers & Tailored Jackets', ' Brassières ', 'jeans', 's/s', '', null]) {
    need(nesting.categoryKey(s) === lib.categoryNameKey(s), `categoryNameKey must match categoryKey in lib/categoryNesting.ts (${s})`)
  }
}

// Builder: the rename is in Nesting, and every surface listing her closet categories reads her names.
const hook = read('src/hooks/useCategoryNames.ts')
need(/withCategoryName\(/.test(hook) && /\.select\('raw'\)/.test(hook), 'the save reads raw fresh and asks for the row back')
const editor = read('src/components/categorize/NestingEditor.tsx')
need(/rename\b/.test(editor) && /aria-label=\{`Rename /.test(editor), 'Nesting has a rename box on its headings and chips')
const tab = read('src/components/categorize/NestingTab.tsx')
need(/useCategoryNames\(clientId\)/.test(tab), 'Nesting reads her names')
const panel = read('src/components/categorize/CategorizePanel.tsx')
need(/useCategoryNames\(/.test(panel) && !/label=\{CATEGORY_LABELS\[slug\]\}/.test(panel), 'the Collection rail shows her names, not the standard ones')
const coll = read('src/components/categorize/CollectionTab.tsx')
need(/useCategoryNames\(clientId\)/.test(coll) && !/\{labelForCategory\(primaryCategoryByItem/.test(coll), 'Collection cards and pickers show her names')
const closet = read('src/components/layout/ClosetPanel.tsx')
need(/useCategoryNames\(/.test(closet) && !/home \?\? labelForCategory\(slug\)/.test(closet), 'the canvas closet shows her names')
const opts = read('src/components/common/CategoryOptions.tsx')
need(/names/.test(opts), 'the category pickers show her names for the standard categories')

// Lookbook: the Collection sidebar, its heading and its search read her names.
const page = read('../atelier-looks/src/pages/[microsite]/closet.astro')
if (page) {
  need(/categoryNamesOf\(client\.raw\)/.test(page), 'her lookbook Collection reads raw.category_names')
  need(!/label: CATEGORY_LABELS\[slug\], count/.test(page), 'her lookbook sidebar shows her names for the standard categories too')
}

if (fails.length) { console.error('check-category-names FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('check-category-names: ok' + (twin ? ' (twin checked)' : '') + (page ? ' (lookbook checked)' : ''))
