// @checks build
// Metallic is a colour a stylist can pick (Cynthia Dada for Peyton Wheeler, 11/19): it is for pieces
// with a metallic thread, the team tags them by hand, and the client's closet gets a Metallic chip.
// Gold and Silver stay as they are, so nothing automatic may ever file a piece under Metallic: the
// word list (colorText.ts) keeps "metallic" as Silver, and Add Item's photo read is never offered it.
// FAILS before: Metallic is not in the palette.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COLOR_ORDER, COLOR_SWATCH, PICKED_ONLY } from '../src/lib/colorFamily.ts'
import { translateColorText } from '../src/lib/colorText.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const fails = []
const need = (ok, m) => { if (!ok) fails.push(m) }

const order = [...COLOR_ORDER]
need(order.includes('Metallic'), 'Metallic is not in the palette, so a stylist cannot pick it')
need(order.indexOf('Metallic') === order.indexOf('Silver') + 1, 'Metallic sits right after Silver')
need(order.includes('Gold') && order.includes('Silver'), 'Gold and Silver are still in the palette')
need(!!COLOR_SWATCH?.Metallic, 'Metallic has its own swatch')
need(PICKED_ONLY instanceof Set && PICKED_ONLY.has('Metallic'), 'Metallic is marked as picked by a stylist only')

// The word list answers exactly as before: "metallic" is Silver, and nothing ever becomes Metallic.
const words = ['metallic', 'Metallic', 'metallic thread', 'silver metallic', 'gold metallic', 'metallic gold',
  'black with metallic thread', 'bronze', 'gold', 'silver']
for (const w of words) need(!translateColorText(w).includes('Metallic'), `"${w}" is filed as Metallic by the word list`)
need(translateColorText('metallic').join('|') === 'Silver', '"metallic" still reads as Silver')
need(translateColorText('gold').join('|') === 'Gold', '"gold" still reads as Gold')

// Add Item: the palette copy agrees (check-color-set-surfaces) and the photo read is never offered Metallic.
const api = read('api/add-closet-item.ts')
need(/const AUTO_COLORS = COLOR_ORDER\.filter\(\(c\) => c !== 'Metallic'\)/.test(api), 'Add Item photo read has no AUTO_COLORS list without Metallic')
need(/COLOR_ORDER\.join\(', '\)/.test(api) === false, 'Add Item still offers the whole palette (with Metallic) to the photo read')
need(/AUTO_COLORS\.includes\(c\)/.test(api), 'Add Item keeps only AUTO_COLORS from the photo read')

// The lookbook shows the same palette in the same order (its chips and her Edit details picker).
const looks = [path.join(root, '../atelier-looks/src/lib/colorFamily.ts')].find((p) => fs.existsSync(p))
if (looks) {
  const m = fs.readFileSync(looks, 'utf8').match(/COLOR_ORDER\s*=\s*\[([\s\S]*?)\]/)
  const lp = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : []
  need(lp.join('|') === order.join('|'), `the lookbook palette differs: ${lp.join(', ')}`)
}

if (fails.length) {
  console.error('check-metallic-color FAILED:\n  • ' + fails.join('\n  • '))
  process.exit(1)
}
console.log(`check-metallic-color: Metallic is pickable, never automatic, ${words.length} words still file as before${looks ? ', lookbook palette matches' : ''}`)
