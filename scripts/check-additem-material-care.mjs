// Material and care in Add Item (Cynthia Dada, 2026-11-18): "When adding an item to a closet, can you
// please include the capability to add fabric notes and washing/care instructions".
// Add Item has a Material box and a Care box with the same one-tap care chips as Edit Item (one shared
// list, lib/careChips.ts), between Description and the Internal styling note, Edit Item's order. Add to
// Collection saves both onto the piece, and a typed material carries the material-confirmed marker
// (lib/materialConfirmed.ts), as Edit Item's save does. Left empty, the piece saves as before.
// FAILS before: Add Item has no Material or Care and publish never writes either column.
import { readFileSync } from 'node:fs'
const dlg = readFileSync('src/components/layout/AddItemDialog.tsx', 'utf8')
const edit = readFileSync('src/components/layout/EditItemDialog.tsx', 'utf8')
const api = readFileSync('api/add-closet-item.ts', 'utf8')
const chips = readFileSync('src/lib/careChips.ts', 'utf8')
const fails = []
const need = (ok, m) => { if (!ok) fails.push(m) }

// One list of chips for both windows, with the 8 instructions Edit Item has always offered.
const want = ['Dry clean only', 'Hand wash cold', 'Machine wash cold', 'Lay flat to dry', 'Do not tumble dry', 'Steam, do not iron', 'Hand press only', 'Specialist clean']
const list = chips.match(/export const CARE_CHIPS = (\[[^\]]*\])/)
need(list && JSON.stringify(JSON.parse(list[1].replace(/'/g, '"'))) === JSON.stringify(want), 'lib/careChips.ts has the 8 care chips, in order')
for (const [name, src] of [['Add Item', dlg], ['Edit Item', edit]]) {
  need(/import \{ CARE_CHIPS, addCare \} from '@\/lib\/careChips'/.test(src), `${name} takes its chips from lib/careChips.ts`)
  need(!/const CARE_CHIPS\s*=/.test(src), `${name} has no copy of its own`)
  need(/CARE_CHIPS\.map/.test(src) && /setCare\(\(cur\) => addCare\(cur, c\)\)/.test(src), `${name} shows the chips and a tap adds one to Care`)
}

// The boxes, in Edit Item's order: Description, Material, Care, Internal styling note.
const at = (re) => { const m = dlg.match(re); return m ? m.index : -1 }
const order = [at(/>Description<\/label>/), at(/>Material<\/label>/), at(/>Care<\/label>/), at(/>Internal styling note<\/label>/)]
need(order.every((i) => i >= 0), 'Add Item has Description, Material, Care and Internal styling note boxes')
need(order.every((i, k) => k === 0 || i > order[k - 1]), 'Material and Care sit between Description and the Internal styling note')

// What Add to Collection sends, and what the route writes.
need(/material: material\.trim\(\)/.test(dlg) && /care: care\.trim\(\)/.test(dlg), 'Add to Collection sends the material and care she typed')
need(/withMaterialConfirmed\(/.test(dlg), 'a typed material carries the material-confirmed marker, as Edit Item\'s save does')
const pub = api.match(/async function publish[\s\S]*?\n}\n/)
need(pub, 'api/add-closet-item.ts has publish')
if (pub) {
  need(/material,\s*care,/.test(pub[0]) || /\bmaterial, care\b/.test(pub[0]), 'publish writes the material and care columns')
  need(/String\(body\.material \|\| ''\)\.trim\(\)\.slice\(0, 300\) \|\| null/.test(pub[0]), 'material is trimmed, held to Edit Item\'s 300 and empty saves null')
  need(/String\(body\.care \|\| ''\)\.trim\(\)\.slice\(0, 2000\) \|\| null/.test(pub[0]), 'care is trimmed, held to Edit Item\'s 2000 and empty saves null')
  need(!/raw: \{[^}]*\bmaterial\b/.test(pub[0]), 'raw.material stays the tag read only (never what she typed)')
}
const m = api.match(/export function editedFieldsOf[\s\S]*?\n}\n/)
const s = api.match(/export function seasonFieldsOf[\s\S]*?\n}\n/)
need(m && s, 'api/add-closet-item.ts has editedFieldsOf (and seasonFieldsOf)')
if (m && s) {
  const js = [s[0], m[0]].map((f) => f.replace(/^export /, '').replace(/\(body: any\): string\[\] \| null/, '(body)')).join('\n')
  const editedFieldsOf = new Function(`${js}; return editedFieldsOf`)()
  const eq = (a, b, what) => need(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)
  eq(editedFieldsOf({ client_edited_fields: ['season-fw', 'material-confirmed'], material: '85% wool' }), ['season-fw', 'material-confirmed'], 'a season and a typed material')
  eq(editedFieldsOf({ client_edited_fields: ['material-confirmed'], material: '100% cashmere' }), ['material-confirmed'], 'a typed material alone')
  eq(editedFieldsOf({ client_edited_fields: ['material-confirmed'], material: '   ' }), null, 'no marker without a material')
  eq(editedFieldsOf({ material: '' }), null, 'both left empty saves nothing new')
  eq(editedFieldsOf({ client_edited_fields: ['season-ss'] }), ['season-ss'], 'a season alone, as before')
  eq(editedFieldsOf({ client_edited_fields: ['name', 'home', 'care'], material: 'Silk' }), ['material-confirmed'], 'never a client-set field from the request')
}
need(/\.\.\.\(editedFields \? \{ client_edited_fields: editedFields \} : \{\}\)/.test(api), 'publish writes client_edited_fields only when there is a season or a typed material')
if (fails.length) { console.error('check-additem-material-care FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('check-additem-material-care: ok')
