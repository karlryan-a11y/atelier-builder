// @checks guard
// Remove BG on a piece whose photo is still on a store's own site (Cynthia Dada, 2026-11-18: Peyton's
// new Jacquemus pieces said "couldn't fetch the item image (403)"). jacquemus.com refuses every server
// (the remover's, Vercel's), so nothing on our side can fetch it. She must be told what works instead:
// save the photo from the store's page and use Replace photo. Photos the remover can read are unchanged.
// FAILS before: no lib/removeBg, and every Remove BG button showed the remover's bare "(403)".
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const LIB = 'src/lib/removeBg.ts'
const fails = []
const need = (ok, m) => { if (!ok) fails.push(m) }
need(existsSync(LIB), `${LIB} must exist`)
if (existsSync(LIB)) {
  // The real file, with its one import and the build-time address swapped for stand-ins.
  const ts = readFileSync(LIB, 'utf8')
    .replace(/^import \{ authHeader \} from '@\/lib\/authHeader'\n/m, "const authHeader = async () => ({ Authorization: 'Bearer t' })\n")
    .replace('import.meta.env.VITE_SUPABASE_URL', "'https://x.supabase.co'")
  const file = join(mkdtempSync(join(tmpdir(), 'removebg-')), 'removeBg.ts')
  writeFileSync(file, ts)
  const m = await import(file)
  const JQ = 'https://www.jacquemus.com/dw/image/v2/BJFJ_PRD/on/demandware.static/-/Sites-master-jacquemus/default/dw2f1ae6ba/26HBAW00416EC25L041SS_17.jpg?q=100'
  need(m.isStorePhoto(JQ) === true, 'a jacquemus.com photo is a store photo')
  need(m.isStorePhoto('https://newtakefive.com/cdn/shop/files/17656323.jpg?v=1&width=713') === true, 'any other store host is a store photo')
  for (const ours of ['https://goodpix-co.s3.amazonaws.com/GoodPix/Contents/a/b.jpg', 'https://s3.amazonaws.com/goodpix-co/GoodPix/ProfilePictures/x.png',
    'https://res.cloudinary.com/pixavo/image/upload/b_white/x.jpg', '/img-proxy/GoodPix/Contents/a/b.jpg',
    'https://abcdefgh.supabase.co/functions/v1/image-proxy?key=closet%2Fx.png', 'https://atelierbywatson.com/img/closet/x.png', 'data:image/png;base64,AAAA', '', null]) {
    need(m.isStorePhoto(ours) === false, `not a store photo: ${ours}`)
  }
  const msg = m.storeRefusedMessage(JQ)
  need(/jacquemus\.com/.test(msg) && /Replace photo/.test(msg) && /save the photo/i.test(msg), 'the message names the store and says to save the photo and use Replace photo')
  need(!/—|–/.test(msg) && !/40[13]/.test(msg), 'the message has no dash and no error number')

  // The remover answers the way it did for Cynthia; then the way it does when it works.
  const calls = []
  const answer = (status, body) => async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify(body), { status }) }
  globalThis.fetch = answer(200, { ok: false, reason: "couldn't fetch the item image (403)" })
  let d = await m.removeItemBackground('i1', JQ)
  need(d.ok === false && d.reason === msg, `a store photo the remover can't fetch gets the plain message (got ${d.reason})`)
  need(calls[0]?.url === 'https://x.supabase.co/functions/v1/intake-remove-bg-item' && calls[0].body.item_id === 'i1' && calls[0].body.image_url === JQ, 'it still asks the same remover, with the same piece and photo')
  globalThis.fetch = answer(502, { error: "couldn't fetch the item image (403)" })
  d = await m.removeItemBackground('i1b', JQ)
  need(d.ok === false && d.reason === msg, 'the same when the remover answers with an error status')
  const GP = 'https://goodpix-co.s3.amazonaws.com/GoodPix/Contents/a/b.jpg'
  d = await m.removeItemBackground('i2', GP)
  need(d.ok === false && (d.reason || d.error) === "couldn't fetch the item image (403)",'a GoodPix photo keeps the remover\'s own words')
  globalThis.fetch = answer(200, { ok: false, reason: 'This looks like jewelry; try Replace photo' })
  d = await m.removeItemBackground('i3', JQ)
  need(d.reason === 'This looks like jewelry; try Replace photo', 'any other refusal keeps the remover\'s own words')
  globalThis.fetch = answer(200, { ok: true, url: 'https://x/closet/nobg/i4.png' })
  d = await m.removeItemBackground('i4', GP)
  need(d.ok === true && d.url === 'https://x/closet/nobg/i4.png', 'a cleaned piece comes back ok with its new picture')
}
// Every Remove BG button goes through the one helper, never straight to the remover.
for (const f of ['src/components/categorize/CollectionTab.tsx', 'src/components/canvas/CanvasToolbar.tsx', 'src/components/reconciliation/ReconciliationPanel.tsx']) {
  const t = readFileSync(f, 'utf8')
  need(!t.includes('functions/v1/intake-remove-bg-item'), `${f} must call removeItemBackground (lib/removeBg), not the remover directly`)
  need(/removeItemBackground\(/.test(t), `${f} must use removeItemBackground`)
}
need(/refused\.length/.test(readFileSync('src/components/categorize/CollectionTab.tsx', 'utf8')), 'bulk Remove BG names the pieces whose store refused, with what to do')
if (fails.length) { console.error('check-remove-bg-store-photo FAILED:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('check-remove-bg-store-photo: PASS (store photos, our photos, the message, four remover answers, every button)')
