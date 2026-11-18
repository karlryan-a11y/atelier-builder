// @checks guard
// Remove BG on a piece whose photo is still on a store's own site (Cynthia Dada, 2026-11-18: Peyton's
// new Jacquemus pieces said "couldn't fetch the item image (403)"). jacquemus.com refuses the background
// remover's download but hands the photo to an ordinary server, so a store photo goes through
// api/remove-bg.ts, which keeps a copy in our storage and gives the remover that copy.
// FAILS before: no lib/removeBg, and every Remove BG button called the remover with the store address.
import { readFileSync, existsSync } from 'node:fs'
const LIB = 'src/lib/removeBg.ts'
const API = 'api/remove-bg.ts'
const fails = []
const need = (ok, m) => { if (!ok) fails.push(m) }
need(existsSync(LIB), `${LIB} must exist`)
need(existsSync(API), `${API} must exist`)
if (existsSync(LIB)) {
  const text = readFileSync(LIB, 'utf8')
  const start = text.indexOf('export function isStorePhoto')
  need(start >= 0, 'lib/removeBg must export isStorePhoto')
  if (start >= 0) {
    const hosts = text.slice(text.indexOf('const OUR_PHOTO_HOSTS'), text.indexOf('\n', text.indexOf('const OUR_PHOTO_HOSTS')) + 1)
    const body = text.slice(start, text.indexOf('\n}\n', start) + 2).replace('export ', '').replace(/\(url: string \| null \| undefined\): boolean/, '(url)')
    const isStorePhoto = new Function(hosts + body + '\nreturn isStorePhoto')()
    const JQ = 'https://www.jacquemus.com/dw/image/v2/BJFJ_PRD/on/demandware.static/-/Sites-master-jacquemus/default/dw2f1ae6ba/26HBAW00416EC25L041SS_17.jpg?q=100'
    need(isStorePhoto(JQ) === true, 'a jacquemus.com photo is a store photo')
    need(isStorePhoto('https://cdn.shopify.com/s/files/1/x.jpg') === true, 'any other store host is a store photo')
    need(isStorePhoto('https://goodpix-co.s3.amazonaws.com/GoodPix/Contents/a/b.jpg') === false, 'a GoodPix photo is ours (works today)')
    need(isStorePhoto('/img-proxy/GoodPix/Contents/a/b.jpg') === false, 'the builder /img-proxy form is ours')
    need(isStorePhoto('https://abcdefgh.supabase.co/functions/v1/image-proxy?key=closet%2Fx.png') === false, 'our image-proxy is ours')
    need(isStorePhoto('https://atelierbywatson.com/img/closet/x.png') === false, 'our photo path is ours')
    need(isStorePhoto('https://images.atelierbywatson.com/closet/x.png') === false, 'our R2 host is ours')
    need(isStorePhoto('data:image/png;base64,AAAA') === false, 'a data address is not a store photo')
    need(isStorePhoto('') === false && isStorePhoto(null) === false, 'no photo is not a store photo')
  }
}
// Every Remove BG button goes through the one helper, never straight to the remover.
for (const f of ['src/components/categorize/CollectionTab.tsx', 'src/components/canvas/CanvasToolbar.tsx', 'src/components/reconciliation/ReconciliationPanel.tsx']) {
  const t = readFileSync(f, 'utf8')
  need(!t.includes('functions/v1/intake-remove-bg-item'), `${f} must call removeItemBackground (lib/removeBg), not the remover directly`)
  need(/removeItemBackground\(/.test(t), `${f} must use removeItemBackground`)
}
if (existsSync(API)) {
  const a = readFileSync(API, 'utf8')
  need(/requireStaff\(/.test(a), 'api/remove-bg must be for signed-in team only')
  need(/intake-remove-bg-item/.test(a), 'api/remove-bg must hand the copy to the same remover')
  need(/client_id/.test(a) && /\.eq\.|eq\./.test(a), 'api/remove-bg must check the piece belongs to the client it names')
}
if (fails.length) { console.error('check-remove-bg-store-photo FAILED:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('check-remove-bg-store-photo: PASS')
