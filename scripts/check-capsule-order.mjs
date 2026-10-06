#!/usr/bin/env node
/**
 * New capsules land on top. Cynthia Dada, 2026-10-05, Peyton Wheeler's London capsule.
 *
 * The builder saved every new capsule at sort_order 0 with no created_at, so on her page they
 * tied and Postgres picked. A new capsule now saves sort_order NULL and a created_at, and the
 * Capsules tab orders like her page (atelier-looks lib/capsuleOrder.ts): NULLS FIRST, newest.
 * Fails on the code before this commit (sort_order = 0, nullsFirst: false).
 */
import { readFileSync } from 'node:fs'
let checked = 0
const failures = []
const ok = (c, m) => { checked++; if (!c) failures.push(m) }

const save = readFileSync(new URL('../src/hooks/useCapsules.ts', import.meta.url), 'utf8')
ok(!/row\.sort_order = 0/.test(save), 'a new capsule is still saved at sort_order 0, so it ties with every other new one')
ok(/row\.sort_order = null/.test(save), 'a new capsule does not save sort_order NULL, so it will not go on top')
ok(/row\.created_at = new Date\(\)\.toISOString\(\)/.test(save), 'a new capsule saves no created_at, so newest-first cannot see it')

const load = readFileSync(new URL('../src/lib/lookCategoriesLoad.ts', import.meta.url), 'utf8')
const boards = load.slice(load.indexOf("db.from('gp_boards')"), load.indexOf("db.from('gp_boards')") + 900)
ok(/\.order\('sort_order', \{ ascending: true, nullsFirst: true \}\)/.test(boards), 'the Capsules tab does not put never-arranged capsules first, unlike her page')
ok(/\.order\('created_at', \{ ascending: false, nullsFirst: false \}\)/.test(boards), 'the Capsules tab is not newest first among ties')

if (failures.length) {
  console.error(`check-capsule-order: FAIL (${failures.length} of ${checked})`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log(`check-capsule-order: ok (${checked} assertions: new capsule save, Capsules tab order)`)
