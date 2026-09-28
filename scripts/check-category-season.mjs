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

// ── ADR-0154: the per-client switch and what unlocks it ──
let rules = 0
const lib = await import('../src/lib/lookSeasons.ts').catch(() => null)
if (!lib) errors.push('src/lib/lookSeasons.ts: missing (ADR-0154)')
else {
  const { seasonOfTag, seasonFromGoodPixRaw, switchState, categoryIdsForChoice, looksNeedingSeason } = lib
  const eq = (got, want, what) => { rules++; if (JSON.stringify(got) !== JSON.stringify(want)) errors.push(`lookSeasons: ${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) }
  // GoodPix tags, as Janet Foutty's actually read.
  eq(seasonOfTag('ss office casual'), 'ss', '"ss office casual"')
  eq(seasonOfTag('FW25 Work'), 'fw', '"FW25 Work"')
  eq(seasonOfTag('holiday looks'), null, '"holiday looks" names no season')
  eq(seasonOfTag('classic waterfall'), null, 'whole words only ("classic", "waterfall")')
  eq(seasonOfTag('spring summer fall winter'), null, 'a tag naming both seasons is year-round, not a guess')
  eq(seasonFromGoodPixRaw({ content_tags: [{ name: 'ss denim looks' }, { name: 'fw work' }] }), null, 'tags that disagree suggest nothing')
  const cats = [
    { id: 'ss1', season: 'ss', sort_order: 2 }, { id: 'fw1', season: 'fw', sort_order: 1 },
    { id: 'bp', season: null, sort_order: 3 }, { id: 'ss-hidden', season: 'ss', sort_order: 0, is_hidden: true },
  ]
  eq(categoryIdsForChoice('both', cats), ['ss1', 'fw1'], 'Both files into one SS and one FW category, never a hidden one')
  eq(categoryIdsForChoice('ss', [{ id: 'fw1', season: 'fw', sort_order: 0 }]), [], 'no SS category means nothing is filed, not a wrong one')
  const looks = [
    { id: 'a', categoryIds: ['bp', 'fw1'], published: true, archived: false },
    { id: 'b', categoryIds: ['bp'], published: true, archived: false, gpSeason: 'ss' },
    { id: 'draft', categoryIds: [], published: false, archived: false },
    { id: 'gone', categoryIds: [], published: true, archived: true },
  ]
  eq(looksNeedingSeason(looks, cats).map((l) => l.id), ['b'], 'only looks she can SEE need a season (drafts and archived do not)')
  eq(switchState(looks, cats), { hasBothSeasons: true, needing: 1, suggestable: 1, canTurnOn: false }, 'one unfiled look keeps the switch locked')
  eq(switchState(looks.slice(0, 1), cats).canTurnOn, true, 'every look filed unlocks the switch')
  eq(switchState(looks.slice(0, 1), [cats[0], cats[2]]).canTurnOn, false, 'no FW category keeps it locked')
}
const bar = readFileSync(join(ROOT, 'src/components/categorize/SeasonsPanel.tsx'), 'utf8')
rules++
if (!/disabled=\{[^}]*!on && !st\.canTurnOn/.test(bar)) errors.push('SeasonsPanel.tsx: the switch can be turned on before every look has a season (ADR-0154)')
const dialog = readFileSync(join(ROOT, 'src/components/canvas/SaveLookDialog.tsx'), 'utf8')
rules++
if (!/disabled=\{saving \|\| needsSeason\}/.test(dialog)) errors.push('SaveLookDialog.tsx: a look can be saved with no season while seasons are on for her (ADR-0154)')
const panel2 = readFileSync(join(ROOT, 'src/components/categorize/CategorizePanel.tsx'), 'utf8')
rules++
if (!/<SeasonsBar/.test(panel2)) errors.push('CategorizePanel.tsx: the Seasons bar is not mounted on the Looks tab')

console.log(`category-season: ${selects} category row read(s) inspected, season button ${btn ? 'found' : 'MISSING'}, ${rules} switch rule(s) checked`)
if (rules === 0) { console.error('❌ category-season: no switch rules ran'); process.exit(1) }
if (selects === 0) { console.error('❌ category-season: inspected nothing'); process.exit(1) }
if (errors.length) { for (const e of errors) console.error(`   ❌ ${e}`); process.exit(1) }
console.log('✅ category-season: every category row read carries season, and the button is visible without hover')
