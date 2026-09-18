#!/usr/bin/env node
/**
 * Guard: the Digitize screen does not poll the database from a hidden tab, and does not leak
 * a photo's memory on every render.
 *
 * Checked:
 *   1. No raw setInterval anywhere under src/components/intake: every timer goes through
 *      setVisibleInterval (src/lib/visibleInterval.ts). Reports how many it found.
 *   2. setVisibleInterval, driven with a fake document and counted timers: runs while visible,
 *      holds zero timers while hidden, refreshes at once and resumes on return, and its stop
 *      function leaves no timer and no listener behind.
 *   3. No URL.createObjectURL inside JSX (a new URL per render), and every createObjectURL left
 *      in the intake files is matched by a revokeObjectURL in the same file.
 *
 * Exits non-zero on a failure AND on inspecting nothing. ROOT=<dir> runs it on another tree.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(process.env.ROOT ?? '.')
const DIR = join(ROOT, 'src/components/intake')
const failures = []
let checked = 0
const ok = (name, cond, why) => { checked++; if (!cond) failures.push(`${name}: ${why}`) }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, '')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => /\.tsx?$/.test(f)) : []
let raw = 0, gated = 0
for (const f of files) {
  const src = strip(readFileSync(join(DIR, f), 'utf8'))
  src.split('\n').forEach((line, i) => {
    if (/\bsetInterval\(/.test(line)) { raw++; failures.push(`src/components/intake/${f}:${i + 1} polls with a raw setInterval, which keeps running in a hidden tab`) }
    if (/\bsetVisibleInterval\(/.test(line)) gated++
    if (/=\{\s*URL\.createObjectURL\(/.test(line)) failures.push(`src/components/intake/${f}:${i + 1} creates an object URL in render and never frees it`)
  })
  const made = (src.match(/URL\.createObjectURL\(/g) ?? []).length
  const freed = (src.match(/URL\.revokeObjectURL\(/g) ?? []).length
  ok(`${f} frees what it creates`, freed >= made, `${made} createObjectURL vs ${freed} revokeObjectURL`)
}
ok('intake files inspected', files.length > 0, `no files under ${DIR}`)
ok('intervals found', raw + gated > 0, 'found no polling at all; the guard would be measuring nothing')
ok('every interval is visibility-gated', raw === 0, `${raw} raw setInterval call(s)`)
console.log(`check-intake-polling: ${files.length} intake files, ${gated} visibility-gated interval(s), ${raw} raw setInterval(s)`)

// ── 2. the helper itself ─────────────────────────────────────────────────────────────────
const lib = join(ROOT, 'src/lib/visibleInterval.ts')
let mod = null
if (existsSync(lib)) { try { mod = await import(pathToFileURL(lib).href) } catch (e) { failures.push(`import visibleInterval.ts: ${e.message}`) } }
ok('setVisibleInterval exists', typeof mod?.setVisibleInterval === 'function', 'src/lib/visibleInterval.ts#setVisibleInterval not found')
if (typeof mod?.setVisibleInterval === 'function') {
  const active = new Set()
  let nextId = 1
  const realSet = globalThis.setInterval, realClear = globalThis.clearInterval
  globalThis.setInterval = () => { const id = nextId++; active.add(id); return id }
  globalThis.clearInterval = (id) => { active.delete(id) }
  try {
    const listeners = new Set()
    const doc = { hidden: false, addEventListener: (_t, fn) => listeners.add(fn), removeEventListener: (_t, fn) => listeners.delete(fn) }
    const fire = () => { for (const fn of [...listeners]) fn() }
    let calls = 0
    const stop = mod.setVisibleInterval(() => { calls++ }, 5000, doc)
    ok('polls while visible', active.size === 1, `${active.size} timers while visible`)
    doc.hidden = true; fire()
    ok('no timer while hidden', active.size === 0, `${active.size} timer(s) still running in a hidden tab`)
    doc.hidden = false; fire()
    ok('refreshes the moment she looks', calls === 1, `ran ${calls} time(s) on return`)
    ok('resumes on return', active.size === 1, `${active.size} timers after return`)
    doc.hidden = false; fire()
    ok('a second visible event does not double the timer', active.size === 1, `${active.size} timers`)
    stop()
    ok('stop leaves no timer', active.size === 0, `${active.size} timer(s) after stop`)
    ok('stop leaves no listener', listeners.size === 0, `${listeners.size} listener(s) after stop`)
    const doc2 = { hidden: true, addEventListener: (_t, fn) => listeners.add(fn), removeEventListener: (_t, fn) => listeners.delete(fn) }
    const stop2 = mod.setVisibleInterval(() => {}, 5000, doc2)
    ok('a tab opened hidden does not poll', active.size === 0, `${active.size} timers`)
    stop2()
  } finally { globalThis.setInterval = realSet; globalThis.clearInterval = realClear }
}

console.log(`check-intake-polling: ${checked} checks exercised`)
if (failures.length) {
  console.error(`FAIL - ${failures.length}:`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('PASS - Digitize polls only while visible, refreshes on return, and frees every photo URL.')
