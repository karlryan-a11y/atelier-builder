#!/usr/bin/env node
/**
 * Guard: a season is a property of a category, set in Categorize (ADR-0147).
 *
 * 1. A COLUMN LEFT OUT OF A SELECT (ADR-0103). Every look_categories read that loads the row a
 *    stylist sees (the ones that already carry is_residence) must also carry `season`, or every
 *    SS/FW button reads undefined and shows blank. This happened: lookCategoriesLoad.ts arrived
 *    from main after the season branch was cut and never asked for it.
 * 2. A HOVER-ONLY CONTROL (ADR-0108). The stylists are on iPads. A season button at opacity-0
 *    until hover is one they cannot find, which is what Cynthia reported on 2026-09-24.
 *
 * Reports the count inspected and exits non-zero at zero, per HARD-RULES.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const errors = []
let selects = 0

const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f)
  return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
})

for (const file of walk(join(ROOT, 'src'))) {
  const src = readFileSync(file, 'utf8')
  const re = /from\('look_categories'\)[\s\S]{0,200}?\.select\('([^']*)'\)/g
  let m
  while ((m = re.exec(src))) {
    const cols = m[1]
    if (!/\bis_residence\b/.test(cols)) continue // a narrow read (id, label) that never feeds the row
    selects++
    if (!/\bseason\b/.test(cols)) errors.push(`${file.replace(ROOT, '')}: selects is_residence but not season (ADR-0103)`)
  }
}

const panel = readFileSync(join(ROOT, 'src/components/categorize/CategorizePanel.tsx'), 'utf8')
const btn = panel.match(/setCategorySeason\(cat\.id[\s\S]{0,600}?className=\{`([^`]*)`\}/)
if (!btn) errors.push('CategorizePanel.tsx: no season button found on the category row')
else if (/(^|[\s'])opacity-0(\s|')/.test(btn[1])) errors.push('CategorizePanel.tsx: the season button is opacity-0 until hover, invisible on an iPad (ADR-0108)')

console.log(`category-season: ${selects} category row read(s) inspected, season button ${btn ? 'found' : 'MISSING'}`)
if (selects === 0) { console.error('❌ category-season: inspected nothing'); process.exit(1) }
if (errors.length) { for (const e of errors) console.error(`   ❌ ${e}`); process.exit(1) }
console.log('✅ category-season: every category row read carries season, and the button is visible without hover')
