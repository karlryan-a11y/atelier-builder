#!/usr/bin/env node
/**
 * SEND A LOOK FROM A PHONE.
 *
 * Maegan Zarley Watson, 2026-09-24: "we need an easy way to text a look to a client where they can
 * cleanly see the image and then click on it to see the individual items" and "I need to be able
 * do this from my phone." On an iPhone the desktop Style screen put the look cards and Copy link
 * off the right edge, so there was no way to send a look from a phone.
 *
 * WHAT IS GUARDED
 *
 *   1. STYLE ON A PHONE IS THE SEND SCREEN. App.tsx shows PhoneSend at phone width, with a way to
 *      the full tool; a computer or an iPad still gets the whole Style tool.
 *   2. ONE KIND OF LINK. The phone sends the link Copy link makes (useShareLinks: same mint, same
 *      open count, same Revoke), never a second kind.
 *   3. THE SHARE SHEET OPENS. Safari opens it only inside the tap, so the link is fetched when a
 *      look opens and Send hands over a link it already has (no network wait before the sheet).
 *      The sheet gets the link alone; closing it copies nothing; no sheet, or a refused one, copies.
 *   4. SAME ADDRESS ON THE LIVE SITE. On atelierbywatson.com/style the share endpoints are called
 *      on the same address (/looks/api/share); the builder's own address still calls the live site.
 *   5. NO ZOOM. Every box typed into on the phone screen is 16px, or Safari zooms in on a tap.
 *
 * Exits non-zero on failure and on inspecting nothing (ADR-0106).
 */
import { readFileSync, existsSync } from 'node:fs'

// An argument checks another checkout instead (e.g. main, to see this fail on the old code).
const ROOT = process.argv[2] ? process.argv[2].replace(/\/?$/, '/') : new URL('..', import.meta.url).pathname
const problems = []
let checks = 0
const fail = (m) => { problems.push(m); console.error(`   ❌ ${m}`) }
const ok = (cond, m) => { checks++; if (!cond) fail(m) }
const read = (p) => (existsSync(ROOT + p) ? readFileSync(ROOT + p, 'utf8') : (fail(`${p}: file not found`), ''))

// ── 3 and 4: the rules themselves ────────────────────────────────────────────────────────────
const LIB = `${ROOT}src/lib/shareSend.ts`
if (existsSync(LIB)) {
  const { sendLink, shareApiBase, sendMessage } = await import(LIB)
  const URL_ = 'https://atelierbywatson.com/c/abcdefghijklmnop'
  const run = async (share) => {
    const calls = { shared: [], copied: [] }
    const nav = share === undefined ? {} : { share: async (d) => { calls.shared.push(d); if (share) throw share } }
    const r = await sendLink(URL_, nav, async (t) => { calls.copied.push(t); return true })
    return { r, calls }
  }
  let t = await run(null)
  ok(t.r === 'shared', `share sheet that opens: expected "shared", got "${t.r}"`)
  ok(t.calls.shared.length === 1 && JSON.stringify(t.calls.shared[0]) === JSON.stringify({ url: URL_ }),
    `the sheet must get the link alone ({ url }), got ${JSON.stringify(t.calls.shared[0])}`)
  ok(t.calls.copied.length === 0, 'a sent link must not also be copied')
  t = await run(Object.assign(new Error('closed'), { name: 'AbortError' }))
  ok(t.r === 'cancelled' && t.calls.copied.length === 0, `closing the sheet must copy nothing, got "${t.r}"`)
  t = await run(Object.assign(new Error('no'), { name: 'NotAllowedError' }))
  ok(t.r === 'copied' && t.calls.copied[0] === URL_, `a refused sheet must copy the link, got "${t.r}"`)
  t = await run(undefined)
  ok(t.r === 'copied' && t.calls.copied[0] === URL_, `no share sheet must copy the link, got "${t.r}"`)
  const failed = await sendLink(URL_, {}, async () => false)
  ok(failed === 'failed' && sendMessage(failed, URL_).includes(URL_), 'a failed copy must show the link')
  ok(sendMessage('copied', URL_) === 'Link copied. Paste it into a text.', 'the copied line changed')
  ok(shareApiBase({ hostname: 'atelierbywatson.com', port: '' }) === '/looks/api/share', 'atelierbywatson.com/style must call /looks/api/share on its own address')
  ok(shareApiBase({ hostname: 'atelier-builder-abc123-wsgautomations-projects.vercel.app', port: '' }) === '/looks/api/share', 'a builder preview must call its own address (vercel.json passes it on)')
  ok(shareApiBase({ hostname: 'localhost', port: '5173' }) === 'https://atelierbywatson.com/looks/api/share', 'the local dev server must call the live site')
  // sendLink must ask for the sheet before it waits on anything, or Safari has lost the tap.
  let calledSync = false
  const p = sendLink(URL_, { share: () => { calledSync = true; return Promise.resolve() } }, async () => true)
  ok(calledSync, 'sendLink must open the share sheet in the same moment as the tap (no wait before it)')
  await p
  for (const r of ['shared', 'cancelled', 'copied', 'failed']) ok(!/[—–]/.test(sendMessage(r, URL_)), `"${r}" line has a dash`)
} else {
  fail('src/lib/shareSend.ts: file not found')
}

// ── 1: Style on a phone ───────────────────────────────────────────────────────────────────────
const app = read('src/App.tsx')
ok(/import \{ PhoneSend \} from '@\/components\/phone\/PhoneSend'/.test(app), 'App.tsx must import PhoneSend')
ok(/matchMedia\(PHONE_QUERY\)/.test(app) && /PHONE_QUERY = '\(max-width: 640px\)'/.test(app), 'App.tsx must decide "phone" by a 640px width query')
ok(/activeView === 'style' && phone && !fullStyleOnPhone[\s\S]{0,200}<PhoneSend onFullTool=/.test(app), 'Style at phone width must render PhoneSend, with a way to the full tool')

// ── 2, 3 and 5: the phone screen ──────────────────────────────────────────────────────────────
const ps = read('src/components/phone/PhoneSend.tsx')
ok(/useShareLinks\(activeClient\?\.id/.test(ps), 'PhoneSend must send the Copy link link (useShareLinks)')
ok(!/fetch\(/.test(ps), 'PhoneSend must not call an endpoint of its own: one kind of link, made in useShareLinks')
// A link is made only by Send: opening a look must not make one (the desktop "link live" line).
const openItem = ps.match(/function openItem\([^)]*\) \{([\s\S]*?)\n  \}/)?.[1] ?? ''
ok(openItem.length > 0 && /setOpen\(\{ kind, item \}\)/.test(openItem), 'PhoneSend: opening a look goes through openItem')
ok(!/ensureLink|sendKnownLink|fetch/.test(openItem), 'opening a look must not make or send a link (only the Send tap may)')
ok(!/useEffect/.test(ps), 'PhoneSend must not make a link from an effect (only the Send tap may)')
ok((ps.match(/ensureLink\(/g) ?? []).length === 1, 'PhoneSend may ask for a link in one place only, onSend')
const onSend = ps.match(/async function onSend\(\) \{([\s\S]*?)\n  \}/)?.[1] ?? ''
ok(onSend.length > 0, 'PhoneSend: onSend not found')
ok(/^\s*if \(!open\) return\s*\n\s*if \(st\?\.url\) \{ void share\.sendKnownLink\(st\.url\); return \}/.test(onSend),
  'a look that already has a link must send it straight from the tap, before any wait')
ok(/await share\.ensureLink\(open\.kind, open\.item\.id\)[\s\S]*void share\.sendKnownLink\(got\.url\)/.test(onSend), 'a look with no link gets one on Send, then sends it')
ok(/onClick=\{\(\) => void onSend\(\)\}/.test(ps), 'the Send button must call onSend')
ok(/useLookCategories\(activeClient\?\.id/.test(ps), "PhoneSend must read the client's looks and capsules from the shared Style cache")
ok(/!l\.archived/.test(ps) && /!c\.archived/.test(ps), 'archived looks and capsules must not be offered to send')
const inputs = ps.match(/<input[\s\S]*?\/>/g) ?? []
ok(inputs.length > 0, 'PhoneSend: no search box found')
for (const i of inputs) ok(/text-\[16px\]/.test(i), 'every PhoneSend text box must be 16px')
ok(!/[—–]/.test(ps.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'PhoneSend has a dash in what a person reads')
const bar = read('src/components/layout/ClientBar.tsx')
ok(/placeholder="Search clients…"[\s\S]{0,200}text-\[16px\] sm:text-sm/.test(bar), 'the client search must be 16px on a phone')

const hook = read('src/hooks/useShareLinks.ts')
ok(/const API = shareApiBase\(/.test(hook), 'useShareLinks must take its address from shareApiBase')
ok(/JSON\.stringify\(\{ kind, itemId: subjectId, clientId \}\)/.test(hook), 'mint must say which client it is for')
ok(/sendKnownLink/.test(hook) && /ensureLink/.test(hook), 'useShareLinks must offer ensureLink and sendKnownLink')
const vj = read('vercel.json')
ok(/"source": "\/looks\/api\/share\/:path\*",\s*"destination": "https:\/\/atelier-looks\.vercel\.app\/api\/share\/:path\*"/.test(vj),
  "vercel.json must pass /looks/api/share on the builder's own address to the lookbook")

if (checks < 20) fail(`only ${checks} checks ran`)
if (problems.length) {
  console.error(`\ncheck-phone-send: ${problems.length} problem(s) in ${checks} checks`)
  process.exit(1)
}
console.log(`✓ check-phone-send: ${checks} checks (send sheet, copy fallback, same link, phone screen, 16px boxes)`)
