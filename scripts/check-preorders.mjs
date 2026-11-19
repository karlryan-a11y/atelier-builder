#!/usr/bin/env node
// @checks build
/**
 * PRE-ORDERS. Cynthia Dada, 2026-11-19: "a way to add preorder items with pricing, photos and
 * description into a client's atelier without adding it to their closet ... A separate tab from
 * collection." Keep moves it into her Collection with one tap; Return takes it off Pre-orders.
 *
 * Checked:
 *   1. A new pre-order is a HIDDEN piece row (is_deleted, deleted_reason 'preorder') with its
 *      photos, price and description, so no Collection, look or capsule read can show it.
 *   2. Keep brings the same row out of hiding with the same photos, price and description; Return
 *      leaves it hidden as 'preorder-returned' and keeps the record. Neither touches other raw keys.
 *   3. Keep and Return only ever change a WAITING pre-order of this client, and ask for the row back.
 *   4. The hidden-pieces list (Review) leaves pre-orders out, so Restore can't slip one into her
 *      Collection; the builder Collection still reads is_deleted = false only.
 *   5. Categorize has the Pre-orders tab.
 *   6. The twin in atelier-looks names the same reasons and reads photos the same way.
 *
 * Fails before this commit: lib/preorders.ts, the hook and the tab did not exist.
 * Exits non-zero on failure and on inspecting nothing (ADR-0106).
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const src = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')
let n = 0
const problems = []
const assert = (name, ok) => { n += 1; if (!ok) { problems.push(name); console.error(`   ❌ ${name}`) } }

if (!existsSync(resolve(ROOT, 'src/lib/preorders.ts'))) {
  console.error('check-preorders: src/lib/preorders.ts is missing')
  process.exit(1)
}
const P = await import('../src/lib/preorders.ts')

// 1. A new pre-order
const at = '2026-11-19T17:00:00.000Z'
const row = P.newPreorderRow({
  id: 'p1', clientId: 'c1', name: '  Wool wrap coat ', brand: 'Max Mara', price: '1,250',
  description: 'Camel, belted.', category: 'Outerwear', photoKeys: ['k1', 'k2', 'k1', ''], by: 'cynthia@x', at,
})
assert('a new pre-order is hidden', row.is_deleted === true)
assert('a new pre-order is marked waiting', row.deleted_reason === P.PREORDER_WAITING)
assert('its name, price and description are on the row', row.name === 'Wool wrap coat' && row.price === '1,250' && row.description === 'Camel, belted.')
assert('its first photo is the main photo', row.primary_image_hash === 'k1' && row.source === 'intake_pipeline')
assert('every photo is kept once, in order', JSON.stringify(row.raw.preorder.photos) === '["k1","k2"]')
assert('its category is a slug', row.category === 'outerwear')
let threw = 0
for (const bad of [{ name: '' }, { photoKeys: [] }, { clientId: '' }]) {
  try { P.newPreorderRow({ id: 'x', clientId: 'c1', name: 'n', photoKeys: ['k'], at, ...bad }) } catch { threw++ }
}
assert('no name, no photo or no client is refused', threw === 3)
assert('photos read back main first', JSON.stringify(P.preorderPhotoKeys(row)) === '["k1","k2"]')

// 2. Keep and Return
const raw = { ...row.raw, shortlist_like: 1 }
const kept = P.keepPatch(raw, '2026-11-20T10:00:00.000Z', 'paige@x')
assert('Keep brings it out of hiding', kept.is_deleted === false && kept.deleted_reason === null)
assert('Keep keeps every photo and the other raw keys', JSON.stringify(kept.raw.preorder.photos) === '["k1","k2"]' && kept.raw.shortlist_like === 1)
assert('Keep marks it kept, with when and who', kept.raw.preorder.status === 'kept' && kept.raw.preorder.kept_at === '2026-11-20T10:00:00.000Z' && kept.raw.preorder.kept_by === 'paige@x')
assert('Keep does not touch the price, description or photo columns', !('price' in kept) && !('description' in kept) && !('primary_image_hash' in kept) && !('name' in kept))
const back = P.returnPatch(raw, '2026-11-20T10:00:00.000Z', 'paige@x')
assert('Return keeps it hidden', !('is_deleted' in back) && back.deleted_reason === P.PREORDER_RETURNED)
assert('Return marks it returned and keeps the record', back.raw.preorder.status === 'returned' && back.raw.preorder.photos.length === 2)
assert('a bare price reads with a dollar sign', P.shownPrice('1,250') === '$1,250' && P.shownPrice('$980') === '$980' && P.shownPrice(' ') === null && P.shownPrice('EUR 400') === 'EUR 400')

// 3. The writes
const hook = src('src/hooks/usePreorders.ts')
const decide = hook.slice(hook.indexOf('const decide'), hook.indexOf('const keep ='))
assert('Keep/Return filter on this client', /\.eq\('client_id', clientId\)/.test(decide))
assert('Keep/Return only change a waiting pre-order', /\.eq\('is_deleted', true\)\.eq\('deleted_reason', PREORDER_WAITING\)/.test(decide))
assert('Keep/Return ask for the row back', /\.select\('id'\)/.test(decide) && /!data\?\.length/.test(decide))
assert('the list reads waiting pre-orders of this client only', /\.eq\('client_id', clientId\)\s*\.eq\('is_deleted', true\)\s*\.eq\('deleted_reason', PREORDER_WAITING\)/.test(hook))
assert('adding asks for the row back', /insert\(row\)\.select\('id'\)/.test(hook))
assert('a kept piece refreshes the Collection', /invalidateQueries\(\{ queryKey: styleKeys\.closet\(clientId\) \}\)/.test(hook))

// 4. Nowhere else
const hidden = src('src/hooks/useHiddenItems.ts')
assert('the hidden-pieces list leaves pre-orders out', /deleted_reason\.not\.in\.\(\$\{PREORDER_REASONS\.join/.test(hidden))
assert('the builder Collection reads live pieces only', /\.eq\('is_deleted', false\)/.test(src('src/hooks/useClosetItems.ts')))

// 5. The tab
const panel = src('src/components/categorize/CategorizePanel.tsx')
assert('Categorize has a Pre-orders tab', /'collection', 'preorders'/.test(panel) && /<PreordersTab /.test(panel))
const tab = src('src/components/categorize/PreordersTab.tsx')
assert('the tab has Keep and Return on every card', /data-preorder-keep/.test(tab) && /data-preorder-return/.test(tab))
assert('no em dash in what a stylist reads', !/—/.test(tab) && !/—/.test(panel.slice(panel.indexOf("mode === 'preorders' ?"), panel.indexOf("mode === 'nesting' ?"))))

// 6. The twin
const twinPath = [resolve(ROOT, '../atelier-looks/src/lib/preorders.ts')].find(existsSync)
if (twinPath) {
  const L = await import(twinPath)
  assert('the lookbook names the same waiting reason', L.PREORDER_WAITING === P.PREORDER_WAITING && L.PREORDER_RETURNED === P.PREORDER_RETURNED)
  assert('the lookbook reads photos the same way', JSON.stringify(L.preorderPhotoKeys(row)) === JSON.stringify(P.preorderPhotoKeys(row)))
  assert('the lookbook shows prices the same way', ['1,250', '$9', 'TBC', ''].every((v) => L.shownPrice(v) === P.shownPrice(v)))
  assert('the lookbook knows a kept one', L.isKeptPreorder({ raw: kept.raw }) && !L.isKeptPreorder({ raw: back.raw }) && !L.isKeptPreorder({ raw: {} }))
} else {
  console.log('check-preorders: atelier-looks is not beside this checkout; twin compare skipped')
}

console.log(`check-preorders: ${n} checks, ${problems.length} failed`)
if (n === 0 || problems.length) process.exit(1)
