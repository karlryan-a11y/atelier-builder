// Her homes come first where a stylist picks pieces (Cynthia, 2026-10-08, Keil Cadieux: "how do I
// know what garments belong to what residence? I don't see the categories for the residence").
// FAILS before: Canvas chips were one A to Z list (Creekside behind "Show all 45 categories"), the
// Collection rail listed homes inside Custom, and a slug label kept its hyphen ("Carlton-Landing").
import { readFileSync } from 'node:fs'
const panel = readFileSync('src/components/layout/ClosetPanel.tsx', 'utf8')
const cat = readFileSync('src/components/categorize/CategorizePanel.tsx', 'utf8')
const gc = readFileSync('src/lib/garmentCategory.ts', 'utf8')
const fails = []
const need = (ok, msg) => { if (!ok) fails.push(msg) }
need(/useHomes\(activeClient\?\.id/.test(panel), 'Canvas chips must read her homes')
need(/Number\(!!b\.home\) - Number\(!!a\.home\)/.test(panel), 'Canvas chips must put homes first')
need(/data-homes-rail/.test(cat) && cat.indexOf('data-homes-rail') < cat.indexOf('{SIDEBAR_STRUCTURE.map((node) => {'), 'Collection rail must show Homes above Clothing')
need(/!\(showResidences && residenceSlugs\.has\(s\)\)/.test(cat), 'homes must not repeat inside Custom')
// The label rule itself, run: a slug reads as words.
const fn = gc.match(/slug\.replace\(\/-\/g, ' '\)\.replace\(([^\n]+)\)\n/)
need(!!fn, 'labelForCategory must turn hyphens into spaces')
const label = (s) => s.replace(/-/g, ' ').replace(/(^|\s)(\w)/g, (_m, p, c) => p + c.toUpperCase())
need(label('carlton-landing') === 'Carlton Landing' && label('travel-shoes') === 'Travel Shoes', 'label rule')
if (fails.length) { console.error('check-homes-first FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('check-homes-first: ok')
