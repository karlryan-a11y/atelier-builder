// @checks guard
// A Material a person entered opens filled in Edit Item (Paige Berndt, 2026-11-09: what she entered in
// Needs Review was "missing" when she went back in). FAILS before: no lib/materialConfirmed, and a
// material equal to the tag read always opened empty.
import { readFileSync, existsSync } from 'node:fs'
const LIB = 'src/lib/materialConfirmed.ts'
const fails = []
const need = (ok, m) => { if (!ok) fails.push(m) }
need(existsSync(LIB), 'src/lib/materialConfirmed.ts must exist')
if (!fails.length) {
  const js = readFileSync(LIB, 'utf8').replace(/type MaterialPiece[^\n]*\n/, '').replace(/\(item: MaterialPiece\): string/, '(item)').replace(/\(fields: string\[\] \| null \| undefined, confirmed: boolean\): string\[\] \| null/, '(fields, confirmed)').replace(/export /g, '')
  const { enteredMaterialOf, withMaterialConfirmed, MATERIAL_CONFIRMED } = new Function(js + '\nreturn { enteredMaterialOf, withMaterialConfirmed, MATERIAL_CONFIRMED }')()
  const piece = (material, read, fields) => ({ material, raw: { material: read }, client_edited_fields: fields })
  need(enteredMaterialOf(piece('Vegan leather', 'Vegan leather', [MATERIAL_CONFIRMED])) === 'Vegan leather', 'a confirmed material opens filled, even equal to the tag read')
  need(enteredMaterialOf(piece('likely a blend', 'likely a blend', null)) === '', 'an unconfirmed tag read opens empty')
  need(enteredMaterialOf(piece('Silk', 'likely a blend', null)) === 'Silk', 'a material that differs from the tag read opens filled')
  need(withMaterialConfirmed(['name'], true).join() === `name,${MATERIAL_CONFIRMED}`, 'adding the marker keeps what is there')
  need(withMaterialConfirmed([MATERIAL_CONFIRMED], false) === null, 'taking off the last marker leaves null')
  need(withMaterialConfirmed([MATERIAL_CONFIRMED, 'care'], true).filter((f) => f === MATERIAL_CONFIRMED).length === 1, 'the marker is never doubled')
}
const dialog = readFileSync('src/components/layout/EditItemDialog.tsx', 'utf8')
need(/enteredMaterialOf\(item\)/.test(dialog), 'Edit Item opens with enteredMaterialOf')
need(/'client_edited_fields' in item/.test(dialog), 'Edit Item writes the marker only when the screen loaded the column')
const col = readFileSync('src/components/categorize/CollectionTab.tsx', 'utf8')
need(/'client_edited_fields' in data \? data\.client_edited_fields/.test(col), 'Collection save starts from the marker the dialog sent')
need(/filter\(\(f\) => f !== MATERIAL_CONFIRMED\)\.map/.test(col), 'the "set by" badge leaves the marker out')
const pan = readFileSync('src/components/layout/ClosetPanel.tsx', 'utf8')
need((pan.match(/'client_edited_fields' in data/g) ?? []).length === 2, 'Canvas save writes the marker and shows it at once')
if (fails.length) { console.error('check-material-confirmed FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('check-material-confirmed: ok (6 rule cases, 3 screens)')
