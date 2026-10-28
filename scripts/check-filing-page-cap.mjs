#!/usr/bin/env node
// @checks build
/**
 * Guard: Categorize reads EVERY filing, not the first 1000.
 *
 * The bug (Cynthia Dada, 2026-11-03, Keil Cadieux): the database answers any one read with at most
 * 1000 rows and says nothing about the rest. Mrs. C has 600 looks and 1210 filings, so Categorize
 * got 1000 of them, and 33 looks that ARE filed showed as Uncategorized (200 on screen, 167 in
 * the data). Restoring her GoodPix categories adds about 400 more filings, which would have made it
 * worse.
 *
 * Checked: loadLookCategories against a FAKE database that, like the real one, returns at most
 * 1000 rows per read and honours .range(). 600 looks with 1210 filings (and 300 capsules with
 * 1100) must all come back filed. Reports the count exercised; exits non-zero at zero.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(process.env.ROOT ?? '.')
const failures = []
let checked = 0
const ok = (name, cond, why) => { checked++; if (!cond) failures.push(`${name}: ${why}`) }

const CAP = 1000
function cappedDb(tables) {
  return {
    from(table) {
      let lo = 0, hi = Infinity
      const q = {
        range(a, b) { lo = a; hi = b; return q },
        then(res, rej) {
          const rows = tables[table] ?? []
          const end = Math.min(hi + 1, lo + CAP, rows.length)
          return Promise.resolve({ data: rows.slice(lo, end), error: null }).then(res, rej)
        },
      }
      for (const m of ['select', 'eq', 'is', 'in', 'order', 'not', 'limit']) q[m] = () => q
      return q
    },
  }
}

const cats = Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, slug: `c${i}`, label: `C${i}`, sort_order: i, is_hidden: false, is_residence: false, season: null }))
const looks = Array.from({ length: 600 }, (_, i) => ({ id: `l${i}`, name: `Look ${i}`, raw: {}, published: true, archived: false, sort_order: i, source: 'goodpix', closet_item_ids: [] }))
const boards = Array.from({ length: 300 }, (_, i) => ({ id: `b${i}`, name: `Capsule ${i}`, raw: {}, published: true, is_deleted: false, sort_order: i, closet_item_ids: [] }))
// Every look in c0 and c1; the first 10 also in c2 (1210). Every capsule in c0..c2, 200 also in c3 (1100).
const la = [...looks.flatMap((l) => [{ look_id: l.id, category_id: 'c0' }, { look_id: l.id, category_id: 'c1' }]),
  ...looks.slice(0, 10).map((l) => ({ look_id: l.id, category_id: 'c2' }))]
const ba = [...boards.flatMap((b) => ['c0', 'c1', 'c2'].map((c) => ({ board_id: b.id, category_id: c }))),
  ...boards.slice(0, 200).map((b) => ({ board_id: b.id, category_id: 'c3' }))]

const loaderPath = join(ROOT, 'src/lib/lookCategoriesLoad.ts')
let load = null
if (existsSync(loaderPath)) {
  try { ({ loadLookCategories: load } = await import(pathToFileURL(loaderPath).href)) }
  catch (e) { failures.push(`could not import src/lib/lookCategoriesLoad.ts: ${e.message}`) }
}
ok('Categorize read is testable', typeof load === 'function', 'src/lib/lookCategoriesLoad.ts#loadLookCategories not found')

if (typeof load === 'function') {
  const res = await load(cappedDb({ look_categories: cats, gp_looks: looks, gp_boards: boards,
    look_category_assignments: la, board_category_assignments: ba }), 'client-1')
  ok('read succeeds', res.error === null, `error ${res.error}`)
  const lookFilings = (res.data?.looks ?? []).reduce((n, l) => n + l.categoryIds.length, 0)
  ok('every look filing is read', lookFilings === la.length, `read ${lookFilings} of ${la.length} look filings`)
  const bare = (res.data?.looks ?? []).filter((l) => l.categoryIds.length === 0).length
  ok('no filed look reads as unfiled', bare === 0, `${bare} filed looks came back with no category`)
  const boardFilings = (res.data?.capsules ?? []).reduce((n, b) => n + b.categoryIds.length, 0)
  ok('every capsule filing is read', boardFilings === ba.length, `read ${boardFilings} of ${ba.length} capsule filings`)
}

console.log(`check-filing-page-cap: ${checked} checks exercised`)
if (checked === 0) { console.error('FAIL - exercised nothing'); process.exit(1) }
if (failures.length) {
  console.error(`FAIL - ${failures.length} of ${checked}:`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log('PASS - Categorize reads every filing past the 1000-row page.')
