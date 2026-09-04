#!/usr/bin/env node
/**
 * Guard: nobody changes a client's front page by mis-tapping.
 *
 * The Home toggle (ADR-0111) is one click, on a row between the styling-note and rename
 * buttons, used on an iPad. What it changes is not on the screen the stylist is looking at —
 * it is on the client's phone. So it asks first, and this guard proves that it does, and that
 * the question is one a stylist can actually answer.
 *
 * Three things are checked:
 *
 * 1. THE WRITE CANNOT HAPPEN WITHOUT THE ASK. setCategoryResidence must take a confirm
 *    callback and must return early when it returns false. A confirm that is rendered but not
 *    obeyed is worse than none, because it reads as protection.
 *
 * 2. THE SENTENCE NAMES THE REAL CONSEQUENCE. The two toggles that cross MIN_RESIDENCES change
 *    her whole front page, and must say so. The others add or remove one tile, and must say
 *    that instead. A warning that overstates the danger gets clicked through, and one that
 *    understates it is how the mis-tap survives.
 *
 * 3. IT READS LIKE A PERSON WROTE IT. Same house rules as check-category-deletion: no em
 *    dashes, no jargon, short lines, her client's name.
 *
 * Reports the count exercised and exits non-zero at zero, per HARD-RULES.
 */
import { readFileSync } from 'node:fs'
import { planResidenceToggle } from '../src/lib/residenceToggle.ts'

const failures = []
let checked = 0

const expect = (name, input, wantAction, wantThreshold, wantInMessage = []) => {
  checked++
  const plan = planResidenceToggle(input)
  if (plan.action !== wantAction) {
    failures.push(`${name}: expected action "${wantAction}", got "${plan.action}"`)
  }
  if (plan.crossesThreshold !== wantThreshold) {
    failures.push(`${name}: expected crossesThreshold=${wantThreshold}, got ${plan.crossesThreshold}`)
  }
  for (const needle of wantInMessage) {
    if (!plan.message.includes(needle)) {
      failures.push(`${name}: message is missing ${JSON.stringify(needle)} — got:\n      ${plan.message.replace(/\n/g, ' ')}`)
    }
  }
}

// ── 1. the write is gated on the ask ────────────────────────────────────────────────────
const HOOK = 'src/hooks/useLookCategories.ts'
const PANEL = 'src/components/categorize/CategorizePanel.tsx'
const hook = readFileSync(HOOK, 'utf8')
const panel = readFileSync(PANEL, 'utf8')

checked++
if (!/const setCategoryResidence = useCallback\(async \(\s*[\s\S]{0,200}?confirmWith: \(message: string\) => boolean/.test(hook)) {
  failures.push(`${HOOK}: setCategoryResidence does not take a confirm callback. A mis-tap would write straight through.`)
}
checked++
if (!/if \(!confirmWith\(plan\.message\)\) return null/.test(hook)) {
  failures.push(
    `${HOOK}: setCategoryResidence does not bail out when the stylist declines.\n` +
    `    A confirm that is shown but not obeyed is worse than none — it reads as protection.`,
  )
}
checked++
if (!/from '@\/lib\/residenceToggle'/.test(hook)) {
  failures.push(`${HOOK}: the confirm text is not coming from planResidenceToggle, so the warning and the write can drift apart.`)
}
checked++
if (!/onClick=\{\(\) => handleToggleHome\(cat\)\}/.test(panel)) {
  failures.push(`${PANEL}: the Home button no longer routes through handleToggleHome, so it may be writing without asking.`)
}
checked++
if (/setCategoryResidence\(cat\.id, !cat\.is_residence\)\s*\}/.test(panel)) {
  failures.push(`${PANEL}: the Home button calls setCategoryResidence with no confirm callback.`)
}
checked++
if (!/window\.confirm\(message\)/.test(panel.slice(panel.indexOf('handleToggleHome')))) {
  failures.push(`${PANEL}: handleToggleHome does not actually put the question in front of anyone.`)
}

// ── 2. the sentence names the real consequence ──────────────────────────────────────────

// 1 -> 2: her front page stops being the ordinary one. The big one.
expect('turning on the second home', {
  label: 'Chicago', turningOn: true, currentHomeCount: 1, lookCount: 4, clientName: 'Maegan Watson',
}, 'enable', true, ["Maegan's homes", 'front page changes', 'Untick to undo'])

// 0 -> 1: nothing visible happens. Say so, or she goes hunting for a change.
expect('turning on the first home', {
  label: 'Aspen', turningOn: true, currentHomeCount: 0, lookCount: 0, clientName: 'Shanna Preve',
}, 'enable', false, ['Nothing changes on her site yet', 'needs two homes'])

// 2 -> 3: one more tile.
expect('turning on a third home', {
  label: 'Sayulita', turningOn: true, currentHomeCount: 2, lookCount: 16, clientName: 'Maegan Watson',
}, 'enable', false, ['adds a tile', 'once looks are'])

// 2 -> 1: her home tiles go away entirely. The likeliest damaging mis-tap.
expect('turning off the second-to-last home', {
  label: 'Chicago', turningOn: false, currentHomeCount: 2, lookCount: 4, clientName: 'Maegan Watson',
}, 'disable', true, ['down to one home', 'back to normal', '4 looks', 'Tick Home again'])

// 3 -> 2: one tile goes.
expect('turning off one of three homes', {
  label: 'The Hamptons', turningOn: false, currentHomeCount: 3, lookCount: 15, clientName: 'Margaux Ellery',
}, 'disable', false, ['comes off her front page', '15 looks', 'Tick Home again'])

// An empty home reads naturally rather than saying "0 looks".
checked++
{
  const msg = planResidenceToggle({ label: 'Chicago', turningOn: false, currentHomeCount: 3, lookCount: 0 }).message
  if (/\b0 looks?\b/.test(msg)) failures.push(`an empty home's message says "0 looks" instead of leaving the count out: ${msg.replace(/\n/g, ' ')}`)
}

// EVERY message must promise the category survives, because it does. A warning that implies
// deletion gets refused when it should be accepted, and teaches her to distrust the next one.
const ALL = [
  { label: 'Chicago', turningOn: true, currentHomeCount: 1, lookCount: 4, clientName: 'Maegan Watson' },
  { label: 'Aspen', turningOn: true, currentHomeCount: 0, lookCount: 0, clientName: 'Shanna Preve' },
  { label: 'Sayulita', turningOn: true, currentHomeCount: 2, lookCount: 16, clientName: 'Maegan Watson' },
  { label: 'Chicago', turningOn: false, currentHomeCount: 2, lookCount: 4, clientName: 'Maegan Watson' },
  { label: 'The Hamptons', turningOn: false, currentHomeCount: 3, lookCount: 15, clientName: 'Margaux Ellery' },
  { label: 'X', turningOn: false, currentHomeCount: 2, lookCount: 0 },
  { label: 'Y', turningOn: true, currentHomeCount: 1, lookCount: 0 },
]
for (const probe of ALL) {
  checked++
  const { action, message } = planResidenceToggle(probe)
  if (!probe.turningOn && !/Tick Home again/.test(message)) {
    failures.push(`the "${action}" message does not say the toggle is reversible`)
  }
  if (/delete|deleted|remove the category|lost|permanently/i.test(message)) {
    failures.push(`the "${action}" message implies something is destroyed. Nothing is: "${message.replace(/\n/g, ' ')}"`)
  }
  // ── 3. house style ──
  for (const dash of ['—', '–']) {
    if (message.includes(dash)) failures.push(`the "${action}" message contains an ${dash === '—' ? 'em' : 'en'} dash`)
  }
  for (const jargon of ['is_residence', 'residence', 'slug', 'taxonomy', 'junction', 'boolean', 'flag', 'column', 'MIN_RESIDENCES']) {
    if (message.toLowerCase().includes(jargon.toLowerCase())) {
      failures.push(`jargon "${jargon}" reached the stylist in the "${action}" message`)
    }
  }
  for (const line of message.split('\n')) {
    if (line.length > 130) failures.push(`the "${action}" message has a ${line.length}-character line: "${line.slice(0, 60)}..."`)
  }
  // She is reading this between appointments.
  if (message.split('\n').filter(Boolean).length > 4) {
    failures.push(`the "${action}" message runs to more than three short paragraphs`)
  }
}

// A client with no name still gets a readable sentence.
expect('no client name', {
  label: 'Chicago', turningOn: false, currentHomeCount: 2, lookCount: 1,
}, 'disable', true, ["this client's homes"])

if (checked === 0) {
  console.error('FAIL — check-residence-toggle exercised nothing.')
  process.exit(1)
}
if (failures.length) {
  console.error(`\nFAIL — check-residence-toggle (${checked} exercised)\n`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`residence-toggle: exercised ${checked} cases. The Home toggle asks before it writes, names the real consequence on both sides of the two-home threshold, and never implies anything is destroyed.`)
