// @checks guard
// A stylist names the "Custom" heading per client in Categorize > Nesting (Cynthia for Keil Cadieux,
// 11/04), and the lookbook shows that name. FAILS before: no lib/customHeading.ts and no box in Nesting.
// The builder writes gp_clients.raw.custom_heading; atelier-looks reads it with its own twin, so the
// key and the tidy-up rule must match on both sides or her saved name silently never shows.
import { readFileSync, existsSync } from 'node:fs'
const lib = readFileSync('src/lib/customHeading.ts', 'utf8')
const hook = readFileSync('src/hooks/useCustomHeading.ts', 'utf8')
const tab = readFileSync('src/components/categorize/NestingTab.tsx', 'utf8')
const twinPath = '../atelier-looks/src/lib/customHeading.ts'
const twin = existsSync(twinPath) ? readFileSync(twinPath, 'utf8') : null // a checkout without the lookbook beside it skips the twin check
const fails = []
const need = (ok, m) => { if (!ok) fails.push(m) }
const rule = (s) => (s.match(/value\.replace\(\/\\s\+\/g, ' '\)\.trim\(\)\.slice\(0, CUSTOM_HEADING_MAX\)\.trim\(\)/) || [null])[0]
const max = (s) => (s.match(/CUSTOM_HEADING_MAX = (\d+)/) || [])[1]
need(/out\.custom_heading = clean/.test(lib), 'builder writes raw.custom_heading')
need(/else delete out\.custom_heading/.test(lib), 'an empty name takes the key off, so she gets "Custom" back')
need(/withCustomHeading\(row\.raw, next\)/.test(hook) && /\.select\('raw'\)/.test(hook), 'the save reads raw fresh and asks for the row back')
need(/<CustomHeadingPanel clientId=\{clientId\}/.test(tab), 'Nesting shows the heading box')
need(!!rule(lib), 'builder tidy-up rule missing')
need(!twin || /r\.custom_heading/.test(twin), 'atelier-looks reads a different key: keep raw.custom_heading on both sides')
need(!twin || rule(twin) === rule(lib), 'atelier-looks tidies the name differently: keep lib/customHeading.ts the same on both sides')
need(!twin || max(twin) === max(lib), 'atelier-looks caps the name at a different length')
if (fails.length) { console.error('check-custom-heading FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('check-custom-heading: ok' + (twin ? ' (twin checked)' : ''))
