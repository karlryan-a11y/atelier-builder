#!/usr/bin/env node
/**
 * Style interaction harness (styling wave 3). DEV-ONLY: not part of the app, not in `guard`.
 *
 * Builds the REAL builder app with render counters spliced in (dev/harness/vite.config.harness.ts),
 * serves it with `vite preview`, and drives it in Playwright WebKit at iPad size (1024x1366)
 * against a MOCKED Supabase (no network, no real client data, nothing written anywhere):
 *   - a 1,300-piece closet (the size of the largest real closets) whose raw JSON is padded to the
 *     measured production ratio (~3.6 KB a piece with raw, ~0.9 KB without),
 *   - 40 saved looks, 8 capsules, 6 categories,
 *   - a board with 12 pieces loaded on the canvas.
 * Simulated network: --rtt ms per request (default 150) + 3 MB/s, so bytes and serial round trips
 * cost time.
 *
 * Measures, per checkout:
 *   - renders of the closet grid (tiles), closet panel, app shell, looks panel per board TAP
 *     (a real tap on a piece: Playwright pointer events on the Konva canvas) and per DRAG;
 *   - tap latency: pointerdown -> the frame after the resulting render (median, p95);
 *   - cold closet load for the client; Canvas <-> Categorize switch time and bytes/requests.
 *
 *   node scripts/perf/style-harness.mjs [--repo <checkout>] [--assert] [--json out.json]
 *
 * --assert exits 1 unless: 0 closet-tile renders per tap and per drag, 0 closet reads on a tab
 * switch, and 0 page errors. On origin/main it fails; on styling-wave3 it passes.
 */
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const args = process.argv.slice(2)
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const REPO = path.resolve(arg('--repo', '.'))
const ASSERT = args.includes('--assert')
const JSON_OUT = arg('--json', null)
const TAPS = Number(arg('--taps', 24))
// Per-request latency. 150 ms: measured 2026-09-19 from Denver, curl to the project's REST
// endpoint took 220-355 ms with a fresh TLS handshake each time (connect 34-92 ms); a browser
// reusing its connection pays roughly the server time plus one round trip.
const RTT = Number(arg('--rtt', 150))
const PORT = 5188

// Playwright lives in atelier-looks (it owns check:webkit); fall back to a local install.
const req = createRequire(import.meta.url)
let playwright
for (const p of [path.join(REPO, 'node_modules/playwright'), path.join(process.env.HOME, 'Downloads/atelier-looks/node_modules/playwright')]) {
  if (existsSync(p)) { playwright = req(p); break }
}
if (!playwright) { console.error('playwright not found (install it, or keep ~/Downloads/atelier-looks)'); process.exit(2) }

const env = Object.fromEntries(
  readFileSync(path.join(REPO, '.env.local'), 'utf8').split('\n')
    .map((l) => l.match(/^(VITE_SUPABASE_URL)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
)
const SUPA = env.VITE_SUPABASE_URL
if (!SUPA) { console.error('VITE_SUPABASE_URL missing in .env.local'); process.exit(2) }

// ── fixtures ─────────────────────────────────────────────────────────────────
const CLIENT = { id: 'harnessclient000000000001', name: 'Harness Client' }
const N_ITEMS = 1300
const TAGS = ['Tops', 'Pants', 'Skirts', 'Dresses', 'Shoes', 'Handbags', 'Jewelry', 'Jackets', 'Sweaters', 'Belts']
  .map((name, i) => ({ id: `tag${String(i).padStart(21, '0')}`, name }))
const hex = (n) => n.toString(16).padStart(24, '0')
const FILLER = 'x'.repeat(2400)
const items = Array.from({ length: N_ITEMS }, (_, i) => ({
  id: hex(0xa0000 + i), client_id: CLIENT.id, name: `Piece ${i + 1}`, name_override: null,
  style_note: i % 17 === 0 ? 'wear with heels' : null, category: null, custom_categories: i % 9 === 0 ? ['travel'] : [],
  category_suggested: null, brand: ['Chanel', 'Loro Piana', 'The Row', 'Khaite'][i % 4], color: ['Black', 'Ivory', 'Navy'][i % 3],
  color_family: null, color_families: null, color_audit: null, content_tag_ids: [TAGS[i % TAGS.length].id],
  is_deleted: false, transitioned_at: null, transition_reason: null, transition_source: null,
  client_edited_fields: null, client_edited_at: null, drive_verified_at: null, drive_verified_by: null,
  raw: {
    image: `https://goodpix-co.s3.amazonaws.com/harness/${i}.jpg`,
    images: [`https://goodpix-co.s3.amazonaws.com/harness/${i}.jpg`, `https://goodpix-co.s3.amazonaws.com/harness/${i}b.jpg`],
    description: [`A piece of harness clothing number ${i}`], sizes: ['S', 'M'], filler: FILLER,
  },
  primary_image_hash: null, processed_image_hash: null, source: 'goodpix',
  added_at: new Date(Date.UTC(2026, 0, 1) - i * 3600_000).toISOString(),
}))
const PIECE_URL = '/__harness/piece.png'
const boardNodes = Array.from({ length: 12 }, (_, i) => ({
  id: `ci_harness_${i}`, type: 'closet_item', closet_item_id: items[i].id,
  x: 60 + (i % 4) * 240, y: 80 + Math.floor(i / 4) * 330, scale: 1, target_height: 280,
  rotation: 0, flipped: false, z_index: i, locked: false,
}))
const board = { version: 1, canvas: { width: 1080, height: 1080, background: '#FFFFFF' }, nodes: boardNodes }
const looks = Array.from({ length: 40 }, (_, i) => ({
  id: hex(0xb0000 + i), client_id: CLIENT.id, name: `Harness Look ${i + 1}`, canvas_state: board, tags: [],
  notes_internal: null, notes_client: null, created_by: null, source: 'builder',
  raw: { main_image_url: `${SUPA}/functions/v1/image-proxy?key=looks/${i}.png` },
  created_at: '2026-09-01T00:00:00Z', updated_at: new Date(Date.UTC(2026, 8, 1) - i * 60_000).toISOString(),
  published: false, archived: false, sort_order: null, closet_item_ids: boardNodes.map((n) => n.closet_item_id),
  transitioned_at: null, is_deleted: false, extracted_at: null,
}))
const boards = Array.from({ length: 8 }, (_, i) => ({
  id: hex(0xc0000 + i), client_id: CLIENT.id, name: `Harness Capsule ${i + 1}`, description: '', closet_item_ids: [],
  raw: { source: 'builder', look_ids: [], image_url: `${SUPA}/functions/v1/image-proxy?key=caps/${i}.png` },
  created_at: '2026-09-01T00:00:00Z', published: false, is_deleted: false, sort_order: i,
}))
const cats = ['Office', 'Weekend', 'Travel', 'Evening', 'Aspen', 'Palm Beach'].map((label, i) => ({
  id: hex(0xd0000 + i), client_id: CLIENT.id, slug: label.toLowerCase().replace(/\s+/g, '-'), label, sort_order: i,
  is_hidden: false, is_residence: false, description: null, parent_slug: null,
}))
const TABLES = { gp_closet_items: items, gp_content_tags: TAGS, gp_looks: looks, looks, gp_boards: boards, look_categories: cats }

// ── a tiny PostgREST ─────────────────────────────────────────────────────────
function splitTop(s) {
  const out = []; let depth = 0, cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out.map((x) => x.trim()).filter(Boolean)
}
function pathGet(row, expr) {
  const parts = expr.split(/(->>|->)/)
  let v = row[parts[0]]
  for (let i = 1; i < parts.length; i += 2) {
    const key = parts[i + 1]
    if (v == null) return null
    v = Array.isArray(v) && /^\d+$/.test(key) ? v[Number(key)] : v[key]
    if (parts[i] === '->>' && v != null && typeof v !== 'string') v = JSON.stringify(v)
  }
  return v ?? null
}
function project(row, select) {
  if (!select || select === '*') return row
  const out = {}
  for (const col of splitTop(select)) {
    if (col.includes('(')) { out[col.split('(')[0].split(':').pop()] = []; continue }
    const [alias, expr] = col.includes(':') ? col.split(':') : [null, col]
    const key = alias ?? expr.split(/->>|->/).pop()
    out[key] = pathGet(row, expr)
  }
  return out
}
function matches(row, key, val) {
  const v = row[key]
  const [op, ...rest] = val.split('.')
  const arg = rest.join('.')
  if (op === 'eq') return String(v) === arg
  if (op === 'neq') return String(v) !== arg
  if (op === 'is') return arg === 'null' ? v == null : String(v) === arg
  if (op === 'not') return !matches(row, key, arg)
  if (op === 'in') return arg.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/"/g, '')).includes(String(v))
  if (op === 'cs') return true
  return true
}
function handleRest(url, method, headers) {
  const table = url.pathname.split('/').pop()
  const rows = TABLES[table] ?? []
  const params = url.searchParams
  let result = rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'offset', 'limit', 'columns', 'on_conflict'].includes(k)) continue
      if (!matches(r, k, v)) return false
    }
    return true
  })
  const total = result.length
  const offset = Number(params.get('offset') ?? 0)
  const limit = params.has('limit') ? Number(params.get('limit')) : total
  result = result.slice(offset, offset + limit).map((r) => project(r, params.get('select')))
  const h = {
    'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range',
    'content-range': `${result.length ? offset : '*'}-${result.length ? offset + result.length - 1 : ''}/${/count=/.test(headers.prefer ?? '') ? total : '*'}`.replace('*-/', '*/'),
  }
  if (method === 'HEAD') return { status: 200, headers: h, body: '' }
  if (method !== 'GET') return { status: 200, headers: h, body: '[]' }
  if (/vnd\.pgrst\.object/.test(headers.accept ?? '')) return { status: 200, headers: h, body: JSON.stringify(result[0] ?? null) }
  return { status: 200, headers: h, body: JSON.stringify(result) }
}

function png(w, h, rgba) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  const rowB = Buffer.alloc(1 + w * 4); for (let x = 0; x < w; x++) rowB.set(rgba, 1 + x * 4)
  const raw = Buffer.concat(Array.from({ length: h }, () => rowB))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const PIECE_PNG = png(300, 400, [120, 110, 100, 255])

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'harness-user', email: 'harness@example.com', role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.sig`
const USER = { id: 'harness-user', email: 'harness@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }

// ── build + serve ────────────────────────────────────────────────────────────
const cfg = 'dev/harness/vite.config.harness.ts'
if (!existsSync(path.join(REPO, cfg))) { console.error(`${cfg} missing in ${REPO}`); process.exit(2) }
console.error(`[harness] building ${REPO}`)
execFileSync('npx', ['vite', 'build', '--config', cfg, '--logLevel', 'error'], { cwd: REPO, stdio: 'inherit' })
const server = spawn('npx', ['vite', 'preview', '--config', cfg, '--port', String(PORT), '--strictPort'], { cwd: REPO, stdio: 'pipe' })
const stop = () => { try { server.kill('SIGTERM') } catch { /* gone */ } }
process.on('exit', stop)
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 150))
}

// ── run ──────────────────────────────────────────────────────────────────────
const browser = await playwright.webkit.launch()
const context = await browser.newContext({ viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2 })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
let net = { requests: 0, bytes: 0, closetReads: 0 }
const netLog = []
await page.route('**/*', async (route) => {
  const r = route.request()
  const url = new URL(r.url())
  const headers = r.headers()
  const delay = (bytes) => new Promise((res) => setTimeout(res, RTT + (bytes / (3 * 1024 * 1024)) * 1000))
  if (url.pathname === PIECE_URL || (r.resourceType() === 'image')) {
    return route.fulfill({ status: 200, headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' }, body: PIECE_PNG })
  }
  if (url.pathname === '/api/auth/session') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: JWT, refresh_token: 'harness-refresh' }) })
  }
  if (url.origin === new URL(SUPA).origin) {
    if (r.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' } })
    }
    let res
    if (url.pathname === '/auth/v1/user') res = { status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(USER) }
    else if (url.pathname === '/rest/v1/users') res = { status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ id: 'harness-user', email: USER.email, display_name: 'Harness', role: 'admin' }) }
    else if (url.pathname.startsWith('/rest/v1/')) res = handleRest(url, r.method(), headers)
    else res = { status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: '{}' }
    const bytes = Buffer.byteLength(res.body ?? '')
    net.requests++
    net.bytes += bytes
    if (url.pathname === '/rest/v1/gp_closet_items' && /transitioned_at=is\.null/.test(url.search)) net.closetReads++
    netLog.push({ t: Date.now(), path: url.pathname, bytes })
    await delay(bytes)
    return route.fulfill(res)
  }
  if (url.hostname === 'localhost') return route.continue()
  // Anything else off-box (e.g. the lookbook's share-status API) is answered here: the harness
  // never touches the network.
  return route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: '{}' })
})

await page.goto(`http://localhost:${PORT}/`)
await page.waitForFunction(() => !!globalThis.__stores && !!document.querySelector('button') && [...document.querySelectorAll('button')].some((b) => b.textContent?.trim().toLowerCase() === 'categorize'), null, { timeout: 30000 })

// cold closet load for the client
const t0 = Date.now(); net = { requests: 0, bytes: 0, closetReads: 0 }
await page.evaluate((c) => globalThis.__stores.client.getState().setActiveClient(c), CLIENT)
await page.waitForFunction(() => [...document.querySelectorAll('[aria-roledescription="draggable"]')].filter((el) => el.getClientRects().length).length >= 20, null, { timeout: 60000 })
await page.waitForFunction(() => document.body.textContent.includes('1300 pieces'), null, { timeout: 60000 })
const coldCloset = { ms: Date.now() - t0, ...net }

// a board with 12 pieces
await page.evaluate(({ board, url }) => {
  const urls = Object.fromEntries(board.nodes.map((n) => [n.id, url]))
  globalThis.__stores.canvas.getState().loadLook('harness-board', board, urls)
}, { board, url: PIECE_URL })
await page.waitForTimeout(1500)

async function nodeCenter(id) {
  return page.evaluate((nid) => {
    const st = globalThis.__Konva.stages.find((s) => s.findOne('#' + nid))
    const kn = st?.findOne('#' + nid)
    if (!kn) return null
    const r = kn.getClientRect()
    const c = st.container().getBoundingClientRect()
    return { x: c.left + r.x + r.width / 2, y: c.top + r.y + r.height / 2 }
  }, id)
}

await page.evaluate(() => {
  globalThis.__lat = []
  window.addEventListener('pointerdown', () => {
    const t = performance.now()
    requestAnimationFrame(() => setTimeout(() => globalThis.__lat.push(performance.now() - t), 0))
  }, true)
})
const snap = () => page.evaluate(() => ({ ...globalThis.__counts }))
const diff = (a, b) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, (b[k] ?? 0) - (a[k] ?? 0)]))

// taps
const before = await snap()
let selected = 0
for (let i = 0; i < TAPS; i++) {
  const id = boardNodes[i % 6].id
  const c = await nodeCenter(id)
  await page.mouse.click(c.x, c.y)
  await page.waitForTimeout(120)
  const sel = await page.evaluate(() => globalThis.__stores.canvas.getState().selectedNodeIds.join(','))
  if (sel === id) selected++
}
const tapCounts = diff(before, await snap())
const lat = await page.evaluate(() => globalThis.__lat.slice())
lat.sort((a, b) => a - b)
const q = (p) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))]

// one drag of a piece by 80px
const beforeDrag = await snap()
const dc = await nodeCenter(boardNodes[7].id)
await page.mouse.move(dc.x, dc.y); await page.mouse.down()
for (let s = 1; s <= 8; s++) { await page.mouse.move(dc.x + s * 10, dc.y + s * 5); await page.waitForTimeout(16) }
await page.mouse.up(); await page.waitForTimeout(300)
const dragCounts = diff(beforeDrag, await snap())

// Canvas <-> Categorize
async function switchTo(tab) {
  net = { requests: 0, bytes: 0, closetReads: 0 }
  const beforeSw = await snap()
  const { jsMs, frameMs, readyMs } = await page.evaluate((t) => new Promise((resolve) => {
    const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible'
    // Cheap readiness probes, so the probe itself does not cost frames on a 1,300-tile DOM.
    const ready = t === 'categorize'
      ? () => [...document.querySelectorAll('img[alt="Harness Look 1"]')].some(vis)
      : () => vis(document.querySelector('[aria-roledescription="draggable"]')) && document.querySelectorAll('[aria-roledescription="draggable"]').length >= 20
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().toLowerCase().startsWith(t))
    const start = performance.now()
    let frameMs = null
    btn.click()
    let jsMs = -1
    // React flushes a click's update in a microtask queued during the click; this one runs after it.
    queueMicrotask(() => { jsMs = performance.now() - start })
    // The frame after the switch's own render (what the stylist feels as "did it respond").
    requestAnimationFrame(() => setTimeout(() => { frameMs = performance.now() - start }, 0))
    // Until the tab's content is actually on screen (a reload shows a loading state first).
    const tick = () => (ready() && frameMs !== null ? resolve({ jsMs, frameMs, readyMs: performance.now() - start }) : requestAnimationFrame(tick))
    requestAnimationFrame(tick)
    setTimeout(() => resolve({ jsMs, frameMs: frameMs ?? -1, readyMs: -1 }), 20000)
  }), tab)
  const ms = readyMs
  await page.waitForTimeout(1500) // let background refreshes land, and count them
  return { ms: Math.round(ms), jsMs: Math.round(jsMs), frameMs: Math.round(frameMs), requests: net.requests, kb: Math.round(net.bytes / 1024), closetReads: net.closetReads, renders: diff(beforeSw, await snap()) }
}
const switches = []
for (let i = 0; i < 3; i++) {
  switches.push({ to: 'categorize', i, ...(await switchTo('categorize')) })
  switches.push({ to: 'canvas', i, ...(await switchTo('canvas')) })
}

// Back on the canvas with Categorize mounted behind it: taps must not re-render the hidden panel.
const beforeHidden = await snap()
for (let i = 0; i < 12; i++) {
  const c = await nodeCenter(boardNodes[i % 6].id)
  await page.mouse.click(c.x, c.y)
  await page.waitForTimeout(100)
}
const hiddenCounts = diff(beforeHidden, await snap())

await browser.close()
stop()

const perTap = (k) => +(((tapCounts[k] ?? 0) / TAPS).toFixed(2))
const result = {
  repo: REPO,
  commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO }).toString().trim(),
  engine: 'webkit', viewport: '1024x1366', simulatedRttMs: RTT,
  taps: TAPS, tapsThatSelected: selected,
  rendersPerTap: { closetTiles: perTap('tile'), closetPanel: perTap('closetPanel'), app: perTap('app'), chatPanel: perTap('chatPanel'), lookGallery: perTap('lookGallery') },
  rendersPer12TapsWithCategorizeMountedBehind: { categorizePanel: hiddenCounts.categorizePanel ?? 0, closetTiles: hiddenCounts.tile ?? 0, closetPanel: hiddenCounts.closetPanel ?? 0 },
  tapLatencyMs: { median: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +lat[lat.length - 1].toFixed(1), samples: lat.length },
  rendersForOneDrag: { closetTiles: dragCounts.tile ?? 0, closetPanel: dragCounts.closetPanel ?? 0, app: dragCounts.app ?? 0, chatPanel: dragCounts.chatPanel ?? 0 },
  coldClosetLoad: { ms: coldCloset.ms, requests: coldCloset.requests, kb: Math.round(coldCloset.bytes / 1024), closetReads: coldCloset.closetReads },
  switches: switches.map(({ renders, ...s }) => ({ ...s, closetTileRenders: renders.tile ?? 0 })),
  pageErrors: errors,
}
console.log(JSON.stringify(result, null, 2))
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(result, null, 2))

if (ASSERT) {
  const fails = []
  if (selected < TAPS) fails.push(`only ${selected} of ${TAPS} taps selected their piece; the tap target is off, so nothing was measured`)
  if (lat.length < TAPS) fails.push(`only ${lat.length} latency samples for ${TAPS} taps`)
  if (result.rendersPerTap.closetTiles !== 0) fails.push(`closet tiles re-render on a board tap (${result.rendersPerTap.closetTiles} per tap)`)
  if (result.rendersPerTap.closetPanel !== 0) fails.push(`the closet panel re-renders on a board tap (${result.rendersPerTap.closetPanel} per tap)`)
  if (result.rendersForOneDrag.closetTiles !== 0) fails.push(`closet tiles re-render on a board drag (${result.rendersForOneDrag.closetTiles})`)
  const later = result.switches.filter((s) => s.i > 0)
  if (later.some((s) => s.closetReads > 0)) fails.push(`a Canvas <-> Categorize switch re-reads the closet (${later.map((s) => s.closetReads).join(',')})`)
  if (later.some((s) => s.ms < 0)) fails.push('a tab switch never became ready')
  const hid = result.rendersPer12TapsWithCategorizeMountedBehind
  if (hid.categorizePanel || hid.closetTiles) fails.push(`with Categorize mounted behind the canvas, 12 taps re-rendered it ${hid.categorizePanel}x and the closet tiles ${hid.closetTiles}x`)
  if (errors.length) fails.push(`${errors.length} page error(s): ${errors.slice(0, 3).join(' | ')}`)
  console.error(fails.length ? `FAIL (${fails.length}):\n  - ${fails.join('\n  - ')}` : `PASS - ${TAPS} taps measured: 0 closet re-renders per tap and per drag, no closet re-read on a tab switch, 0 page errors (WebKit 1024x1366).`)
  process.exit(fails.length ? 1 : 0)
}
