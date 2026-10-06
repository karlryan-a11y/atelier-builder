#!/usr/bin/env node
/**
 * ADR-0164. IS THIS PIECE ALREADY IN HER CLOSET?
 *
 * 2026-09-24: Cynthia searched Peyton Wheeler's closet for "margaret satin sheath midi", found
 * nothing, and added "Margaret Satin Sheath Midi Shirt Dress" (Lena Hoschek). The closet already had
 * "Floral Margaret Satin Sheath Belted Shirt Dress" (Lena Hoschek). A guard was promised that day
 * and not built until 2026-10-06.
 *
 * Measured before the rule was settled, every piece against its own closet (88,819 pieces): built on
 * search's synonyms it flagged 22.3%; on exact words, colour and garment type, 12.1%, of which 5,150
 * pieces carry a name identical to another piece in the same closet.
 *
 * Guards: the rule itself (the real file, bundled), and both places a piece is added use it and make
 * the stylist click once more before adding a possible duplicate. Exits non-zero on failure and on
 * inspecting nothing (ADR-0106).
 */
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ts from 'typescript'

const ROOT = new URL('..', import.meta.url).pathname
const problems = []
const fail = (m) => { problems.push(m); console.error(`   ❌ ${m}`) }
let checks = 0

// Load the REAL rule: compile it and the three files it needs, rewriting '@/lib/x' and './x'.
const dir = mkdtempSync(path.join(tmpdir(), 'dupe-'))
for (const f of ['duplicateCheck', 'pieceSearch', 'categorize', 'categoryNesting']) {
  const src = readFileSync(path.join(ROOT, 'src/lib', f + '.ts'), 'utf8')
  let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  js = js.replace(/from '(?:@\/lib\/|\.\/)([A-Za-z]+)(?:\.ts)?'/g, "from './$1.mjs'")
  writeFileSync(path.join(dir, f + '.mjs'), js)
}
const { possibleDuplicates } = await import(path.join(dir, 'duplicateCheck.mjs'))
const piece = (name, brand = null) => ({ id: name, name, name_override: null, brand, is_deleted: false })

const CASES = [
  // [new name, new brand, closet, should warn]
  ['Margaret Satin Sheath Midi Shirt Dress', 'Lena Hoschek', [piece('Floral Margaret Satin Sheath Belted Shirt Dress', 'Lena Hoschek')], true],
  ['Faux Fur Slide Sandals', null, [piece('Faux Fur Slide Sandal', 'PESERICO')], true],
  ['Ribbed Wool Turtleneck Sweater', 'Lena Hoschek', [piece('Ribbed Wool Turtleneck Sweater', 'Lena Hoschek')], true],
  // not the same piece
  ['Shaping Cami White', 'Soma', [piece('Shaping Cami Black', 'Soma')], false],
  ['Balani Custom Suit Jacket Grey', null, [piece('Balani Custom Suit Pant Grey')], false],
  ['Blue Check Gingham Cotton Midi Skirt', 'Lena Hoschek', [piece('Plaid Cotton Embroidered Midi Skirt', 'Lena Hoschek')], false],
  ['Wool Midi Skirt', 'Lena Hoschek', [piece('Wool A-Line Belted Midi Skirt', 'Lena Hoschek')], false],
  ['Black Wool Coat', 'Max Mara', [piece('Black Wool Coat', 'Theory')], false],
  ['Black Top', null, [piece('Black Top')], false],
  ['Margaret Satin Sheath Midi Shirt Dress', 'Lena Hoschek', [{ ...piece('Floral Margaret Satin Sheath Belted Shirt Dress', 'Lena Hoschek'), is_deleted: true }], false],
]
let ran = 0
for (const [name, brand, closet, expect] of CASES) {
  ran++
  const got = possibleDuplicates({ name, brand }, closet).length > 0
  if (got !== expect) fail(`"${name}" against "${closet[0].name}": expected ${expect ? 'a warning' : 'no warning'}, got ${got ? 'a warning' : 'none'}`)
}

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')
for (const [rel, button] of [['src/components/layout/AddItemDialog.tsx', 'Add anyway'], ['src/components/intake/IntakeInbox.tsx', 'Approve anyway']]) {
  const src = read(rel)
  checks++
  if (!/possibleDuplicates\(/.test(src)) fail(`${rel}: adds a piece without checking her closet for it (ADR-0164).`)
  checks++
  if (!/if \(dupes\.length && !dupeConfirmed\) \{ setDupeConfirmed\(true\); return \}/.test(src)) fail(`${rel}: a possible duplicate is added on the first click, with no chance to look.`)
  checks++
  if (!src.includes(button)) fail(`${rel}: the button never says "${button}", so the extra click is not visible.`)
}
checks++
if (!/bulkDupes/.test(read('src/components/intake/IntakeInbox.tsx'))) fail('IntakeInbox.tsx: Approve All does not warn about pieces already in her closet.')

console.log(`check-duplicate-warning: ${ran} case(s), ${checks} source rule(s)`)
if (!ran || !checks) { console.error('❌ inspected nothing'); process.exit(1) }
if (problems.length) { console.error(`❌ duplicate-warning: ${problems.length} failure(s)`); process.exit(1) }
console.log('✅ duplicate-warning: her closet is checked before a piece is added, on both paths.')
