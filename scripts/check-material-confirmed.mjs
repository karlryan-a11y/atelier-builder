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
  const js = readFileSync(LIB, 'utf8').replace(/type MaterialPiece[^\n]*\n/, '').replace(/\(item: MaterialPiece\): string/, '(item)').replace(/\(fields: string\[\] \| null \| undefined, confirmed: boolean\): string\[\] \| null/, '(fields, confirmed)').replace(/\(material: string, cardRead: unknown\): boolean/, '(material, cardRead)').replace(/export /g, '')
  const { enteredMaterialOf, withMaterialConfirmed, MATERIAL_CONFIRMED } = new Function(js + '\nreturn { enteredMaterialOf, withMaterialConfirmed, MATERIAL_CONFIRMED }')()
  const piece = (material, read, fields) => ({ material, raw: { material: read }, client_edited_fields: fields })
  need(enteredMaterialOf(piece('Vegan leather', 'Vegan leather', [MATERIAL_CONFIRMED])) === 'Vegan leather', 'a confirmed material opens filled, even equal to the tag read')
  need(enteredMaterialOf(piece('likely a blend', 'likely a blend', null)) === '', 'an unconfirmed tag read opens empty')
  need(enteredMaterialOf(piece('Silk', 'likely a blend', null)) === 'Silk', 'a material that differs from the tag read opens filled')
  need(withMaterialConfirmed(['name'], true).join() === `name,${MATERIAL_CONFIRMED}`, 'adding the marker keeps what is there')
  need(withMaterialConfirmed([MATERIAL_CONFIRMED], false) === null, 'taking off the last marker leaves null')
  need(withMaterialConfirmed([MATERIAL_CONFIRMED, 'care'], true).filter((f) => f === MATERIAL_CONFIRMED).length === 1, 'the marker is never doubled')
}
// The Uploads side of Needs Review: the card's Approve carries the Material a person typed.
const libText = readFileSync(LIB, 'utf8')
need(/export function typedOnCard\(/.test(libText), 'lib/materialConfirmed must export typedOnCard')
if (/export function typedOnCard\(/.test(libText)) {
  const start = libText.indexOf('export function typedOnCard')
  const body = libText.slice(start, libText.indexOf('\n}\n', start) + 2).replace('export ', '').replace(/\(material: string, cardRead: unknown\): boolean/, '(material, cardRead)')
  const typedOnCard = new Function(body + '\nreturn typedOnCard')()
  need(typedOnCard('Crepe', 'Fabric content not visible. Appears to be a matte crepe') === true, 'a Material changed from the AI read is a person\'s')
  need(typedOnCard('Silk', null) === true, 'a Material typed where the AI read nothing is a person\'s')
  need(typedOnCard(' likely a cotton blend ', 'likely a cotton blend') === false, 'a card opened in edit mode with its AI read unchanged is not')
  need(typedOnCard('', 'likely a cotton blend') === false, 'an empty box is not')
}
for (const f of ['src/components/intake/IntakeInbox.tsx', 'src/components/intake/IntakeItemDetail.tsx']) {
  const src = readFileSync(f, 'utf8')
  need(/if \(editing && typedOnCard\(material, item\.extracted_material\)\) await markUploadMaterial\(item\.id, material\)/.test(src), `${f}: Approve must leave the mark when a person typed the Material`)
}
const dialog = readFileSync('src/components/layout/EditItemDialog.tsx', 'utf8')
need(/enteredMaterialOf\(item\)/.test(dialog), 'Edit Item opens with enteredMaterialOf')
need(/'client_edited_fields' in item/.test(dialog), 'Edit Item writes the marker only when the screen loaded the column')
const col = readFileSync('src/components/categorize/CollectionTab.tsx', 'utf8')
need(/'client_edited_fields' in data \? data\.client_edited_fields/.test(col), 'Collection save starts from the marker the dialog sent')
need(/filter\(\(f\) => f !== MATERIAL_CONFIRMED\)\.(map|filter\(\(f\) => !isSeasonMarker\(f\)\)\.map)/.test(col), 'the "set by" badge leaves the marker out')
const pan = readFileSync('src/components/layout/ClosetPanel.tsx', 'utf8')
need((pan.match(/'client_edited_fields' in data/g) ?? []).length === 2, 'Canvas save writes the marker and shows it at once')
if (fails.length) { console.error('check-material-confirmed FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('check-material-confirmed: ok (6 rule cases, 3 screens)')
