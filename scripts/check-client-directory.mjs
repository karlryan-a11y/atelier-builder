#!/usr/bin/env node
/**
 * CLIENT DIRECTORY: every client picker says which twin to use (ADR-0122).
 *
 * The defect (Cynthia Dada, 2026-09-15): typing "holl" into the builder's client search
 * returned nine names, one of them a client we style today. "Holly Klus McClellan" is an
 * empty shell beside Holly McClellan (558 live pieces, 285 looks), the picker showed two
 * bare names, and she opened the empty one. 69 same-name pairs sat in the list like that.
 *
 * Two halves, and it fails on either:
 *
 * 1. SOURCE. Each builder picker that chooses a client reads `client_directory()` (through
 *    lib/clientDirectory.ts) and renders <ClientPickerLabel>, which shows the star and the
 *    note. A picker that goes back to `.from('gp_clients').select('id, name')` and a bare
 *    `{c.name}` shows the twins without telling them apart, which is the bug.
 *
 * 2. THE REAL LIST. Calls the live function and checks what a stylist would read: Holly's
 *    real profile carries the star and her shell reads Empty; Cynthia Lippe / Lippe2 (kept
 *    separate by Karl, 2026-09-08) carry no star; every client with a twin has a note and
 *    no client without one does; nothing empty is starred.
 *
 * Reports how much it inspected and exits non-zero at zero: a green tick over nothing is
 * how a broken guard survived three weeks here (ADR-0106).
 *
 *   node scripts/check-client-directory.mjs
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const problems = []
const fail = (msg) => { problems.push(msg); console.error(`   ❌ ${msg}`) }
const ok = (msg) => console.log(`   ✓ ${msg}`)

// ── 1. source ────────────────────────────────────────────────────────────────
console.log('\nclient-directory: pickers')
const PICKERS = [
  // [file, what it is, the text that must feed its list]
  ['src/components/layout/ClientBar.tsx', 'the workspace client search (Canvas, Categorize, Shop)', 'useClients('],
  ['src/components/intake/IntakeInbox.tsx', 'the Digitize upload client search', 'fetchClientDirectory('],
]
let pickersInspected = 0
for (const [file, what, feed] of PICKERS) {
  let src
  try { src = readFileSync(file, 'utf8') } catch { fail(`${file} (${what}) is missing; the guard cannot see it.`); continue }
  pickersInspected++
  if (!src.includes(feed)) fail(`${file} (${what}) no longer loads its list through ${feed.replace('(', '()')}, so it has no duplicate notes.`)
  if (!/<ClientPickerLabel\b/.test(src)) fail(`${file} (${what}) renders client names without <ClientPickerLabel>: twins show as two bare names.`)
  else ok(`${what}: reads the directory and renders the note`)
}
const read = (file) => { try { return readFileSync(file, 'utf8') } catch { fail(`${file} is missing.`); return '' } }
const hook = read('src/hooks/useClients.ts')
if (!hook.includes('fetchClientDirectory(')) fail('src/hooks/useClients.ts does not read fetchClientDirectory(); ClientBar gets no notes.')
const lib = read('src/lib/clientDirectory.ts')
if (!/rpc\(\s*'client_directory'\s*\)/.test(lib)) fail("src/lib/clientDirectory.ts does not call rpc('client_directory').")
const label = read('src/components/common/ClientDuplicateNote.tsx')
if (!label.includes('client.note') || !label.includes('client.badge')) fail('ClientPickerLabel no longer renders both the note and the badge.')
if (/group-hover|opacity-0/.test(label)) fail('ClientPickerLabel hides the note behind hover; the stylists are on iPads (ADR-0108).')
if (pickersInspected === 0) fail('inspected ZERO pickers.')

// ── 2. the real list ─────────────────────────────────────────────────────────
const env = { ...process.env }
for (const file of ['.env.local', '.env']) {
  let text
  try { text = readFileSync(file, 'utf8') } catch { continue }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const URL_ = env.VITE_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
console.log('\nclient-directory: live function')
let rows = []
if (!URL_ || !KEY) {
  fail('needs VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to read the live list.')
} else {
  const { data, error } = await createClient(URL_, KEY).rpc('client_directory')
  if (error) fail(`client_directory() failed: ${error.message}. Migration 023 applied?`)
  rows = data ?? []
}

const byId = new Map(rows.map((r) => [r.id, r]))
const HOLLY = '5e8ec7c545496f1c3f4c6443'
const HOLLY_SHELL = 'd9d4d26c-362f-4fa2-a5a8-815278acac72'
const LIPPE = ['5e8ec7c545496f1c3f4c643f', '5e8ec7c445496f1c3f4c6167']

if (rows.length === 0) fail('the live list returned ZERO clients; nothing was checked.')
else {
  const h = byId.get(HOLLY), shell = byId.get(HOLLY_SHELL)
  if (!h) fail(`Holly McClellan (${HOLLY}) is not in the list.`)
  else if (!h.badge?.startsWith('Most') || !h.note) fail(`Holly McClellan's real profile reads badge=${h.badge} note=${h.note}; she should be starred.`)
  else ok(`Holly McClellan: ★ ${h.badge} · ${h.note}`)
  if (shell) {
    if (shell.badge || !shell.note?.startsWith('Empty')) fail(`the empty "Holly Klus McClellan" shell reads badge=${shell.badge} note=${shell.note}; it should read Empty with no star.`)
    else ok(`Holly Klus McClellan: ${shell.note}`)
  } // if the shell has been retired, there is nothing to label
  for (const id of LIPPE) {
    const r = byId.get(id)
    if (r && r.badge !== 'Kept separate') fail(`${r.name} reads badge=${r.badge}; Karl kept Lippe / Lippe2 separate, so neither is starred.`)
  }

  let twins = 0, starred = 0
  for (const r of rows) {
    if (r.similar_count > 0) {
      twins++
      if (!r.note) fail(`${r.name} (${r.id}) has ${r.similar_count} similar name(s) and no note.`)
    } else if (r.note || r.badge) fail(`${r.name} (${r.id}) has no twin but carries a note/badge.`)
    if (r.badge?.startsWith('Most')) {
      starred++
      if (r.pieces + r.looks === 0) fail(`${r.name} (${r.id}) is starred with nothing in it.`)
    }
  }
  if (twins === 0) fail('found ZERO clients with a similar name; the matching rule measured nothing.')
  console.log(`   inspected ${rows.length} clients · ${twins} with a similar name · ${starred} starred`)
}

console.log('')
if (problems.length) {
  console.error(`❌ client-directory: ${problems.length} problem(s).\n`)
  process.exit(1)
}
console.log('✅ client-directory: every picker tells the twins apart.\n')
