#!/usr/bin/env node
/**
 * Guard: a tab left open across a deploy reloads ONCE when a lazy chunk is gone, never in a loop.
 *
 * Checked:
 *   1. src/main.tsx installs the handler before rendering.
 *   2. installChunkReload, driven by a fake window firing `vite:preloadError`:
 *        - first failure reloads (and prevents Vite's rethrow)
 *        - a second failure right after does NOT reload (loop guard)
 *        - once the guard window has passed, a later deploy reloads again
 *        - no sessionStorage (private mode / blocked) means no reload at all
 *   3. If a build exists, the shipped bundle still listens for vite:preloadError.
 *
 * Reports the count exercised; exits non-zero at zero. ROOT=<dir> runs it on another tree.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(process.env.ROOT ?? '.')
const failures = []
let checked = 0
const ok = (name, cond, why) => { checked++; if (!cond) failures.push(`${name}: ${why}`) }

const main = existsSync(join(ROOT, 'src/main.tsx')) ? readFileSync(join(ROOT, 'src/main.tsx'), 'utf8') : ''
const installAt = main.search(/^installChunkReload\(\)/m)
ok('main.tsx installs the handler', installAt !== -1, 'no installChunkReload() in src/main.tsx: an old tab fails silently after a deploy')
ok('installed before render', installAt !== -1 && installAt < main.indexOf('createRoot('), 'installed after render; an early lazy import could miss it')

const lib = join(ROOT, 'src/lib/chunkReload.ts')
let mod = null
if (existsSync(lib)) {
  try { mod = await import(pathToFileURL(lib).href) } catch (e) { failures.push(`import chunkReload.ts: ${e.message}`) }
}
ok('handler module exists', !!mod?.installChunkReload, 'src/lib/chunkReload.ts#installChunkReload not found')

if (mod?.installChunkReload) {
  const run = ({ storage, events, gapMs = 0 }) => {
    const listeners = []
    let reloads = 0, prevented = 0
    const realNow = Date.now
    let t = 1_800_000_000_000
    Date.now = () => t
    try {
      const win = {
        addEventListener: (type, fn) => { if (type === 'vite:preloadError') listeners.push(fn) },
        get sessionStorage() { if (storage === 'throws') throw new Error('SecurityError'); return storage },
        location: { reload: () => { reloads++ } },
      }
      mod.installChunkReload(win)
      for (let i = 0; i < events; i++) {
        for (const fn of listeners) fn({ preventDefault: () => { prevented++ } })
        t += gapMs
      }
    } finally { Date.now = realNow }
    return { listeners: listeners.length, reloads, prevented }
  }
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) } }

  const one = run({ storage: mem(), events: 1 })
  ok('listens for vite:preloadError', one.listeners === 1, `registered ${one.listeners} listener(s)`)
  ok('first failure reloads once', one.reloads === 1 && one.prevented === 1, `reloads=${one.reloads} prevented=${one.prevented}`)
  const loop = run({ storage: mem(), events: 5, gapMs: 1000 })
  ok('repeat failures do not loop', loop.reloads === 1, `5 failures 1s apart reloaded ${loop.reloads} times`)
  const later = run({ storage: mem(), events: 2, gapMs: (mod.RELOAD_WINDOW_MS ?? 0) + 1000 })
  ok('a later deploy reloads again', later.reloads === 2, `two failures past the window reloaded ${later.reloads} times`)
  const blocked = run({ storage: 'throws', events: 3 })
  ok('no storage, no reload', blocked.reloads === 0, `without sessionStorage it reloaded ${blocked.reloads} times (unguarded loop)`)
  const missing = run({ storage: null, events: 3 })
  ok('null storage, no reload', missing.reloads === 0, `reloaded ${missing.reloads} times`)
}

// Built bundle, when present: the listener survived minification.
const dist = join(ROOT, 'dist')
if (existsSync(dist)) {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])
  const js = walk(dist).filter((f) => f.endsWith('.js'))
  ok('built bundle listens for vite:preloadError', js.some((f) => readFileSync(f, 'utf8').includes('vite:preloadError')),
    `none of ${js.length} built JS files mention vite:preloadError`)
}

console.log(`check-chunk-reload: ${checked} checks exercised`)
if (checked === 0) { console.error('FAIL - exercised nothing'); process.exit(1) }
if (failures.length) {
  console.error(`FAIL - ${failures.length} of ${checked}:`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('PASS - a tab left open across a deploy reloads once when a chunk is gone, and never loops.')
