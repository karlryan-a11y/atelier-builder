// A season stays what the stylist set (Cynthia Dada for Peyton Wheeler, 2026-11-19: "I categorized
// every one of Peyton's items by season last week and some of them are in the wrong season now but
// we didn't change them"). FAILS before: Edit Item wrote the whole marker list back from the copy it
// opened with, the season buttons wrote from the screen's copy, and the season buttons also changed
// pieces still selected from another category that were no longer on screen.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const fails = []
const need = (ok, m) => { if (!ok) fails.push(m) }
const LIB = 'src/lib/editedFields.ts'
const SAVE = 'src/lib/saveEditedFields.ts'
need(existsSync(LIB) && existsSync(SAVE), `${LIB} and ${SAVE} must exist: one rule for writing a piece's markers`)

if (existsSync(LIB)) {
  const { mergeEditedFields } = await import(pathToFileURL(LIB).href)
  const seasons = (f) => (f ?? []).filter((x) => x.startsWith('season-')).sort().join(',')
  // Edit Item opened before the season was set: it saw [color], adds the Material mark.
  const r1 = mergeEditedFields(['color', 'season-fw'], ['color'], ['color', 'material-confirmed'])
  need(seasons(r1) === 'season-fw' && r1.includes('material-confirmed') && r1.includes('color'), `a stale Edit Item save must keep FW and add only its own mark (got ${JSON.stringify(r1)})`)
  // A stylist who takes back a field she edited drops only that field.
  const r2 = mergeEditedFields(['name', 'season-ss', 'pattern-plaid'], ['name'], [])
  need(JSON.stringify(r2) === '["season-ss","pattern-plaid"]', `taking back "name" must leave the season and pattern (got ${JSON.stringify(r2)})`)
  // An unchanged save changes nothing, even from a copy with an old season.
  const r3 = mergeEditedFields(['season-fw'], ['season-ss'], ['season-ss'])
  need(seasons(r3) === 'season-fw', `a save that did not touch the season must not put the old one back (got ${JSON.stringify(r3)})`)
  // A season tap from an old copy still lands, and keeps a pattern set since.
  const r4 = mergeEditedFields(['season-ss', 'pattern-floral'], ['season-ss'], ['season-fw'])
  need(JSON.stringify(r4) === '["pattern-floral","season-fw"]', `SS to FW must keep a pattern set since (got ${JSON.stringify(r4)})`)
  need(mergeEditedFields(['name'], ['name'], []) === null, 'nothing left is null')
}

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const save = read(SAVE)
need(/\.eq\('client_id', clientId\)/.test(save) && /select\('id, client_edited_fields'\)/.test(save), 'the write names the client and asks for its row back (ADR-0108)')
need(/\.filter\('client_edited_fields', 'eq'/.test(save) && /\.is\('client_edited_fields', null\)/.test(save), 'the write lands only if the list is still what it read')

// Every Edit Item save goes through updateClosetItem, which applies only the change.
const notes = read('src/lib/teamNotes.ts')
need(/saveEditedFields\(itemId, clientId, \(now\) => mergeEditedFields\(now, editedFrom/.test(notes), 'updateClosetItem applies the Edit Item change to the list the piece has now')
for (const [file, from] of [
  ['src/components/layout/ClosetPanel.tsx', 'editingItem.client_edited_fields'],
  ['src/components/categorize/CollectionTab.tsx', 'editing.client_edited_fields'],
  ['src/components/categorize/ReviewTab.tsx', 'editing.client_edited_fields'],
  // ReconciliationPanel's rows don't load the column, so its Edit box never sends it.
]) {
  const src = read(file)
  need(new RegExp(`updateClosetItem\\([\\s\\S]*?${from.replace('.', '\\.')} \\?\\? null\\)`).test(src), `${file}: pass the list the Edit box opened with (${from})`)
}

const col = read('src/components/categorize/CollectionTab.tsx')
need(/saveEditedFields\(id, clientId, \(now\) => withSeasonChoice\(now, choiceFor\(id\)\)\)/.test(col), 'the season buttons apply the choice to the list the piece has now')
need(/const visibleIds = new Set\(visible\.map\(\(i\) => i\.id\)\)/.test(col) && /\[\.\.\.p\]\.filter\(\(id\) => visibleIds\.has\(id\)\)/.test(col), 'a piece that is no longer on screen is no longer selected')
need(/saveEditedFields\(itemId, clientId, \(now\) => withPatterns\(now, slugs\)\)/.test(read('src/hooks/usePiecePatterns.ts')), 'pattern saves apply to the list the piece has now')

// Nothing else in the builder writes the column on a piece.
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p] })
for (const f of walk('src').filter((p) => /\.tsx?$/.test(p) && !p.endsWith('saveEditedFields.ts'))) {
  const s = readFileSync(f, 'utf8')
  for (const m of s.matchAll(/from\('gp_closet_items'\)\s*\.update\(\{[^}]*client_edited_fields/g)) need(false, `${f}: writes client_edited_fields itself (${m[0].slice(0, 60)}...); use saveEditedFields`)
}

if (fails.length) { console.error('check-season-kept FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('check-season-kept: ok')
