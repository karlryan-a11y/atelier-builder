#!/usr/bin/env node
/**
 * Guard: a home is a property of a category, and the builder is where it is set (ADR-0111).
 *
 * The failure modes this exists to catch, each of which has actually happened here:
 *
 * 1. A COLUMN LEFT OUT OF A SELECT (ADR-0103). `look_categories` is read in several places.
 *    Miss `is_residence` in one and that surface reads `undefined` on every row, which means
 *    NO CLIENT HAS HOMES -- silently, with no error. Margaux Ellery's home page would quietly
 *    become an ordinary one.
 *
 * 2. A HARDCODED LIST COMING BACK (ADR-0111). The whole point is that "which categories are
 *    homes" is data. A place name typed into the code is the old world returning, and the
 *    first symptom is a stylist asking us to add a home again.
 *
 * 3. A HOVER-ONLY CONTROL (ADR-0108). The rename pencil sat at `opacity-0` until hover, and
 *    the stylists work on iPads where hover does not exist -- which is why Maegan believed
 *    renaming was impossible. A Home toggle nobody can see is the same bug, and this one
 *    changes what the client sees on her front page.
 *
 * 4. A REFUSAL WITH NO WAY OUT. Deleting a home is refused. That was correct when a home was
 *    a line of code; now that it is a checkbox, the refusal has to name the checkbox.
 *
 * Reports the count inspected and exits non-zero at zero, per HARD-RULES.
 */
import { readFileSync } from 'node:fs'

const errors = []
let inspected = 0

const HOOK = 'src/hooks/useLookCategories.ts'
const PANEL = 'src/components/categorize/CategorizePanel.tsx'
const LIB = 'src/lib/residences.ts'
const DELETION = 'src/lib/categoryDeletion.ts'

const hook = readFileSync(HOOK, 'utf8')
const panel = readFileSync(PANEL, 'utf8')
const lib = readFileSync(LIB, 'utf8')
const deletion = readFileSync(DELETION, 'utf8')

// ── 1. every look_categories SELECT names is_residence ──
const selects = [...hook.matchAll(/\.select\(\s*'([^']*\bslug\b[^']*)'\s*\)/g)].map((m) => m[1])
if (selects.length === 0) {
  errors.push(`${HOOK}: found ZERO look_categories column selects to inspect. The guard cannot see what it is guarding.`)
}
for (const cols of selects) {
  inspected++
  if (!/\bis_residence\b/.test(cols)) {
    errors.push(
      `${HOOK}: SELECT '${cols}' omits \`is_residence\`.\n` +
      `    Every row then reads is_residence === undefined, so NO client has homes and nothing throws.`,
    )
  }
}

// ── 2. no place names in the residence module ──
inspected++
const libCode = lib.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
const PLACES = /\b(aspen|hamptons|new-york-city|sayulita|chicago|mexico-city)\b/i
if (PLACES.test(libCode)) {
  errors.push(
    `${LIB} names a specific home outside a comment.\n` +
    `    Which categories are homes is data (look_categories.is_residence), not a list in the code.\n` +
    `    That is the whole of ADR-0111 -- a name here means someone has to deploy to add a home.`,
  )
}
inspected++
if (/RESIDENCE_SLUGS|PSEUDO_CATEGORY/.test(lib)) {
  errors.push(`${LIB} still exports a hardcoded residence slug list. Derive homes from the rows instead.`)
}

// ── 3. the toggle exists, is reachable without hover, and says what it does ──
inspected++
// Wired through handleToggleHome, which asks before it writes. check-residence-toggle.mjs
// owns the confirm itself; this only proves the control is still there and still reaches it.
if (!/onClick=\{\(\) => handleToggleHome\(cat\)\}/.test(panel)) {
  errors.push(
    `${PANEL} has no Home toggle wired to handleToggleHome.\n` +
    `    Without it a stylist cannot make a category a home, which is the point of the column.`,
  )
}
inspected++
{
  // The toggle's own className must never start hidden. Grab the button that calls
  // setCategoryResidence and check the classes it renders with.
  const m = panel.match(/onClick=\{\(\) => handleToggleHome\(cat\)\}\s*\n\s*className=\{`([^`]*)`/)
  if (!m) {
    errors.push(`${PANEL}: could not find the Home toggle's className to inspect. The guard cannot see what it is guarding.`)
  } else if (/opacity-0[^.\d]/.test(m[1]) || /opacity-0$/.test(m[1])) {
    errors.push(
      `${PANEL}: the Home toggle is hover-only (opacity-0).\n` +
      `    The stylists work on iPads. Hover does not exist there, so the control does not either (ADR-0108).`,
    )
  }
}
inspected++
if (!/aria-pressed=\{cat\.is_residence\}/.test(panel)) {
  errors.push(`${PANEL}: the Home toggle does not report its state with aria-pressed.`)
}

// ── 4. the deletion refusal keys on the flag and names the way out ──
inspected++
if (/isResidenceSlug/.test(deletion)) {
  errors.push(`${DELETION} still decides "is this a home" from the slug. It must read the row's flag.`)
}
inspected++
if (!/if \(isResidence\)/.test(deletion)) {
  errors.push(`${DELETION} no longer refuses on a home. Deleting one breaks the client's home page silently.`)
}
inspected++
if (!/untick Home/i.test(deletion)) {
  errors.push(
    `${DELETION}: the refusal does not tell the stylist how to remove a home.\n` +
    `    It is a checkbox now, so the message must say to untick Home first. "Ask Karl" is a dead end.`,
  )
}

if (inspected === 0) {
  console.error('FAIL — check-category-residence inspected nothing.')
  process.exit(1)
}
if (errors.length) {
  console.error(`\nFAIL — check-category-residence (${inspected} inspected)\n`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}
console.log(`category-residence: ${inspected} checks over ${selects.length} taxonomy SELECT(s), the Home toggle and the deletion refusal. A home is data, and the control for it is visible without hover.`)
