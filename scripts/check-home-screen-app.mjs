#!/usr/bin/env node
/**
 * THE BUILDER AS A HOME-SCREEN APP ON AN IPHONE AND AN IPAD.
 *
 * Karl, 2026-11-14: "every page the stylist builder the shop everything the team uses", "Do iPhone and
 * iPad". The dashboard was already an app; the builder (atelierbywatson.com/style) had no manifest and
 * no apple tags, so Add to Home Screen pinned a plain bookmark that opened in Safari. On an iPad upright
 * the closet and looks panels squeezed the Style board to a sliver; on an iPhone Digitize and the top
 * menu ran off the right edge.
 *
 * WHAT IS GUARDED
 *
 *   1. INSTALLS AS AN APP. index.html links the manifest and the icon under /brand/ (the dashboard
 *      passes /brand/* through to this app, so the same paths answer on atelierbywatson.com/style),
 *      writes the apple-prefixed capable tag by hand (iOS reads only that one), and lets the black
 *      header run under the notch (viewport-fit=cover). The manifest is standalone, opens /style, and
 *      every icon it names is in public/.
 *   2. NOTHING UNDER THE NOTCH OR THE HOME BAR. The header pads by the top inset; the app pads by the
 *      bottom and side insets.
 *   3. NO ZOOM ON A TAP. On a touch screen every box typed into is at least 16px.
 *   4. STYLE FITS AN IPAD UPRIGHT AND A PHONE. Below 1024px the closet, board and looks show one at a
 *      time, picked from a Pieces / Board / Looks row; each panel says which one it is.
 *   5. DIGITIZE AND THE MENU FIT A PHONE. Digitize shows its menu or its work, with a way back; the
 *      top tabs scroll inside the bar instead of running off the screen.
 *
 * Exits non-zero on failure and on inspecting nothing (ADR-0106).
 * An argument checks another checkout instead (e.g. main, to see this fail on the old code).
 */
import { readFileSync, existsSync } from 'node:fs'

const ROOT = process.argv[2] ? process.argv[2].replace(/\/?$/, '/') : new URL('..', import.meta.url).pathname
const problems = []
let checks = 0
const fail = (m) => { problems.push(m); console.error(`   ❌ ${m}`) }
const ok = (cond, m) => { checks++; if (!cond) fail(m) }
const read = (p) => (existsSync(ROOT + p) ? readFileSync(ROOT + p, 'utf8') : (fail(`${p}: file not found`), ''))

// ── 1. installs as an app ────────────────────────────────────────────────────────────────────────
const html = read('index.html')
ok(/<meta name="apple-mobile-web-app-capable" content="yes"/.test(html), 'index.html must write <meta name="apple-mobile-web-app-capable" content="yes"> by hand (iOS reads only that name)')
ok(/<link rel="manifest" href="\/brand\/atelier-style\.webmanifest"/.test(html), 'index.html must link /brand/atelier-style.webmanifest (a /brand/ path answers on atelierbywatson.com/style too)')
ok(/<link rel="apple-touch-icon" href="\/brand\/apple-touch-icon\.png"/.test(html), 'index.html must name the home-screen icon /brand/apple-touch-icon.png')
ok(/<meta name="apple-mobile-web-app-title" content="Atelier"/.test(html), 'the home-screen name must be "Atelier"')
ok(/name="viewport" content="[^"]*viewport-fit=cover/.test(html), 'the viewport must say viewport-fit=cover so the safe-area insets are real')
ok(!/maximum-scale|user-scalable=no/.test(html), 'the viewport must still let a person pinch to zoom')

let manifest = null
try { manifest = JSON.parse(read('public/brand/atelier-style.webmanifest') || 'null') } catch (e) { fail(`public/brand/atelier-style.webmanifest is not valid JSON (${e.message})`) }
ok(!!manifest, 'public/brand/atelier-style.webmanifest is missing')
if (manifest) {
  ok(manifest.display === 'standalone', `manifest display is "${manifest.display}", expected "standalone" (anything else opens with Safari's bars)`)
  ok(manifest.start_url === '/style', `manifest start_url is "${manifest.start_url}", expected "/style" (the app opens on Style)`)
  ok(manifest.scope === '/', `manifest scope is "${manifest.scope}", expected "/" (Shop, Clients and Dash stay inside the app)`)
  ok(manifest.short_name === 'Atelier', 'manifest short_name must be "Atelier"')
  const icons = manifest.icons ?? []
  ok(icons.some((i) => i.sizes === '192x192') && icons.some((i) => i.sizes === '512x512'), 'manifest needs a 192 and a 512 icon')
  for (const i of icons) ok(/^\/brand\//.test(i.src) && existsSync(ROOT + 'public' + i.src), `manifest icon ${i.src} must sit in public/brand/`)
}
ok(existsSync(ROOT + 'public/brand/apple-touch-icon.png'), 'public/brand/apple-touch-icon.png is missing')
// The dashboard must keep passing /brand/* to this app, and must not have a file of its own there by
// the same name (Next serves its own public files first). Only checkable when it sits beside us.
const DASH = ROOT + '../wsg-dashboard/'
if (existsSync(DASH + 'vercel.json')) {
  const v = JSON.parse(readFileSync(DASH + 'vercel.json', 'utf8'))
  ok((v.rewrites ?? []).some((r) => r.source === '/brand/:path*' && /atelier-builder\.vercel\.app\/brand\/:path\*/.test(r.destination)), 'wsg-dashboard/vercel.json must pass /brand/* to the builder')
  ok(!existsSync(DASH + 'public/brand/atelier-style.webmanifest'), 'wsg-dashboard/public/brand/atelier-style.webmanifest would hide the builder\'s manifest')
}

// ── 2. safe areas ────────────────────────────────────────────────────────────────────────────────
const header = read('src/components/layout/Header.tsx')
ok(/<header className=\{`[^`]*box-content pt-\[env\(safe-area-inset-top\)\]/.test(header), 'the Header must pad by the top safe-area inset (box-content keeps its own height)')
const app = read('src/App.tsx')
ok(/h-\[100dvh\] flex flex-col overflow-hidden pb-\[env\(safe-area-inset-bottom\)\] pl-\[env\(safe-area-inset-left\)\] pr-\[env\(safe-area-inset-right\)\]/.test(app), 'the app must pad by the bottom and side safe-area insets')
ok(/pb-\[env\(safe-area-inset-bottom\)\]">\s*<PhoneSend/.test(app), 'the phone Send screen must pad by the bottom inset')
const ps = read('src/components/phone/PhoneSend.tsx')
ok(/box-content[^"]*pt-\[env\(safe-area-inset-top\)\][^"]*bg-\[#050505\]/.test(ps), "the phone Send screen's black bar must pad by the top inset")

// ── 3. no zoom on a tap ──────────────────────────────────────────────────────────────────────────
const css = read('src/index.css')
const coarse = css.match(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
ok(/input:not\(\[type=checkbox\]\)/.test(coarse) && /select/.test(coarse) && /textarea/.test(coarse) && /font-size: max\(16px, 1em\) !important/.test(coarse),
  'index.css must make every input, select and textarea at least 16px on a touch screen')
ok(/@media \(hover: none\) \{\s*\.group \.group-hover\\:opacity-100 \{ opacity: 1; \}/.test(css), 'hover-only buttons (a tile\'s Edit) must show on a touch screen')

// ── 4. Style one panel at a time ─────────────────────────────────────────────────────────────────
ok(/const ONE_PANEL_QUERY = '\(max-width: 1023px\)'/.test(app), 'App.tsx must switch to one panel at a time below 1024px')
ok(/return <div data-style-panes className=/.test(app) && /<div data-show-panel=\{stylePanel\} className="relative flex flex-1 overflow-hidden">\s*<StylePane active=\{styleTab === 'canvas'\} layer="base">/.test(app), 'the canvas StylePane must sit in a box that says which panel shows')
ok(/STYLE_PANELS[\s\S]{0,40}\['pieces', 'Pieces'\], \['board', 'Board'\], \['looks', 'Looks'\]/.test(app), 'the panel row must offer Pieces, Board and Looks')
ok(/onePanel && styleTab === 'canvas' && \([\s\S]{0,200}role="tablist"/.test(app), 'the panel row shows only below 1024px, on Canvas')
ok(/if \(openLookId\) setStylePanel\('board'\)/.test(app), 'opening a look must show the board')
const oneMq = css.match(/@media \(max-width: 1023px\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
ok(/\[data-style-panes\] > \[data-pane\] \{ display: none !important; \}/.test(oneMq), 'below 1024px only the chosen panel may show')
for (const p of ['pieces', 'board', 'looks']) ok(new RegExp(`\\[data-show-panel="${p}"\\] > \\[data-style-panes\\] > \\[data-pane="${p}"\\]`).test(oneMq), `index.css must show the ${p} panel when it is picked`)
const panes = { pieces: 'src/components/layout/ClosetPanel.tsx', board: 'src/components/canvas/LookCanvas.tsx', look: 'src/components/canvas/LookItemsPanel.tsx', looks: 'src/components/layout/ChatPanel.tsx' }
for (const [p, f] of Object.entries(panes)) ok(new RegExp(`data-pane="${p}"`).test(read(f)), `${f} must mark its panel data-pane="${p}"`)

// ── 5. Digitize and the menu on a phone ──────────────────────────────────────────────────────────
const inbox = read('src/components/intake/IntakeInbox.tsx')
ok(/useState<'menu' \| 'work'>\('menu'\)/.test(inbox), 'Digitize must keep which half shows on a phone')
ok(/<aside className=\{`[^`]*max-md:w-full[^`]*\$\{phonePane === 'work' \? 'max-md:hidden' : ''\}/.test(inbox), "Digitize's menu fills a phone and hides while the work shows")
ok(/\$\{phonePane === 'menu' \? 'max-md:hidden' : ''\}`\}>\s*<button onClick=\{\(\) => setPhonePane\('menu'\)\} className="md:hidden/.test(inbox), "Digitize's work hides behind the menu on a phone, with a way back")
ok(/tellFrame\(\{ type: 'select', id: it\.id \}\); setPhonePane\('work'\)/.test(inbox), 'tapping a piece on a phone opens it')
ok(/max-sm:overflow-x-auto/.test(header) && /max-sm:\[&>\*\]:min-h-11/.test(header), 'the top tabs must scroll inside the bar on a phone, each 44px tall')

if (checks < 30) fail(`only ${checks} checks ran`)
if (problems.length) {
  console.error(`\ncheck-home-screen-app: ${problems.length} problem(s) in ${checks} checks`)
  process.exit(1)
}
console.log(`✓ check-home-screen-app: ${checks} checks (installs as an app, safe areas, 16px boxes, Style one panel at a time, Digitize on a phone)`)
