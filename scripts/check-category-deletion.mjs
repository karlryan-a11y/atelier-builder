#!/usr/bin/env node
/**
 * Category-deletion decision guard.
 *
 * Deleting a look_category cascades its look AND capsule assignments away, and the record of
 * WHICH looks were filed under it cannot be reconstructed. On the multi-home clients
 * (Margaux Ellery, Shanna Preve, and the Barbie sales demo) three of those categories —
 * Aspen, The Hamptons, New York City — are not filters at all: they drive the home-page tiles
 * and the Collection's residence picker. Deleting one there breaks the client's site silently.
 *
 * planCategoryDeletion is the single place that decides refuse / hide / delete, and this
 * exercises every branch of it directly. Runs in `npm run guard`, so the deploy is blocked if
 * the residence rule or the hide-when-occupied rule is ever weakened.
 */
import { planCategoryDeletion } from '../src/lib/categoryDeletion.ts'

let checked = 0
const failures = []
function expect(name, input, wantAction, wantInMessage = []) {
  checked++
  const plan = planCategoryDeletion(input)
  if (plan.action !== wantAction) {
    failures.push(`${name}: expected "${wantAction}", got "${plan.action}"`)
    return
  }
  for (const needle of wantInMessage) {
    if (!plan.message.includes(needle)) {
      failures.push(`${name}: message is missing ${JSON.stringify(needle)} — got:\n      ${plan.message.replace(/\n/g, ' ')}`)
    }
  }
}

// Residences are refused even when nothing is filed under them — emptiness is not the point,
// the home tiles are built from the row itself.
for (const slug of ['aspen', 'hamptons', 'new-york-city']) {
  expect(`residence "${slug}" with looks`, { slug, label: slug, lookCount: 12, capsuleCount: 1, clientName: 'Margaux Ellery' }, 'refuse', ["one of Margaux's homes"])
  expect(`residence "${slug}" empty`, { slug, label: slug, lookCount: 0, capsuleCount: 0 }, 'refuse', ["one of this client's homes"])
}

// Empty ordinary category: hard delete. These are Maegan's four on Danielle York.
expect('empty category', { slug: 'gloves', label: 'gloves', lookCount: 0, capsuleCount: 0 }, 'delete', ['cannot be undone'])

// Occupied: hide, and the stylist must be told exactly how much is filed under it.
expect('one look', { slug: 'france', label: 'France', lookCount: 1, capsuleCount: 0 }, 'hide', ['1 look stays'])
// House style. Em dashes are banned outright, and each banned phrase below is one Karl had
// to strike by hand from an earlier draft; the point of the list is that he only does that once.
const PROBES = [
  { slug: 'aspen', label: 'Aspen', lookCount: 3, capsuleCount: 0, clientName: 'Margaux Ellery' },
  { slug: 'x', label: 'X', lookCount: 0, capsuleCount: 0 },
  { slug: 'y', label: 'Y', lookCount: 4, capsuleCount: 2, clientName: 'Danielle York' },
  { slug: 'z', label: 'Z', lookCount: 1, capsuleCount: 0, clientName: 'Danielle York' },
]
for (const probe of PROBES) {
  checked++
  const { action, message } = planCategoryDeletion(probe)
  for (const dash of ['\u2014', '\u2013']) {
    if (message.includes(dash)) failures.push(`the "${action}" message contains an ${dash === '\u2014' ? 'em' : 'en'} dash`)
  }
  for (const phrase of ['straight away', 'residence picker', 'junction', 'is_hidden', 'cascade', 'taxonomy']) {
    if (message.toLowerCase().includes(phrase)) failures.push(`the "${action}" message says "${phrase}"`)
  }
  // Short enough to read between appointments.
  for (const line of message.split('\n')) {
    if (line.length > 130) failures.push(`the "${action}" message has a ${line.length}-character line: "${line.slice(0, 60)}..."`)
  }
}
for (const jargon of ['residence picker', 'junction', 'is_hidden', 'cascade', 'assignment', 'taxonomy', 'slug']) {
  for (const probe of [
    { slug: 'aspen', label: 'Aspen', lookCount: 3, capsuleCount: 0, clientName: 'Margaux Ellery' },
    { slug: 'x', label: 'X', lookCount: 0, capsuleCount: 0 },
    { slug: 'y', label: 'Y', lookCount: 4, capsuleCount: 2 },
  ]) {
    checked++
    if (planCategoryDeletion(probe).message.toLowerCase().includes(jargon)) {
      failures.push(`jargon "${jargon}" reached the stylist in the "${planCategoryDeletion(probe).action}" message`)
    }
  }
}
expect('many looks', { slug: 'to-be-tried', label: 'To Be Tried', lookCount: 47, capsuleCount: 0 }, 'hide', ['47 looks stay'])
expect('capsules only', { slug: 'packing', label: 'Packing Capsules', lookCount: 0, capsuleCount: 3 }, 'hide', ['3 capsules'])
expect('both', { slug: 'lake-house', label: 'lake house', lookCount: 2, capsuleCount: 1 }, 'hide', ['2 looks and 1 capsule stay'])

// A category merely NAMED like a home on a client who has none is still an ordinary category
// only if its slug differs — the slug is what the residence code matches on.
expect('lookalike slug', { slug: 'aspen-trip', label: 'Aspen Trip', lookCount: 0, capsuleCount: 0 }, 'delete')

console.log(`category-deletion: exercised ${checked} cases against planCategoryDeletion`)
if (checked === 0) { console.error('FAIL — the guard inspected nothing'); process.exit(1) }
if (failures.length) {
  console.error('\nFAIL')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('PASS — residences refused, empty categories deleted, occupied categories hidden with counts named.')
