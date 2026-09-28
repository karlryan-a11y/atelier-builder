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
const SHOT = arg('--shot', null)      // write a WebKit screenshot of the closet rail and exit
const SELECT_SHOT = arg('--select-shot', null)   // drive Categorize's card checkbox and exit
const HIDE_SHOT = arg('--hide-shot', null)       // hide a piece on the board and exit (ADR-0146)
const FILING_SHOT = arg('--filing-shot', null)   // drive the Save box's categories and exit (ADR-0149)
const SEARCH_SHOT = arg('--search-shot', null)   // drive Categorize's look search and exit (ADR-0150)
const DESC_SHOT = arg('--desc-shot', null)       // drive the piece description + search and exit (ADR-0151)
const STEADY = args.includes('--steady-board')   // the board must not move when she selects something, and exit
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
// The rail's chips come from the pieces' own categories. A realistic HEAVY client, because that
// is where the chips cost room: Danielle York carries 50 and Barbie 53 (measured 2026-09-23),
// against a median of 14. ADR-0144 exists because a fixture of six hid that entirely.
const HEAVY_CATEGORIES = [
  '49ers', 'band-tees', 'belts', 'bodysuits', 'bolero', 'boots', 'bracelets', 'briefs',
  'brooches', 'button-downs', 'coats', 'cropped', 'denim', 'dresses', 'earrings', 'flats',
  'gloves', 'graphic-tees', 'handbags', 'hats', 'heel', 'high-top-sneakers', 'jackets',
  'jewelry', 'jumpsuits', 'longsleeves', 'missing', 'necklaces', 'newly-added', 'outerwear',
  'pants', 'pendants', 'question-mark', 'rings', 'sandals', 'scarves', 'sets', 'shoes',
  'shorts', 'shortsleeves', 'skirts', 'sleeveless', 'sneakers', 'socks', 'sweaters',
  'sweatshirts', 'tights', 'time-pieces', 'tops', 'vests',
]
const hex = (n) => n.toString(16).padStart(24, '0')
const FILLER = 'x'.repeat(2400)
const items = Array.from({ length: N_ITEMS }, (_, i) => ({
  id: hex(0xa0000 + i), client_id: CLIENT.id, name: `Piece ${i + 1}`, name_override: null,
  style_note: i === 5 ? 'she hates the neckline, keep for resale' : (i % 17 === 0 ? 'wear with heels' : null),
  category: HEAVY_CATEGORIES[i % HEAVY_CATEGORIES.length], custom_categories: i % 9 === 0 ? ['travel'] : [],
  // ADR-0151: one piece carries the word only in its DESCRIPTION and one only in the TEAM note,
  // so the two audiences can be told apart by what they can find.
  description: i === 3 ? 'Whiskey houndstooth wool, three-quarter sleeve, ruffled hem at mid-calf' : null,
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
  // Half published: a real client has both, and the canvas rail's styled marks (ADR-0134) have
  // three states to show. Does not affect any render count this harness asserts on.
  published: i % 2 === 0, archived: false, sort_order: null,
  closet_item_ids: boardNodes.slice(0, 6 + (i % 7)).map((n) => n.closet_item_id),
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
// ADR-0149: where a look is FILED. Harness Look 1 sits in Office and Travel, so the Save box has
// something real to open with and something real to take away.
const assignments = [
  { look_id: looks[0].id, category_id: cats[0].id },   // Office
  { look_id: looks[0].id, category_id: cats[2].id },   // Travel
]
const TABLES = { gp_closet_items: items, gp_content_tags: TAGS, gp_looks: looks, looks, gp_boards: boards, look_categories: cats, look_category_assignments: assignments }

/** Every write the app made, in order. Filled by handleRest; read by --filing-shot. */
const writes = []

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
function handleRest(url, method, headers, body) {
  const table = url.pathname.split('/').pop()
  const rows = TABLES[table] ?? []
  // WRITES. The mock used to answer every non-GET with `[]`, which meant a save returned no row
  // and nothing downstream of it could be driven at all. It now applies the write and echoes it,
  // the way PostgREST does with `return=representation`, and records it for the assertions.
  if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
    let parsed = null
    try { parsed = body ? JSON.parse(body) : null } catch { /* not JSON */ }
    const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
    const eqOf = (k) => { const v = url.searchParams.get(k); return v?.startsWith('eq.') ? v.slice(3) : null }
    if (method === 'DELETE') {
      const keep = rows.filter((r) => {
        for (const [k, v] of url.searchParams) {
          if (['select', 'order', 'offset', 'limit', 'columns', 'on_conflict'].includes(k)) continue
          if (!matches(r, k, v)) return true      // not matched by the filter: keep it
        }
        return false
      })
      const removed = rows.length - keep.length
      if (TABLES[table]) TABLES[table].splice(0, rows.length, ...keep)
      writes.push({ table, method, removed, query: url.search })
    } else {
      for (const r of list) {
        const idKey = 'id' in r ? 'id' : null
        const i = idKey ? rows.findIndex((x) => x[idKey] === r[idKey])
          : rows.findIndex((x) => x.look_id === r.look_id && x.category_id === r.category_id)
        if (i >= 0) rows[i] = { ...rows[i], ...r }
        else if (method === 'POST') rows.push({ ...r })
        else { const j = rows.findIndex((x) => x.id === eqOf('id')); if (j >= 0) rows[j] = { ...rows[j], ...r } }
      }
      writes.push({ table, method, rows: list.length, ids: list.map((r) => r.id ?? `${r.look_id}:${r.category_id}`) })
    }
    const h = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }
    const echo = method === 'DELETE' ? [] : list.map((r) => ({ ...(rows.find((x) => x.id === r.id) ?? r) }))
    if (/vnd\.pgrst\.object/.test(headers.accept ?? '')) return { status: 200, headers: h, body: JSON.stringify(echo[0] ?? null) }
    return { status: 200, headers: h, body: JSON.stringify(echo) }
  }
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
    else if (url.pathname.startsWith('/rest/v1/')) res = handleRest(url, r.method(), headers, r.postData())
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

async function nodeCenterOf(id) {
  return page.evaluate((nid) => {
    const st = globalThis.__Konva.stages.find((s) => s.findOne('#' + nid))
    const kn = st?.findOne('#' + nid)
    if (!kn) return null
    const r = kn.getClientRect()
    const c = st.container().getBoundingClientRect()
    return { x: c.left + r.x + r.width / 2, y: c.top + r.y + r.height / 2 }
  }, id)
}

await page.goto(`http://localhost:${PORT}/`)
await page.waitForFunction(() => !!globalThis.__stores && !!document.querySelector('button') && [...document.querySelectorAll('button')].some((b) => b.textContent?.trim().toLowerCase() === 'categorize'), null, { timeout: 30000 })

// A picture of the rail, for a change that is meant to be LOOKED at (ADR-0134). Real WebKit at
// the iPad size the stylists work on, so what lands here is what Paige would see.
if (SHOT) {
  await page.evaluate((c) => globalThis.__stores.client.getState().setActiveClient(c), CLIENT)
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-roledescription="draggable"]')].filter((el) => el.getClientRects().length).length >= 8, null, { timeout: 60000 })
  await page.waitForTimeout(3000)   // let the look-usage read land so the marks are on screen
  const rail = await page.$('.w-72')
  await (rail ?? page).screenshot({ path: SHOT })
  // ADR-0144: on a heavy client the chips must not push the pieces off the bottom of the rail.
  // Paige Berndt, 2026-09-23, on Danielle York: "I am unable to see pieces ... except for a tiny
  // sliver of them in the corner". Measure what is actually on screen, in pixels.
  const railView = () => page.evaluate(() => {
    const rail = document.querySelector('.w-72')
    if (!rail) return null
    const r = rail.getBoundingClientRect()
    const tiles = [...rail.querySelectorAll('[aria-roledescription="draggable"]')]
    const visible = tiles.filter((t) => {
      const b = t.getBoundingClientRect()
      return b.top < r.bottom && b.bottom > r.top && b.height > 0
    })
    const chips = rail.querySelector('.flex.flex-wrap')
    const toggle = [...rail.querySelectorAll('button')].find((b) => /categories/i.test(b.textContent ?? ''))
    return {
      chipPx: chips ? Math.round(chips.getBoundingClientRect().height) : 0,
      chips: chips ? chips.querySelectorAll('button').length : 0,
      tilesFullyVisible: visible.filter((t) => {
        const b = t.getBoundingClientRect()
        return b.top >= r.top && b.bottom <= r.bottom
      }).length,
      toggleText: toggle?.textContent?.trim() ?? null,
      expanded: toggle?.getAttribute('aria-expanded') ?? null,
    }
  })
  const collapsed = await railView()
  console.log(`\n  heavy client (${collapsed.chips - 1} categories):`)
  console.log(`    collapsed: chips ${collapsed.chipPx}px, ${collapsed.tilesFullyVisible} piece tiles fully visible, toggle "${collapsed.toggleText}"`)
  if (collapsed.toggleText) {
    const btn = [...(await page.$$('.w-72 button'))]
    for (const b of btn) { if (/show all/i.test((await b.textContent()) ?? '')) { await b.click(); break } }
    await page.waitForTimeout(600)
    const opened = await railView()
    console.log(`    expanded:  chips ${opened.chipPx}px, ${opened.tilesFullyVisible} piece tiles fully visible, toggle "${opened.toggleText}"`)
    for (const b of [...(await page.$$('.w-72 button'))]) { if (/collapse/i.test((await b.textContent()) ?? '')) { await b.click(); break } }
    await page.waitForTimeout(600)
    const reclosed = await railView()
    console.log(`    re-collapsed: chips ${reclosed.chipPx}px, ${reclosed.tilesFullyVisible} tiles fully visible`)
    if (collapsed.tilesFullyVisible < 2) { console.error('FAIL - the pieces are a sliver even collapsed'); await browser.close(); server.kill(); process.exit(1) }
    if (opened.chipPx <= collapsed.chipPx) { console.error('FAIL - "Show all" did not open the chips out'); await browser.close(); server.kill(); process.exit(1) }
    if (reclosed.chipPx !== collapsed.chipPx) { console.error('FAIL - collapsing did not put it back'); await browser.close(); server.kill(); process.exit(1) }
  } else {
    console.error('FAIL - no collapse toggle on a 50-category client'); await browser.close(); server.kill(); process.exit(1)
  }

  const marks = await page.evaluate(() => {
    const rail = document.querySelector('.w-72')
    const dots = [...(rail?.querySelectorAll('[title]') ?? [])].map((e) => e.getAttribute('title'))
    return {
      styled: dots.filter((t) => t?.startsWith('Styled')).length,
      draft: dots.filter((t) => t?.startsWith('In a draft')).length,
      tiles: rail?.querySelectorAll('[aria-roledescription="draggable"]').length ?? 0,
    }
  })
  console.log(`\nshot: ${SHOT} — ${marks.tiles} tiles on screen, ${marks.styled} marked styled, ${marks.draft} marked draft`)

  // And the filter she will actually press: "Still to style" must remove exactly the marked ones.
  const before = marks.tiles
  await page.click('button[aria-pressed="false"]:has-text("Still to style")')
  await page.waitForTimeout(600)
  const after = await page.evaluate(() => document.querySelector('.w-72')?.querySelectorAll('[aria-roledescription="draggable"]').length ?? 0)
  const stillMarked = await page.evaluate(() => {
    const rail = document.querySelector('.w-72')
    return [...(rail?.querySelectorAll('[title]') ?? [])].filter((e) => /^(Styled|In a draft)/.test(e.getAttribute('title') ?? '')).length
  })
  console.log(`      still to style: ${before} tiles -> ${after}, and ${stillMarked} of them carry a styled mark (must be 0)`)
  if (stillMarked !== 0 || after !== before - marks.styled - marks.draft) {
    console.error('FAIL — the Still to style filter did not leave exactly the unstyled pieces')
    await browser.close(); server.kill(); process.exit(1)
  }
  await browser.close()
  server.kill()
  process.exit(0)
}

// ADR-0137: picking ONE look must be a plain click on its checkbox, with no shift key, on the
// card grid she actually uses. Driven in real WebKit rather than asserted about the source.
if (SELECT_SHOT) {
  await page.evaluate((c) => globalThis.__stores.client.getState().setActiveClient(c), CLIENT)
  const cat = [...(await page.$$('button'))]
  for (const b of cat) {
    const t = (await b.textContent())?.trim().toLowerCase()
    if (t === 'categorize') { await b.click(); break }
  }
  await page.waitForSelector('img[alt="Harness Look 1"]', { timeout: 60000 })
  await page.waitForTimeout(1500)

  const selectedCount = () => page.evaluate(() =>
    [...document.querySelectorAll('[role="checkbox"]')].filter((e) => e.getAttribute('aria-checked') === 'true').length)
  const boxes = await page.$$('[role="checkbox"]')
  console.log(`\n  checkboxes on screen: ${boxes.length}`)
  if (boxes.length === 0) { console.error('FAIL - no card checkbox rendered'); await browser.close(); server.kill(); process.exit(1) }

  const before = await selectedCount()
  await boxes[0].click()          // a PLAIN click, no shift
  await page.waitForTimeout(400)
  const afterOne = await selectedCount()
  await boxes[1].click()
  await page.waitForTimeout(400)
  const afterTwo = await selectedCount()
  await boxes[0].click()          // and it toggles back off
  await page.waitForTimeout(400)
  const afterToggle = await selectedCount()

  await page.screenshot({ path: SELECT_SHOT })
  console.log(`  queue grid selected: ${before} -> ${afterOne} -> ${afterTwo} -> ${afterToggle} (expect 0 -> 1 -> 2 -> 1), no shift key used`)
  let ok = before === 0 && afterOne === 1 && afterTwo === 2 && afterToggle === 1

  // ADR-0138: clicking the CARD, not the box. Cynthia: "just click anywhere on the look".
  // Clear first, then click a card's picture with nothing selected, which is the state where a
  // click used to do nothing at all.
  for (const b of await page.$$('button')) {
    if ((await b.textContent())?.trim().toLowerCase() === 'clear') { await b.click(); break }
  }
  await page.waitForTimeout(400)
  const cleared = await selectedCount()
  // A real mouse click in the middle of the picture area of a card, which is what "anywhere on
  // the look" means. Cards are found through their checkbox so each one is counted once: the tile
  // renders more than one <img> per card, and picking images gave the same card twice.
  const cardBoxes = await page.evaluate(() =>
    [...document.querySelectorAll('[role="checkbox"]')]
      .map((cb) => cb.parentElement?.getBoundingClientRect())
      .filter(Boolean)
      .map((r) => ({ x: r.x + r.width / 2, y: r.y + r.height * 0.35 })))
  const clickCard = async (i) => { await page.mouse.click(cardBoxes[i].x, cardBoxes[i].y); await page.waitForTimeout(400) }
  await clickCard(0)
  const bodyOne = await selectedCount()
  await clickCard(1)
  const bodyTwo = await selectedCount()
  await clickCard(0)
  const bodyToggle = await selectedCount()
  console.log(`  click the CARD body: ${cleared} -> ${bodyOne} -> ${bodyTwo} -> ${bodyToggle} (expect 0 -> 1 -> 2 -> 1)`)
  ok = ok && cleared === 0 && bodyOne === 1 && bodyTwo === 2 && bodyToggle === 1

  // And a button ON the card must not pick it as well. Rename is the safest to press: it opens a
  // prompt, which we dismiss.
  page.once('dialog', (d) => d.dismiss())
  const beforeBtn = await selectedCount()
  for (const b of await page.$$('button')) {
    if ((await b.textContent())?.trim().toLowerCase() === 'rename') { await b.click(); break }
  }
  await page.waitForTimeout(500)
  const afterBtn = await selectedCount()
  console.log(`  a button on the card: ${beforeBtn} -> ${afterBtn} (must not change)`)
  ok = ok && beforeBtn === afterBtn

  // THE HALF THAT MUST NOT MOVE. With Tag looks ON a card click FILES the look into the picked
  // category; it does not pick it. That is ADR-0123, the defect Cynthia reported on 2026-09-15
  // when the rail was silently re-filing looks. ADR-0138 only changed what happens with the
  // switch OFF, and this is the proof it left the other branch alone.
  for (const b of await page.$$('button')) {
    if ((await b.textContent())?.trim().toLowerCase() === 'clear') { await b.click(); break }
  }
  await page.waitForTimeout(300)
  for (const b of await page.$$('button[aria-pressed]')) {
    if (((await b.textContent()) ?? '').toLowerCase().includes('tag looks')) { await b.click(); break }
  }
  await page.waitForTimeout(400)
  for (const b of await page.$$('button')) {
    if ((await b.textContent())?.trim() === 'Office') { await b.click(); break }
  }
  await page.waitForTimeout(600)
  const tagBoxes = await page.evaluate(() =>
    [...document.querySelectorAll('[role="checkbox"]')]
      .map((cb) => cb.parentElement?.getBoundingClientRect())
      .filter(Boolean)
      .map((r) => ({ x: r.x + r.width / 2, y: r.y + r.height * 0.35 })))
  const cardText = () => page.evaluate(() => {
    const cb = document.querySelector('[role="checkbox"]')
    return cb?.parentElement?.textContent ?? ''
  })
  const textBefore = await cardText()
  const selBeforeTag = await selectedCount()
  await page.mouse.click(tagBoxes[0].x, tagBoxes[0].y)
  await page.waitForTimeout(800)
  const textAfter = await cardText()
  const selAfterTag = await selectedCount()
  const filed = !textBefore.includes('Office') && textAfter.includes('Office')
  console.log(`  tagging ON, click the card: filed into Office = ${filed}, selected ${selBeforeTag} -> ${selAfterTag} (must stay 0)`)
  ok = ok && filed && selBeforeTag === 0 && selAfterTag === 0

  // And the OTHER card grid: "On lookbook" is the sortable arrange grid, and it is the one in
  // Cynthia's screenshot. A checkbox on only one of the two is this bug again for whoever is on
  // the other.
  for (const b of await page.$$('button')) {
    const t = (await b.textContent())?.trim().toLowerCase()
    if (t && t.startsWith('on lookbook')) { await b.click(); break }
  }
  await page.waitForTimeout(1500)
  const arrangeBoxes = await page.$$('[role="checkbox"]')
  console.log(`  on-lookbook checkboxes: ${arrangeBoxes.length}`)
  let arrangeOk = arrangeBoxes.length > 0
  if (arrangeOk) {
    const b0 = await selectedCount()
    await arrangeBoxes[0].click()
    await page.waitForTimeout(400)
    const b1 = await selectedCount()
    await arrangeBoxes[0].click()
    await page.waitForTimeout(400)
    const b2 = await selectedCount()
    console.log(`  on-lookbook selected: ${b0} -> ${b1} -> ${b2} (expect 0 -> 1 -> 0)`)
    arrangeOk = b0 === 0 && b1 === 1 && b2 === 0
    await arrangeBoxes[0].click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: SELECT_SHOT.replace(/\.png$/, '-onlookbook.png') })
  }
  ok = ok && arrangeOk

  await browser.close()
  server.kill()
  if (!ok) { console.error('FAIL - a plain click does not pick exactly one look on both grids'); process.exit(1) }
  console.log('  PASS - picking one look is a click, on both card grids')
  process.exit(0)
}

// ADR-0151: one matcher, every field — and the team's note is the team's alone.
//
// Maegan Watson, 2026-09-24: "we have to be able to search houndstooth and the dress shows up."
// Driven on the real rail because the whole claim is "type a word and it finds it whichever
// field the word is in", and only the running app can answer that.
if (DESC_SHOT) {
  await page.evaluate((c) => globalThis.__stores.client.getState().setActiveClient(c), CLIENT)
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-roledescription="draggable"]')].filter((el) => el.getClientRects().length).length >= 8, null, { timeout: 60000 })

  const box = await page.$('input[placeholder="Search pieces..."]')
  const names = () => page.evaluate(() => {
    const rail = document.querySelector('input[placeholder="Search pieces..."]')?.closest('aside, div[class*="w-"]')
    const scope = rail ?? document
    return [...scope.querySelectorAll('p')].map((e) => e.textContent.trim()).filter((t) => /^Piece \d+$/.test(t))
  })
  const type = async (q) => {
    await box.click({ clickCount: 3 }); await page.keyboard.press('Backspace')
    if (q) await box.type(q, { delay: 25 })
    await page.waitForTimeout(650)
    return names()
  }

  const all = await names()
  const byName = await type('Piece 4')
  const byBrand = await type('khaite')
  const byColour = await type('ivory')
  const byCategory = await type('denim')
  const byDescription = await type('houndstooth')     // ONLY in Piece 4's description
  const byDescription2 = await type('mid-calf')
  const byInternal = await type('resale')             // ONLY in Piece 6's team note
  const nearMiss = await type('houndstooth wool zebra')
  const nothing = await type('zzzz')
  await type('')

  await page.screenshot({ path: DESC_SHOT })
  const n = (a) => a.length
  console.log(`\n  the canvas rail, ${n(all)} pieces in view:`)
  console.log(`    "Piece 4"                -> ${n(byName)}   (name)`)
  console.log(`    "khaite"                 -> ${n(byBrand)}   (brand)`)
  console.log(`    "ivory"                  -> ${n(byColour)}   (colour)`)
  console.log(`    "denim"                  -> ${n(byCategory)}   (category)`)
  console.log(`    "houndstooth"            -> ${n(byDescription)}   ${byDescription.join(', ')}   (DESCRIPTION only)`)
  console.log(`    "mid-calf"               -> ${n(byDescription2)}   ${byDescription2.join(', ')}   (description, hyphenated)`)
  console.log(`    "resale"                 -> ${n(byInternal)}   ${byInternal.join(', ')}   (TEAM note only)`)
  console.log(`    "houndstooth wool zebra" -> ${n(nearMiss)}   ${nearMiss.join(', ')}   (2 of 3 words: near)`)
  console.log(`    "zzzz"                   -> ${n(nothing)}`)

  const ok = n(all) > 20
    && n(byName) >= 1 && n(byBrand) > 0 && n(byColour) > 0 && n(byCategory) > 0
    && n(byDescription) === 1 && byDescription[0] === 'Piece 4'
    && n(byDescription2) === 1 && byDescription2[0] === 'Piece 4'
    && n(byInternal) === 1 && byInternal[0] === 'Piece 6'
    && n(nearMiss) === 1 && nearMiss[0] === 'Piece 4'
    && n(nothing) === 0
  console.log(`\n  ${ok ? 'PASS' : 'FAIL'} - a word is found whichever field it is in, and a near miss is not an empty page.\n`)
  console.log(`  ${DESC_SHOT}`)
  if (errors.length) console.log(`  page errors: ${errors.length}\n${errors.map((e) => '   ' + e).join('\n')}`)
  await browser.close(); stop()
  process.exit(ok && errors.length === 0 ? 0 : 1)
}

// ADR-0150: she can find one look by name, and open it from a piece that is in it.
//
// Cynthia Dada, 2026-09-24: "Can we please add the ability to search for look names? I need to
// search for 182 and 175 ... If we can edit looks from the back end where we click on the garment
// and it shows what looks they're styled in, that would be even better."
//
// Driven rather than asserted, because "the grid narrows as I type" and "the tile opens the look"
// are both things only a real browser can answer. The fixture's 40 looks are named Harness Look 1
// to 40, which reproduces the shape of her problem exactly: typing 1, then 18, then 18 must
// narrow 40 -> 13 -> 1 (Look 1/10-19, then 18, then 18 alone at "182" has no match, so the test
// uses 1 -> 1x -> 18).
if (SEARCH_SHOT) {
  await page.evaluate((c) => globalThis.__stores.client.getState().setActiveClient(c), CLIENT)
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-roledescription="draggable"]')].filter((el) => el.getClientRects().length).length >= 8, null, { timeout: 60000 })
  await page.evaluate(() => globalThis.__stores.view.getState().setStyleTab('categorize'))
  await page.waitForTimeout(2500)

  const box = await page.$('input[aria-label="Search look names"]')
  if (!box) { console.log('\n  FAIL - no search box in Categorize.\n'); await browser.close(); stop(); process.exit(1) }

  // Left on the default QUEUE view on purpose: the 20 drafts are what a stylist actually opens
  // Categorize to work through, and the assertions below are relative, so they hold whatever the
  // status pill is set to.
  // SCOPED TO THE CATEGORIZE COLUMN. The canvas rail on the right lists all 40 looks too, and it
  // stays mounted across a tab switch on purpose (check-style-tabs-mounted). Scraping the whole
  // page therefore reads 40 whatever the grid is showing, which is how the first run of this
  // said PASS-shaped numbers for a filter that was working perfectly.
  const namesOnScreen = () => page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Search look names"]')
    const col = input?.closest('div.flex-1.flex.flex-col')
    if (!col) return []
    return [...new Set([...col.querySelectorAll('p,div,span')]
      .map((e) => e.textContent.trim())
      .filter((t) => /^Harness Look \d+$/.test(t)))]
  })

  const type = async (q) => {
    await box.click({ clickCount: 3 })
    await page.keyboard.press('Backspace')
    if (q) await box.type(q, { delay: 40 })
    await page.waitForTimeout(700)
    return namesOnScreen()
  }

  const all = await namesOnScreen()
  const one = await type('1')
  const oneEight = await type('18')
  const eighteen = await type('Harness Look 18')
  const reordered = await type('18 harness')
  void one
  const nothing = await type('zzz')
  const emptyMsg = await page.evaluate(() => {
    const el = [...document.querySelectorAll('p')].find((e) => /Nothing named/.test(e.textContent))
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : null
  })
  await type('')
  const cleared = await namesOnScreen()

  // Now the other half: Collection -> a piece -> "Styled in N looks" -> click a tile.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().toLowerCase() === 'collection')
    b?.click()
  })
  await page.waitForTimeout(3000)
  const usageBtn = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find((b) => /Styled in \d+ look|In \d+ draft look/.test(b.textContent)) ?? null)
  const hasUsage = await usageBtn.evaluate((e) => !!e)
  let modalTiles = 0, opensOnCanvas = false, replaces = null
  if (hasUsage) {
    await usageBtn.asElement().click()
    await page.waitForTimeout(900)
    modalTiles = await page.evaluate(() =>
      [...document.querySelectorAll('button')].filter((b) => /Open on canvas/.test(b.textContent)).length)
    if (modalTiles > 0) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /Open on canvas/.test(x.textContent))
        b?.click()
      })
      await page.waitForTimeout(2500)
      const st = await page.evaluate(() => {
        const c = globalThis.__stores.canvas.getState()
        return { replaces: c.replacesLookId, current: c.currentLookId, nodes: c.state.nodes.length, tab: globalThis.__stores.view.getState().styleTab }
      })
      opensOnCanvas = st.tab === 'canvas' && st.nodes > 0
      replaces = st
    }
  }
  await page.screenshot({ path: SEARCH_SHOT })

  const n = (a) => a.length
  console.log(`\n  searching the ${n(all)} looks in Categorize's queue:`)
  console.log(`    ""                  -> ${n(all)}`)
  console.log(`    "1"                 -> ${n(one)}`)
  console.log(`    "18"                -> ${n(oneEight)}  ${oneEight.join(', ')}`)
  console.log(`    "Harness Look 18"   -> ${n(eighteen)}  ${eighteen.join(', ')}`)
  console.log(`    "18 harness"        -> ${n(reordered)}  ${reordered.join(', ')}   (word order must not matter)`)
  console.log(`    "zzz"               -> ${n(nothing)}   message: ${emptyMsg ?? '(none)'}`)
  console.log(`    cleared             -> ${n(cleared)}`)
  console.log(`\n  a piece's "Styled in N looks" list: ${hasUsage ? 'found' : 'NOT FOUND'}, ${modalTiles} openable tile(s)`)
  if (replaces) console.log(`    clicked one -> tab=${replaces.tab}, ${replaces.nodes} pieces on the board, replacesLookId=${replaces.replaces ? 'set' : 'NULL'}, currentLookId=${replaces.current ?? 'null'}`)

  const ok = n(all) > 1                                  // there is a list to narrow
    && n(one) < n(all)                                   // typing narrows
    && n(oneEight) < n(one)                              // and narrows again
    && n(eighteen) === 1 && eighteen[0] === 'Harness Look 18'   // down to the one she wanted
    && n(reordered) === 1 && reordered[0] === eighteen[0]       // word order does not matter
    && n(nothing) === 0 && !!emptyMsg                    // and an empty result says WHY
    && /Clear the search/.test(emptyMsg)
    && n(cleared) === n(all)                             // clearing puts every look back
    && hasUsage && modalTiles > 0 && opensOnCanvas
    && !!replaces?.replaces && !replaces?.current      // REPLACES, does not duplicate (ADR-0148)
  console.log(`\n  ${ok ? 'PASS' : 'FAIL'} - the grid narrows as she types, and a piece's look opens on the canvas as a replacement.\n`)
  console.log(`  ${SEARCH_SHOT}`)
  if (errors.length) console.log(`  page errors: ${errors.length}\n${errors.map((e) => '   ' + e).join('\n')}`)
  await browser.close(); stop()
  process.exit(ok && errors.length === 0 ? 0 : 1)
}

// ADR-0149: the Save box's CATEGORIES pills mean the same thing as Categorize's pills.
//
// Cynthia Dada, 2026-09-24: "When I go to update, it asks me to add to a category. This look was
// already in a category but I'm not sure what. Can it just stay in the categories it was in?"
//
// Driven, not asserted from the source, because the two halves that were broken are both things
// you can only see by doing it: WHICH PILLS ARE ON when the box opens on a REBUILD, and WHICH
// TABLE the save writes to. The board is loaded as a replacement — no currentLookId, exactly the
// case she hit — of Harness Look 1, which is filed in Office and Travel.
if (FILING_SHOT) {
  await page.evaluate((c) => globalThis.__stores.client.getState().setActiveClient(c), CLIENT)
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-roledescription="draggable"]')].filter((el) => el.getClientRects().length).length >= 8, null, { timeout: 60000 })
  await page.evaluate(({ board, url, lookId, name }) => {
    const urls = Object.fromEntries(board.nodes.map((n) => [n.id, url]))
    globalThis.__stores.canvas.getState().loadLookAsReplacement(lookId, [], board, urls)
    // loadLookAsReplacement clears the reference, so set it after: this is what CategorizePanel
    // does on a real Rebuild, and it is where the look's own NAME comes from (ADR-0132).
    globalThis.__stores.canvas.getState().setRestyleReference({ lookId, lookName: name, imageUrl: null, omitted: [], notInPicture: [], fromLayout: false, covers: 1 })
  }, { board, url: PIECE_URL, lookId: looks[0].id, name: looks[0].name })
  await page.waitForTimeout(1800)

  const openSave = async () => {
    for (const b of await page.$$('button')) {
      const t = (await b.innerText().catch(() => '')) ?? ''
      if (/^(update look|save look)$/i.test(t.trim())) { await b.click(); return t.trim() }
    }
    return null
  }
  const buttonLabel = await openSave()
  await page.waitForTimeout(900)

  // What the box says, and which pills it opened with.
  // Scoped to the dialog, and to its round pills only: the app behind it has a Travel chip on the
  // closet rail and a nav full of buttons, and grabbing those would grade the wrong thing.
  const pillState = () => page.evaluate(() => {
    const dlg = [...document.querySelectorAll('div')].find((d) => d.querySelector(':scope > div > h2')?.textContent?.trim().toUpperCase() === 'SAVE LOOK')
    if (!dlg) return null
    const name = dlg.querySelector('input')?.value ?? ''
    const pills = [...dlg.querySelectorAll('button.rounded-full')]
      .map((b) => ({ label: b.textContent.trim(), on: b.className.includes('text-white') }))
    return { name, pills }
  })
  const opened = await pillState()

  const clickPill = (label) => page.evaluate((l) => {
    const dlg = [...document.querySelectorAll('div')].find((d) => d.querySelector(':scope > div > h2')?.textContent?.trim().toUpperCase() === 'SAVE LOOK')
    const b = [...(dlg?.querySelectorAll('button.rounded-full') ?? [])].find((x) => x.textContent.trim() === l)
    if (!b) return false
    b.click(); return true
  }, label)
  // Take one away, add one that was never on. Both directions, in one save.
  const unticked = await clickPill('Travel')
  const ticked = await clickPill('Evening')
  await page.waitForTimeout(300)
  const edited = await pillState()

  writes.length = 0
  await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('div')].find((d) => d.querySelector(':scope > div > h2')?.textContent?.trim().toUpperCase() === 'SAVE LOOK')
    const b = [...(dlg?.querySelectorAll('button') ?? [])].find((x) => x.textContent.trim().toUpperCase() === 'SAVE')
    b?.click()
  })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: FILING_SHOT })

  const filingWrites = writes.filter((w) => w.table === 'look_category_assignments')
  const newLookId = TABLES.looks.find((l) => l.id !== looks[0].id && l.name === opened?.name)?.id ?? null
  const filedNow = TABLES.look_category_assignments
    .filter((a) => a.look_id === (newLookId ?? looks[0].id))
    .map((a) => cats.find((c) => c.id === a.category_id)?.label)
    .sort()

  const onAtOpen = (opened?.pills ?? []).filter((p) => p.on).map((p) => p.label).sort()
  const onAtSave = (edited?.pills ?? []).filter((p) => p.on).map((p) => p.label).sort()

  console.log(`\n  the Save box on a REBUILD of "${looks[0].name}" (filed: Office, Travel):`)
  console.log(`    button says:      ${buttonLabel}`)
  console.log(`    name box:         "${opened?.name ?? '(none)'}"`)
  console.log(`    pills ON at open: ${onAtOpen.join(', ') || '(none)'}`)
  console.log(`    after unticking Travel and ticking Evening: ${onAtSave.join(', ') || '(none)'}`)
  console.log(`    writes to look_category_assignments: ${filingWrites.length ? filingWrites.map((w) => `${w.method} ${w.rows ?? w.removed}`).join(', ') : '(none)'}`)
  console.log(`    filed after save: ${filedNow.join(', ') || '(none)'}`)

  const ok = buttonLabel?.toLowerCase() === 'update look'
    && opened?.name === looks[0].name
    && onAtOpen.join(',') === 'Office,Travel'          // THE POINT: it opens with its filing on
    && unticked && ticked
    && onAtSave.join(',') === 'Evening,Office'
    && filingWrites.some((w) => w.method === 'POST')
    && filingWrites.some((w) => w.method === 'DELETE' && w.removed === 1)
    && filedNow.join(',') === 'Evening,Office'         // and the table says what the screen said
  console.log(`\n  ${ok ? 'PASS' : 'FAIL'} - the box opens with the look's filing on, and saving writes it.\n`)
  console.log(`  ${FILING_SHOT}`)
  if (errors.length) console.log(`  page errors: ${errors.length}\n${errors.map((e) => '   ' + e).join('\n')}`)
  await browser.close(); stop()
  process.exit(ok && errors.length === 0 ? 0 : 1)
}

// THE BOARD HOLDS STILL. Cynthia Dada, 2026-09-25, #watson-atelier (Loom, no audio): "Can you
// please fix this auto zoom that's happening? It messes up when I'm trying to move text." and
// "It also does it when I select garments". The zoom never changed (125% throughout); the BOARD
// did. Since 2026-09-18 (078b92c) the toolbar wraps, selecting a label or a piece adds its
// controls, the toolbar grows a row, the space under it shrinks, and the board is re-fitted to
// that space, so it shrinks under her cursor on the press and grows back when she lets go.
//
// Measured, not asserted from source: at three real screen sizes, the board's on-screen box in
// every selection state, a drag of a text label, and whether every toolbar button is reachable.
if (STEADY) {
  await page.evaluate((c) => globalThis.__stores.client.getState().setActiveClient(c), CLIENT)
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-roledescription="draggable"]')].filter((el) => el.getClientRects().length).length >= 8, null, { timeout: 60000 })
  const text = {
    id: 'tx_harness_label', type: 'text', content: 'Daytime Workshops', font_family: 'Amalfi Coast', font_size: 48,
    fill: '#1A1A1A', x: 300, y: 20, rotation: 0, z_index: 99,
  }
  const withText = { ...board, nodes: [...board.nodes, text] }
  const SIZES = [
    { name: 'MacBook Air 1440x900', width: 1440, height: 900 },
    { name: 'laptop 1280x800', width: 1280, height: 800 },
    { name: 'iPad 1024x1366', width: 1024, height: 1366 },
  ]
  const STATES = [
    { name: 'nothing selected', ids: [] },
    { name: 'a garment', ids: [boardNodes[0].id] },
    { name: 'a text label', ids: [text.id] },
    { name: 'two garments', ids: [boardNodes[0].id, boardNodes[1].id] },
    { name: 'three garments', ids: [boardNodes[0].id, boardNodes[1].id, boardNodes[2].id] },
    { name: 'a label and a garment', ids: [text.id, boardNodes[3].id] },
    { name: 'nothing selected again', ids: [] },
  ]
  const boardBox = () => page.evaluate(() => {
    const c = globalThis.__Konva.stages[0]?.container().getBoundingClientRect()
    return c ? { x: Math.round(c.left), y: Math.round(c.top), w: Math.round(c.width), h: Math.round(c.height) } : null
  })
  // Every toolbar control must be on screen and inside the toolbar, never clipped or scrolled away.
  const unreachable = () => page.evaluate(() => {
    const bar = document.querySelector('[data-canvas-toolbar]')
    if (!bar) return ['no toolbar']
    const out = []
    // The context strip's sizers are invisible and inert by design; only real controls count.
    const controls = [...bar.querySelectorAll('button, select')].filter((el) => !el.closest('[inert], [aria-hidden="true"]'))
    for (const el of controls) {
      const b = el.getBoundingClientRect()
      if (!b.width || !b.height) continue
      // the element actually hit at its centre must be itself (or inside it)
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
      if (!hit || !(hit === el || el.contains(hit))) out.push(`${el.getAttribute('title') ?? el.tagName}${hit ? ' (under ' + (hit.getAttribute('title') ?? hit.tagName + '.' + String(hit.className).slice(0, 40)) + ')' : ' (off screen)'}`)
    }
    return { controls: controls.length, out }
  })
  let fails = 0, measured = 0
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height })
    await page.evaluate(({ b, url }) => {
      const urls = Object.fromEntries(b.nodes.map((n) => [n.id, url]))
      globalThis.__stores.canvas.getState().loadLook('harness-board', b, urls)
      globalThis.__stores.canvas.getState().setSelectedNodeIds([])
    }, { b: withText, url: PIECE_URL })
    await page.waitForTimeout(900)
    const rest = await boardBox()
    console.log(`\n  ${size.name}: board ${rest?.w}x${rest?.h} at (${rest?.x}, ${rest?.y}) with nothing selected`)
    const SHOTDIR = arg('--shots', null)
    for (const st of STATES) {
      await page.evaluate((ids) => globalThis.__stores.canvas.getState().setSelectedNodeIds(ids), st.ids)
      await page.waitForTimeout(400)
      const b = await boardBox()
      const r = await unreachable()
      measured++
      const moved = !b || b.w !== rest.w || b.h !== rest.h || b.x !== rest.x || b.y !== rest.y
      const bad = moved || r.out.length > 0
      if (bad) fails++
      if (SHOTDIR) await page.screenshot({ path: `${SHOTDIR}/${size.width}x${size.height}-${st.name.replace(/\s+/g, '-')}.png` })
      console.log(`    ${bad ? 'FAIL' : 'ok  '} ${st.name.padEnd(24)} board ${b?.w}x${b?.h} at (${b?.x}, ${b?.y})${moved ? '  <- MOVED' : ''}; ${r.controls} controls, ${r.out.length} unreachable${r.out.length ? ': ' + r.out.join(', ') : ''}`)
    }
    // The thing she was doing: press a label (which selects it and grows the toolbar) and drag it.
    await page.evaluate(() => globalThis.__stores.canvas.getState().setSelectedNodeIds([]))
    await page.waitForTimeout(400)
    const start = await nodeCenterOf(text.id)
    const before = await page.evaluate((id) => globalThis.__stores.canvas.getState().state.nodes.find((n) => n.id === id), text.id)
    const scale = rest.w / withText.canvas.width
    await page.mouse.move(start.x, start.y); await page.mouse.down()
    for (let s = 1; s <= 10; s++) { await page.mouse.move(start.x + s * 6, start.y + s * 3); await page.waitForTimeout(20) }
    await page.mouse.up(); await page.waitForTimeout(400)
    const after = await page.evaluate((id) => globalThis.__stores.canvas.getState().state.nodes.find((n) => n.id === id), text.id)
    const dx = Math.round((after.x - before.x) * scale), dy = Math.round((after.y - before.y) * scale)
    const b = await boardBox()
    measured++
    // Her hand moved 60,30 on screen; the label must follow it to within a couple of pixels.
    const dragBad = Math.abs(dx - 60) > 3 || Math.abs(dy - 30) > 3 || b.w !== rest.w || b.y !== rest.y
    if (dragBad) fails++
    console.log(`    ${dragBad ? 'FAIL' : 'ok  '} drag a label 60,30 on screen  it moved ${dx},${dy}; board after ${b.w}x${b.h} at (${b.x}, ${b.y})`)
  }
  await browser.close(); server.kill()
  if (measured === 0) { console.error('FAIL - measured nothing'); process.exit(1) }
  if (fails || errors.length) { console.error(`FAIL - ${fails} of ${measured} measurements moved the board or hid a control; ${errors.length} page errors`); process.exit(1) }
  console.log(`\n  PASS - ${measured} measurements across ${SIZES.length} screen sizes: the board never moved and every toolbar control was reachable (WebKit)`)
  process.exit(0)
}

// ADR-0146: hiding a piece takes it OFF the board and leaves it IN the look. Driven rather than
// asserted, because the value is entirely in the second half: the client must still see the piece
// under "Pieces in this look" and still be able to shop it.
if (HIDE_SHOT) {
  await page.evaluate((c) => globalThis.__stores.client.getState().setActiveClient(c), CLIENT)
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-roledescription="draggable"]')].filter((el) => el.getClientRects().length).length >= 8, null, { timeout: 60000 })
  await page.evaluate(({ board, url }) => {
    const urls = Object.fromEntries(board.nodes.map((n) => [n.id, url]))
    globalThis.__stores.canvas.getState().loadLook('harness-board', board, urls)
  }, { board, url: PIECE_URL })
  await page.waitForTimeout(1500)

  const shape = () => page.evaluate(() => {
    const st = globalThis.__stores.canvas.getState()
    const nodes = st.state.nodes
    const stage = globalThis.__Konva.stages[0]
    return {
      nodes: nodes.length,
      hidden: nodes.filter((n) => n.type === 'closet_item' && n.hidden).length,
      // what the look would be saved WITH: the same derivation hooks/useLooks.ts uses
      linkedPieces: new Set(nodes.filter((n) => n.type === 'closet_item').map((n) => n.closet_item_id)).size,
      drawn: stage ? stage.find('Image').filter((k) => k.isVisible()).length : -1,
      panelRows: document.querySelectorAll('.w-52 .flex.items-center.gap-2.p-1\\.5').length,
    }
  })

  const before = await shape()
  // select the first piece on the board, then press Hide
  const first = await page.evaluate(() => {
    const st = globalThis.__stores.canvas.getState()
    const n = st.state.nodes.find((x) => x.type === 'closet_item')
    st.setSelectedNodeIds([n.id]); return n.id
  })
  await page.waitForTimeout(500)
  let pressed = false
  // :not([inert] *) - the toolbar's context strip holds invisible, inert copies of every control
  // to reserve its height; only the real one can be pressed.
  for (const b of await page.$$('button:not([inert] *)')) {
    if (/hide on the board/i.test((await b.getAttribute('title')) ?? '')) { await b.click(); pressed = true; break }
  }
  await page.waitForTimeout(800)
  const after = await shape()

  // and back again, from the In this look panel
  let restored = null
  for (const b of await page.$$('button')) {
    if (/show .* on the board again/i.test((await b.getAttribute('aria-label')) ?? '')) { await b.click(); break }
  }
  await page.waitForTimeout(800)
  restored = await shape()

  // Does `hidden` survive being saved and reopened? canvas_state is stored as JSON and loaded
  // back whole, so this round-trips the board through exactly that to be sure the flag is not
  // quietly dropped somewhere between the store and the page.
  const roundTrip = await page.evaluate(() => {
    const st = globalThis.__stores.canvas.getState()
    const n = st.state.nodes.find((x) => x.type === 'closet_item')
    st.updateNode(n.id, { hidden: true })
    const saved = JSON.parse(JSON.stringify(globalThis.__stores.canvas.getState().state))
    const urls = Object.fromEntries(saved.nodes.map((x) => [x.id, '/__harness/piece.png']))
    globalThis.__stores.canvas.getState().loadLook('harness-board', saved, urls)
    const back = globalThis.__stores.canvas.getState().state.nodes
    return { savedHidden: saved.nodes.filter((x) => x.hidden).length, reopenedHidden: back.filter((x) => x.hidden).length }
  })
  await page.waitForTimeout(600)

  await page.screenshot({ path: HIDE_SHOT })
  console.log(`\n  hide a piece (node ${first.slice(0, 10)}):`)
  console.log(`    before: ${before.drawn} images drawn, ${before.linkedPieces} pieces linked to the look, ${before.hidden} hidden`)
  console.log(`    after:  ${after.drawn} images drawn, ${after.linkedPieces} pieces linked to the look, ${after.hidden} hidden`)
  console.log(`    back:   ${restored.drawn} images drawn, ${restored.linkedPieces} pieces linked to the look, ${restored.hidden} hidden`)
  console.log(`    saved and reopened: ${roundTrip.savedHidden} hidden in canvas_state, ${roundTrip.reopenedHidden} after reload`)
  const ok = pressed
    && roundTrip.savedHidden === 1 && roundTrip.reopenedHidden === 1
    && after.drawn === before.drawn - 1
    && after.linkedPieces === before.linkedPieces     // THE POINT: the link survives
    && after.hidden === 1
    && restored.drawn === before.drawn && restored.hidden === 0
  await browser.close(); server.kill()
  if (!ok) { console.error('FAIL - hiding did not take it off the board while leaving it in the look'); process.exit(1) }
  console.log('  PASS - off the board, still in the look, and it comes back')
  process.exit(0)
}

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
