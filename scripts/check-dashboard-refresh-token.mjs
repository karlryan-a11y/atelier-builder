#!/usr/bin/env node
// Proves the builder never stores or uses the DASHBOARD's refresh token, and signs out locally.
//
// Why: the dashboard's /api/auth/session handed the builder its refresh token; both apps then
// refreshed one Supabase session family and Supabase revoked it (18 fully revoked sessions in 21
// days = the surprise logouts / white login page). See src/lib/dashboardBridge.ts.
//
// How: this is not a text grep. It loads the REAL src/hooks/useAuth.ts, src/lib/supabase.ts and
// src/lib/authHeader.ts through Vite's SSR loader, with the REAL supabase-js, in a fake browser
// (window, document, localStorage). The network is fake: a dashboard endpoint that (like the old
// dashboard) still offers its refresh token, and a Supabase that records every refresh token it is
// sent. Each scenario runs in its own child process so each gets a fresh client.
//
//   node scripts/check-dashboard-refresh-token.mjs                 # checks this checkout
//   node scripts/check-dashboard-refresh-token.mjs --root <dir>    # checks another source tree
//
// Exits non-zero on any failed assertion, and when zero assertions ran.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const args = process.argv.slice(2)
const rootArg = args.includes('--root') ? path.resolve(args[args.indexOf('--root') + 1]) : REPO
const scenarioArg = args.includes('--scenario') ? args[args.indexOf('--scenario') + 1] : null

const DASH_RT = 'DASH-REFRESH-TOKEN-must-never-leave-the-dashboard'
const SUPA = 'https://testref.supabase.co'
const SID_DASH = '11111111-1111-4111-8111-111111111111'
const SID_OWN = '22222222-2222-4222-8222-222222222222'
const USER = { id: 'u-1', email: 'stylist@example.com', aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: { provider: 'email' } }
const SCENARIOS = ['adopt', 'refresh-near-expiry', 'migrate-old-copy', 'own-session-untouched', 'signout-local']

function b64u(o) { return Buffer.from(JSON.stringify(o)).toString('base64url') }
function jwt(sid, ttl, tag) {
  const now = Math.floor(Date.now() / 1000)
  return `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: USER.id, email: USER.email, role: 'authenticated', aud: 'authenticated', session_id: sid, exp: now + ttl, iat: now, tag })}.sig`
}

// ---------------------------------------------------------------- parent: run every scenario
if (!scenarioArg) {
  let passed = 0, failed = 0
  for (const s of SCENARIOS) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--root', rootArg, '--scenario', s], { encoding: 'utf8', timeout: 60000 })
    const out = (r.stdout || '') + (r.stderr || '')
    const lines = out.split('\n').filter((l) => l.startsWith('PASS') || l.startsWith('FAIL'))
    for (const l of lines) { console.log(`[${s}] ${l}`); l.startsWith('PASS') ? passed++ : failed++ }
    if (r.status !== 0 && !lines.some((l) => l.startsWith('FAIL'))) {
      failed++
      console.log(`[${s}] FAIL scenario crashed (exit ${r.status}):\n${out.split('\n').slice(-15).join('\n')}`)
    }
  }
  console.log(`\ncheck-dashboard-refresh-token: ${passed} passed, ${failed} failed, ${SCENARIOS.length} scenarios, root=${rootArg}`)
  if (passed + failed === 0) { console.log('FAIL: zero assertions ran'); process.exit(1) }
  process.exit(failed ? 1 : 0)
}

// ---------------------------------------------------------------- child: one scenario
const results = []
const check = (ok, msg) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`) }

// Fake browser.
const store = new Map()
const localStorageFake = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size },
}
Object.defineProperty(globalThis, 'localStorage', { value: localStorageFake, configurable: true, writable: true })
globalThis.window = globalThis
globalThis.document = { visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} }
globalThis.addEventListener = () => {}
globalThis.removeEventListener = () => {}
delete globalThis.BroadcastChannel

// Fake network.
const net = { refreshTokensSent: [], logout: [], sessionCalls: 0 }
let dashboardToken = jwt(SID_DASH, 3600, 'dash-1')
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  if (url === '/api/auth/session') {
    net.sessionCalls++
    // Deliberately behaves like the OLD dashboard: offers its refresh token too.
    return json(200, { access_token: dashboardToken, refresh_token: DASH_RT, user: USER })
  }
  if (url.startsWith(`${SUPA}/auth/v1/user`)) return json(200, USER)
  if (url.startsWith(`${SUPA}/auth/v1/token`) && url.includes('grant_type=refresh_token')) {
    const rt = JSON.parse(init.body).refresh_token
    net.refreshTokensSent.push(rt)
    return json(200, { access_token: jwt(SID_OWN, 3600, 'own-2'), refresh_token: 'OWN-RT-ROTATED', token_type: 'bearer', expires_in: 3600, user: USER })
  }
  if (url.startsWith(`${SUPA}/auth/v1/logout`)) { net.logout.push(url); return new Response(null, { status: 204 }) }
  if (url.startsWith(`${SUPA}/rest/v1/users`)) return json(200, { id: USER.id, email: USER.email, display_name: 'Stylist', role: 'stylist' })
  return json(404, { error: `unmocked ${url}` })
}

const STORAGE_KEY = 'sb-testref-auth-token'
const seed = (access, refresh, ttl) => store.set(STORAGE_KEY, JSON.stringify({
  access_token: access, refresh_token: refresh, token_type: 'bearer', expires_in: ttl,
  expires_at: Math.floor(Date.now() / 1000) + ttl, user: USER,
}))
const stored = () => store.get(STORAGE_KEY) || ''

// Load the real source through Vite (import.meta.env, '@/'); React is a tiny shim so the hook's
// effect runs once, synchronously, like a mount.
process.env.VITE_SUPABASE_URL = SUPA
process.env.VITE_SUPABASE_ANON_KEY = 'anon-test-key'
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-auth-check-'))
const shim = path.join(tmp, 'react-shim.mjs')
fs.writeFileSync(shim, `
export function useState(init) { let v = typeof init === 'function' ? init() : init; return [v, (n) => { v = typeof n === 'function' ? n(v) : n }] }
export function useRef(v) { return { current: v } }
export function useEffect(fn) { fn() }
export default { useState, useRef, useEffect }
`)
const { createServer } = await import(path.join(REPO, 'node_modules/vite/dist/node/index.js'))
const vite = await createServer({
  root: rootArg, configFile: false, envDir: tmp, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
  resolve: { alias: [{ find: /^react$/, replacement: shim }, { find: /^@\//, replacement: path.join(rootArg, 'src') + '/' }] },
  ssr: { noExternal: [], optimizeDeps: { noDiscovery: true, include: [] } },
  optimizeDeps: { noDiscovery: true, include: [], entries: [] },
  cacheDir: path.join(tmp, 'vite-cache'),
})
const load = (p) => vite.ssrLoadModule(path.join(rootArg, p))
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms))
const scenario = scenarioArg

try {
  if (scenario === 'migrate-old-copy') seed(jwt(SID_DASH, 5, 'old-copy'), DASH_RT, 5)
  if (scenario === 'own-session-untouched') seed(jwt(SID_OWN, 5, 'own-1'), 'OWN-RT-1', 5)

  const { supabase } = await load('src/lib/supabase.ts')
  const { useAuth } = await load('src/hooks/useAuth.ts')
  const { authHeader } = await load('src/lib/authHeader.ts')
  const auth = useAuth()
  await settle()

  if (scenario === 'adopt') {
    check(net.sessionCalls >= 1, `builder asked the dashboard endpoint (${net.sessionCalls} call(s))`)
    check(stored().includes(dashboardToken), 'adopted session holds the dashboard ACCESS token')
    check(!stored().includes(DASH_RT), 'stored session does NOT contain the dashboard refresh token')
    const h = await authHeader()
    check(h.Authorization === `Bearer ${dashboardToken}`, 'authHeader() returns the adopted access token for api/* calls')
  }

  if (scenario === 'refresh-near-expiry') {
    // Age the adopted session to 10 s left; the dashboard has meanwhile rotated to a new token.
    const s = JSON.parse(stored() || '{}')
    s.expires_at = Math.floor(Date.now() / 1000) + 10
    store.set(STORAGE_KEY, JSON.stringify(s))
    dashboardToken = jwt(SID_DASH, 3600, 'dash-2')
    const { data } = await supabase.auth.getSession()
    await settle(200)
    check(!net.refreshTokensSent.includes(DASH_RT), `dashboard refresh token never sent to Supabase (refresh tokens sent: ${JSON.stringify(net.refreshTokensSent)})`)
    check(data.session?.access_token === dashboardToken, 'near expiry the builder re-asked the dashboard and got its NEW access token')
    check(!stored().includes(DASH_RT), 'stored session still has no dashboard refresh token')
    const h = await authHeader()
    check(h.Authorization === `Bearer ${dashboardToken}`, 'authHeader() carries the refreshed access token')
  }

  if (scenario === 'migrate-old-copy') {
    // A device that adopted before the fix: storage holds the dashboard's real refresh token.
    await supabase.auth.getSession()
    await settle(300)
    check(!net.refreshTokensSent.includes(DASH_RT), `stored pre-fix copy of the dashboard refresh token was NOT sent to Supabase (sent: ${JSON.stringify(net.refreshTokensSent)})`)
    check(!stored().includes(DASH_RT), 'pre-fix copy replaced in storage')
  }

  if (scenario === 'own-session-untouched') {
    // Signed in on the builder's own form: a different session family; refresh must go to Supabase.
    await supabase.auth.getSession()
    await settle(300)
    check(net.refreshTokensSent.includes('OWN-RT-1'), `builder's own session still refreshes with Supabase (sent: ${JSON.stringify(net.refreshTokensSent)})`)
  }

  if (scenario === 'signout-local') {
    await auth.signOut()
    await settle(100)
    check(net.logout.length === 1, `one logout request (${net.logout.length})`)
    check(net.logout.every((u) => u.includes('scope=local')), `builder signOut is scope=local (${net.logout.join(', ')})`)
  }
} catch (e) {
  check(false, `scenario threw: ${e?.stack || e}`)
} finally {
  await vite.close().catch(() => {})
  fs.rmSync(tmp, { recursive: true, force: true })
}
if (results.length === 0) { console.log('FAIL zero assertions in scenario'); process.exit(1) }
process.exit(results.every(Boolean) ? 0 : 1)
