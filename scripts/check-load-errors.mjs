#!/usr/bin/env node
/**
 * Guard: a failed read of looks shows "Couldn't load" with a Retry, never an empty grid.
 *
 * The bug: useLookCategories read `looksRes.data ?? []` and never looked at `looksRes.error`,
 * so a 500 from a struggling database (2026-09-17) rendered an EMPTY Categorize grid, which a
 * stylist reads as "her looks are gone". useLooks did the same behind "No saved looks yet".
 *
 * Checked:
 *   1. loadLookCategories (the Categorize read) run against a FAKE database that fails each
 *      table in turn, and one that throws: every case must come back as `error`, never as
 *      an empty list. A healthy fake must come back with its looks, each with its picture
 *      from raw.main_image_url.
 *   2. The hooks carry the error to the screen: useLookCategories and useLooks set and return
 *      it, useItemLookUsage returns it, and the Categorize grid, the Nesting tab and the Looks
 *      gallery render it (LoadError + Retry) instead of the empty state.
 *   3. The copy has no em dashes.
 *
 * Reports the count exercised; exits non-zero at zero. ROOT=<dir> runs it against another tree.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(process.env.ROOT ?? '.')
const failures = []
let checked = 0
const ok = (name, cond, why) => { checked++; if (!cond) failures.push(`${name}: ${why}`) }
const read = (p) => { const f = join(ROOT, p); return existsSync(f) ? readFileSync(f, 'utf8') : null }

// ── 1. the read, against a fake database ─────────────────────────────────────────────────
/** A stand-in for supabase-js: every builder method chains, and awaiting it yields the
 *  table's configured response. `throws` makes the await reject, like a dropped connection. */
function fakeDb(responses, { throws = null } = {}) {
  const calls = []
  return {
    calls,
    from(table) {
      calls.push(table)
      const q = {
        then(res, rej) {
          if (throws === table) return Promise.reject(new Error('TypeError: Load failed')).then(res, rej)
          return Promise.resolve(responses[table] ?? { data: [], error: null }).then(res, rej)
        },
      }
      for (const m of ['select', 'eq', 'is', 'in', 'order', 'not', 'range', 'limit']) q[m] = () => q
      return q
    },
  }
}

const healthy = {
  look_categories: { data: [{ id: 'c1', slug: 'office', label: 'Office', sort_order: 0, is_hidden: false, is_residence: false, description: null, parent_slug: null }], error: null },
  gp_looks: { data: [
    { id: 'l1', name: 'Look one', raw: { main_image_url: 'https://x/functions/v1/image-proxy?key=looks%2Fl1.png' }, published: true, archived: false, sort_order: 0, source: 'builder', closet_item_ids: ['i1'] },
    { id: 'l2', name: 'Look two', raw: { main_image_url: 'https://s3/goodpix/l2.jpg' }, published: false, archived: false, sort_order: 1, source: 'goodpix', closet_item_ids: [] },
  ], error: null },
  gp_boards: { data: [], error: null },
  look_category_assignments: { data: [{ look_id: 'l1', category_id: 'c1' }], error: null },
  board_category_assignments: { data: [], error: null },
}
const err500 = { data: null, error: { message: 'HTTP 500: upstream connect error', code: '500' } }

const loaderPath = join(ROOT, 'src/lib/lookCategoriesLoad.ts')
let load = null
if (existsSync(loaderPath)) {
  try { ({ loadLookCategories: load } = await import(pathToFileURL(loaderPath).href)) }
  catch (e) { failures.push(`could not import src/lib/lookCategoriesLoad.ts: ${e.message}`) }
}
ok('Categorize read is testable', typeof load === 'function',
  'src/lib/lookCategoriesLoad.ts#loadLookCategories not found: the Categorize read has no error path to test')

if (typeof load === 'function') {
  const good = await load(fakeDb(healthy), 'client-1')
  ok('healthy read returns its looks', good.error === null && good.data?.looks.length === 2,
    `expected 2 looks and no error, got ${JSON.stringify({ error: good.error, n: good.data?.looks?.length })}`)
  ok('healthy read files look one under Office', JSON.stringify(good.data?.looks?.[0]?.categoryIds) === '["c1"]',
    `got ${JSON.stringify(good.data?.looks?.[0]?.categoryIds)}`)
  ok('picture comes from raw.main_image_url', good.data?.looks?.[0]?.image === healthy.gp_looks.data[0].raw.main_image_url,
    `got ${good.data?.looks?.[0]?.image}`)

  for (const table of ['gp_looks', 'look_categories', 'gp_boards', 'look_category_assignments']) {
    const res = await load(fakeDb({ ...healthy, [table]: err500 }), 'client-1')
    ok(`${table} 500 is reported`, res.error === err500.error.message && res.data === null,
      `a 500 on ${table} came back as ${JSON.stringify({ error: res.error, looks: res.data?.looks?.length })}; the grid would render empty`)
  }
  const thrown = await load(fakeDb(healthy, { throws: 'gp_looks' }), 'client-1').catch((e) => ({ error: `THREW ${e.message}`, data: null }))
  ok('a dropped connection is reported, not thrown', typeof thrown.error === 'string' && !thrown.error.startsWith('THREW'),
    `got ${JSON.stringify(thrown)}`)
}

// ── 2. the hooks carry it to the screen ──────────────────────────────────────────────────
const cats = read('src/hooks/useLookCategories.ts') ?? ''
ok('useLookCategories reads through the tested loader', /loadLookCategories\(supabase, clientId\)/.test(cats),
  'fetchAll does not call loadLookCategories, so the test above does not cover what the grid shows')
ok('useLookCategories keeps the error', /setError\(res\.error\)/.test(cats), 'the hook never stores the failure')
ok('useLookCategories returns the error', /return \{\s*loading, error,/.test(cats), 'the hook does not return `error`')

const looks = read('src/hooks/useLooks.ts') ?? ''
ok('useLooks keeps the error', /if \(error\) \{[\s\S]{0,200}setError\(/.test(looks), 'useLooks drops a failed read on the floor')
ok('useLooks returns the error', /return \{ looks, loading, error,/.test(looks), 'useLooks does not return `error`')

const usage = read('src/hooks/useItemLookUsage.ts') ?? ''
ok('useItemLookUsage returns the error', /return \{ byItem, loading, error \}/.test(usage), 'a failed page reads as "styled in 0 looks"')

const panel = read('src/components/categorize/CategorizePanel.tsx') ?? ''
ok('Categorize grid renders the error before the empty state', /loadError \? \(\s*<LoadError[\s\S]{0,200}visible\.length === 0/.test(panel),
  'the Categorize grid still goes straight from Loading to "No looks here"')
const nesting = read('src/components/categorize/NestingTab.tsx') ?? ''
ok('Nesting tab passes the looks error', /error=\{looksError\}/.test(nesting), 'the Nesting looks editor cannot tell a failure from no categories')
const gallery = read('src/components/canvas/LookGallery.tsx') ?? ''
ok('Looks gallery renders the error before "No saved looks yet"', /error && onRetry \? \(\s*<LoadError/.test(gallery),
  'the Looks gallery shows "No saved looks yet" after a 500')
const chat = read('src/components/layout/ChatPanel.tsx') ?? ''
ok('ChatPanel hands the gallery the error and a retry', /error=\{looksError\}[\s\S]{0,80}onRetry=/.test(chat), 'LookGallery never receives the error')

// ── 3. copy ──────────────────────────────────────────────────────────────────────────────
const le = read('src/components/common/LoadError.tsx') ?? ''
ok('LoadError exists with a Retry', /Couldn't load/.test(le) && />\s*Retry\s*</.test(le), 'no Couldn\'t load / Retry component')
ok('LoadError copy has no em dash', le !== '' && !le.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n').includes('—'),
  'an em dash in stylist-facing copy')

console.log(`check-load-errors: ${checked} checks exercised (${ROOT === resolve('.') ? 'this tree' : ROOT})`)
if (checked === 0) { console.error('FAIL - exercised nothing'); process.exit(1) }
if (failures.length) {
  console.error(`FAIL - ${failures.length} of ${checked}:`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('PASS - a failed looks read is reported by the hook and shown as Couldn\'t load + Retry, never an empty grid.')
