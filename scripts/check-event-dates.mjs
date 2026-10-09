// Dates on looks and capsules (migration 041; Karl + Maegan, 2026-10-09). FAILS before: no
// eventDates lib, the cards had no Dates button, and the loader never read event_start/event_end.
import { readFileSync, existsSync } from 'node:fs'
const fails = []
const need = (ok, m) => { if (!ok) fails.push(m) }
need(existsSync('src/lib/eventDates.ts'), 'src/lib/eventDates.ts is missing')
const load = readFileSync('src/lib/lookCategoriesLoad.ts', 'utf8')
need((load.match(/event_start, event_end/g) ?? []).length === 2, 'looks and capsules must load their dates')
const panel = readFileSync('src/components/categorize/CategorizePanel.tsx', 'utf8')
need((panel.match(/data-event-dates=\{(look|capsule)\.id\}/g) ?? []).length === 2, 'look and capsule cards need a Dates button')
need(/<EventDatesDialog/.test(panel), 'the dates dialog must render')
// The wording, run (same as the lookbook twin).
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const src = readFileSync('src/lib/eventDates.ts', 'utf8')
need(src.includes("`${one}–${b.day}`") && src.includes("`${one} – ${MONTHS[b.m - 1]} ${b.day}`"), 'format: Oct 14–18 / Oct 30 – Nov 2')
void MONTHS
const dlg = readFileSync('src/components/canvas/SaveAsCapsuleDialog.tsx', 'utf8')
const chat = readFileSync('src/components/layout/ChatPanel.tsx', 'utf8')
need(/data-capsule-start/.test(dlg) && /data-capsule-end/.test(dlg), 'Save as Capsule needs the trip dates')
need(/update\(\{ event_start: data\.eventStart/.test(chat), 'Save as Capsule must save the dates on the capsule it saved')
if (fails.length) { console.error('check-event-dates FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('check-event-dates: ok')
