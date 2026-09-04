#!/usr/bin/env node
/**
 * Card-action parity guard.
 *
 * The bug this exists for: Categorize renders per-card actions in TWO grids (the
 * draft queue and the published "arrange" grid), and each grid listed its actions
 * inline. Looks got a Rename button in both. Capsules got Edit in one grid and
 * nothing in the other, and Rename in neither — so the only way to retitle a
 * capsule was Canvas -> Update Capsule, which rewrites the whole row to change one
 * string, and which does not exist at all for "Capsule from Looks" capsules.
 * Reported by Karl on Margaux Ellery's "Business Conference Weekend In D.C."
 *
 * The rule: wherever a grid offers `lookCardActions`, it must offer
 * `capsuleCardActions` too. Both are single definitions, so parity here means a
 * third grid cannot silently drop an action for one kind of item.
 *
 * Exits non-zero on a mismatch AND on finding nothing to inspect — a guard that
 * measured zero grids is a failure, not a pass.
 */
import { readFileSync } from 'node:fs'

const FILE = 'src/components/categorize/CategorizePanel.tsx'
const src = readFileSync(FILE, 'utf8')

const lines = src.split('\n')
const lookSites = []
const capsuleSites = []
lines.forEach((line, i) => {
  if (/mode === 'looks'\s*&&\s*lookCardActions\(/.test(line)) lookSites.push(i + 1)
  if (/mode === 'capsules'\s*&&\s*capsuleCardActions\(/.test(line)) capsuleSites.push(i + 1)
})

const defines = (name) => new RegExp(`const ${name}\\s*=`).test(src)

const problems = []
if (!defines('lookCardActions')) problems.push('lookCardActions is not defined')
if (!defines('capsuleCardActions')) problems.push('capsuleCardActions is not defined')
if (lookSites.length === 0) problems.push('no per-card action grids found — the guard inspected nothing')
if (lookSites.length !== capsuleSites.length) {
  problems.push(
    `grid parity broken: lookCardActions rendered in ${lookSites.length} grid(s) (lines ${lookSites.join(', ') || 'none'}) ` +
    `but capsuleCardActions in ${capsuleSites.length} (lines ${capsuleSites.join(', ') || 'none'})`,
  )
}

// Rename must reach both kinds, or a stylist is back to rebuilding a capsule to retitle it.
for (const [fn, handler] of [['lookCardActions', 'handleRenameLook'], ['capsuleCardActions', 'handleRenameCapsule']]) {
  const body = src.split(`const ${fn} =`)[1]?.split('\n  )\n')[0] ?? ''
  if (!body.includes(handler)) problems.push(`${fn} does not offer ${handler} — that kind of item cannot be renamed`)
}

console.log(`card-action parity: inspected ${FILE}`)
console.log(`  grids rendering look actions:    ${lookSites.length} (lines ${lookSites.join(', ') || 'none'})`)
console.log(`  grids rendering capsule actions: ${capsuleSites.length} (lines ${capsuleSites.join(', ') || 'none'})`)

if (problems.length) {
  console.error('\nFAIL')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('PASS — every grid offers the same actions for looks and capsules, and both can be renamed.')
