#!/usr/bin/env node
// @checks build
/**
 * LOOKS A CLIENT DELETED, IN REVIEW.
 *
 * Maegan Zarley Watson, 2026-09-24: "clients can delete a look and it goes to a place for us to
 * review" and "give them the option to provide notes of why they're deleting it."
 *
 * WHAT IS GUARDED
 *
 *   1. THE LIST. Every look she has an 'archived' mark on is listed with her note and the date,
 *      newest first; cleared ones move to their own list and stay restorable.
 *   2. NOTHING IS LOST. Restore and Clear stamp her note's record; they never drop it, and they
 *      never touch anything else in her client row.
 *   3. THE LOOK IS NEVER TOUCHED. The Review list writes client_marks and gp_clients only, never
 *      gp_looks, and Restore deletes only her 'archived' mark on that one look.
 *   4. A REFUSED WRITE SAYS SO. A write the database declines comes back 200 with no rows, so both
 *      writes ask for their rows back.
 *   5. THE STYLIST CAN FIND IT. Review has a Deleted looks pill and the tab carries the count.
 *
 * Exits non-zero on failure and on inspecting nothing (ADR-0106).
 */
import { readFileSync, existsSync } from 'node:fs'
import assert from 'node:assert/strict'

const ROOT = new URL('..', import.meta.url).pathname
const problems = []
const fail = (m) => { problems.push(m); console.error(`   ❌ ${m}`) }
let checks = 0
const read = (rel) => (existsSync(ROOT + rel) ? readFileSync(ROOT + rel, 'utf8') : (fail(`${rel}: file not found`), ''))
const check = (name, fn) => { checks++; try { fn() } catch (e) { fail(`${name}: ${e.message}`) } }

const LIB = `${ROOT}src/lib/deletedLooks.ts`
const L = existsSync(LIB) ? await import(LIB) : (fail('src/lib/deletedLooks.ts: file not found'), null)

if (L) {
  const marks = [
    { target_id: 'L1', created_at: '2026-10-20T10:00:00Z' },
    { target_id: 'L2', created_at: '2026-10-25T10:00:00Z' },
    { target_id: 'L3', created_at: '2026-10-26T10:00:00Z' },
  ]
  const raw = {
    keep: 'me',
    look_removals: {
      L1: { note: 'Too formal', at: '2026-10-20T10:00:01Z', by: 'Margaux' },
      L3: { note: 'Old', at: '2026-10-26T10:00:01Z', by: 'Margaux', cleared_at: '2026-10-27T00:00:00Z' },
      L9: { note: 'restored long ago', at: '2026-09-01T00:00:00Z', by: 'Margaux', restored_at: '2026-09-02T00:00:00Z' },
    },
  }
  check('the list', () => {
    const { waiting, cleared } = L.deletedLooks(marks, raw)
    assert.deepEqual(waiting.map((d) => d.lookId), ['L2', 'L1'], 'waiting, newest first')
    assert.deepEqual(waiting[1], { lookId: 'L1', at: '2026-10-20T10:00:01Z', note: 'Too formal', by: 'Margaux' })
    assert.deepEqual(waiting[0], { lookId: 'L2', at: '2026-10-25T10:00:00Z', note: null, by: null }, 'a delete with no note record still shows, dated by the mark')
    assert.deepEqual(cleared.map((d) => d.lookId), ['L3'])
    assert.ok(![...waiting, ...cleared].some((d) => d.lookId === 'L9'), 'a restored look (no mark) is not listed')
  })
  check('nothing is lost', () => {
    const c = L.withCleared(raw, 'L1', 'Paige', '2026-10-28T00:00:00Z')
    assert.equal(c.keep, 'me')
    assert.equal(c.look_removals.L1.note, 'Too formal')
    assert.equal(c.look_removals.L1.cleared_at, '2026-10-28T00:00:00Z')
    assert.equal(c.look_removals.L1.cleared_by, 'Paige')
    assert.deepEqual(c.look_removals.L3, raw.look_removals.L3, 'other looks untouched')
    const r = L.withRestored(raw, 'L2', 'Paige', '2026-10-28T00:00:00Z')
    assert.equal(r.look_removals.L2.restored_at, '2026-10-28T00:00:00Z')
    assert.equal(r.look_removals.L1.note, 'Too formal')
    assert.equal(L.deletedLooks(marks, c).waiting.length, 1, 'cleared leaves the waiting list')
  })
}

const HOOK = 'src/hooks/useDeletedLooks.ts'
const hook = read(HOOK)
check('the look is never touched', () => {
  assert.doesNotMatch(hook, /from\('gp_looks'\)[^\n]*\.(update|delete|upsert|insert)\(/, `${HOOK} writes gp_looks`)
  assert.doesNotMatch(hook, /thumbnail_url/, `${HOOK} reads thumbnail_url (lib/lookImage.ts)`)
  const restore = hook.slice(hook.indexOf('const restore'), hook.indexOf('const clear'))
  for (const f of [".eq('client_id', clientId)", ".eq('target_type', 'look')", ".eq('target_id', lookId)", ".eq('mark', 'archived')"]) {
    assert.ok(restore.includes(f), `Restore must delete only her archived mark on this look (missing ${f})`)
  }
})
check('a refused write says so', () => {
  assert.ok((hook.match(/\.select\('(target_id|id)'\)/g) ?? []).length >= 2, 'both writes ask for their rows back')
  assert.ok((hook.match(/!(data|saved)\?\.length\) throw/g) ?? []).length >= 2, 'an empty answer is an error')
})

const TAB = 'src/components/categorize/ReviewTab.tsx'
const PANEL = 'src/components/categorize/CategorizePanel.tsx'
check('the stylist can find it', () => {
  const tab = read(TAB)
  assert.match(tab, /\['deleted', 'Deleted looks', deleted\.waiting\.length\]/)
  assert.match(tab, /look\.note/)
  assert.match(tab, /shortDate\(look\.at\)/)
  assert.match(read(PANEL), /m === 'review' && deletedLooks\.waiting\.length > 0/)
})

if (checks === 0) fail('inspected nothing')
if (problems.length) { console.error(`\n❌ deleted-looks: ${problems.length} failure(s).`); process.exit(1) }
console.log(`✅ deleted-looks: ${checks} checks. Her deleted looks reach Review with her note; Restore and Clear never touch the look or lose the note.`)
