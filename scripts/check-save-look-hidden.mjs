#!/usr/bin/env node
// @checks build guard
/**
 * Guard: the Save Look box on the Canvas never offers a category she hid in Categorize.
 *
 * Cynthia Dada, 2026-10-01, on Janet Foutty: "On Canvas, these FW categories shouldn't be available
 * to choose from because I got rid of those. They aren't visible on Janet's site." The box listed
 * every look category, hidden or not: 8 of Janet's 21 were hidden and all 8 were offered.
 *
 * Runs the function the dialog ships with, on Janet's shape, and checks the dialog uses it.
 * Reports the count inspected and exits non-zero at zero, per HARD-RULES.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const errors = []
let rules = 0
const eq = (got, want, what) => { rules++; if (JSON.stringify(got) !== JSON.stringify(want)) errors.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) }

const lib = await import('../src/lib/saveLookPills.ts').catch(() => null)
if (!lib?.saveLookPills) errors.push('src/lib/saveLookPills.ts: saveLookPills missing')
else {
  const { saveLookPills } = lib
  const cats = [
    { label: 'Easy Professional', is_hidden: false, season: null },
    { label: 'FW Office Denim', is_hidden: true, season: null },
    { label: 'Zoom Looks', is_hidden: true, season: null },
    { label: 'Fall/Winter', is_hidden: false, season: 'fw' },
    { label: 'Spring/Summer', is_hidden: false, season: 'ss' },
    { label: 'Denim', is_hidden: false, season: null },
  ]
  eq(saveLookPills(cats, []), ['Easy Professional', 'Denim'], 'a new look is offered only the categories on her site, no seasons')
  eq(saveLookPills(cats, ['FW Office Denim']), ['Easy Professional', 'FW Office Denim', 'Denim'], 'a look already in a hidden category still shows it, so it can be taken off')
  eq(saveLookPills(cats, ['zoom looks']), ['Easy Professional', 'Zoom Looks', 'Denim'], 'a hidden category kept on the look matches in any case, one pill')
  eq(lib.categoryLabelFor?.(cats, ' fw office denim '), 'FW Office Denim', 'typing a hidden name ticks the existing category, no second pill')
  eq(lib.categoryLabelFor?.(cats, 'Brand New'), 'Brand New', 'a new name stays as typed')
  eq(saveLookPills(cats, ['Brand New']), ['Easy Professional', 'Denim', 'Brand New'], 'a category made in this box shows')
  eq(saveLookPills(cats.filter((c) => !c.is_hidden), []), ['Easy Professional', 'Denim'], 'a client with nothing hidden sees every category, as before')
  eq(saveLookPills(cats, ['Fall/Winter']), ['Easy Professional', 'Denim'], 'seasons stay on their own row')
}

const dialog = readFileSync(join(ROOT, 'src/components/canvas/SaveLookDialog.tsx'), 'utf8')
rules++
if (!/saveLookPills\(/.test(dialog)) errors.push('SaveLookDialog.tsx: the pills are not built by saveLookPills, so hidden categories can come back')

console.log(`save-look-hidden: ${rules} rule(s) checked`)
if (rules === 0) { console.error('❌ save-look-hidden: checked nothing'); process.exit(1) }
if (errors.length) { for (const e of errors) console.error(`   ❌ ${e}`); process.exit(1) }
console.log('✅ save-look-hidden: Save Look offers only the categories on her site, plus the ones already on the look')
