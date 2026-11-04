// The builder counts a home's pieces the way her Collection page does (Karl, 2026-10-08: "make the
// builder match the client page"; Keil Cadieux's Carlton Landing read 233 in the builder, 267 on
// her page). FAILS before: no homesByItem, and both builder filters matched the exact slug only.
import { readFileSync, existsSync } from 'node:fs'
const lib = readFileSync('src/lib/residences.ts', 'utf8')
const col = readFileSync('src/components/categorize/CollectionTab.tsx', 'utf8')
const pan = readFileSync('src/components/layout/ClosetPanel.tsx', 'utf8')
// The lookbook's rule moved from closet.astro into lib/residences.ts piecesAtHomes (2026-11-04),
// when a home picked in Edit Details started to beat both rules.
const twinPath = '../atelier-looks/src/lib/residences.ts'
const twin = existsSync(twinPath) ? readFileSync(twinPath, 'utf8') : null // a checkout without the lookbook beside it skips the twin check
const fails = []
const need = (ok, m) => { if (!ok) fails.push(m) }
need(/export function homesByItem\(/.test(lib), 'lib/residences must export homesByItem')
need(/\[\.\.\.\(item\.custom_categories \?\? \[\]\), item\.category\]/.test(lib), 'rule 1: both fields, any spelling (residenceResolverFor)')
need(/if \(!look\.published \|\| look\.archived\) continue/.test(lib), 'rule 2: published live looks filed under the home')
need(/withHomes\(i\.id, categoriesOf\(/.test(col) && /withHomes\(i\.id, categoriesOf\(/.test(pan), 'Collection and Canvas both use the rule')
// The twin still has both rules; if the lookbook changes, this check is where it shows.
// Rule 3 (Thalia Baca, 2026-11-04): a home she picked in Edit Details is the piece's only home.
need(/export const HOME_PICKED = 'home'/.test(lib) && /if \(!picked\.has\(itemId\)\)/.test(lib), 'rule 3: a picked home beats the legacy field and the looks')
need(!twin || /for \(const c of \[\.\.\.\(p\.custom_categories \?\? \[\]\), p\.category\]\)/.test(twin), 'atelier-looks residences.ts rule 1 changed: update homesByItem to match')
need(!twin || /if \(picked\.has\(itemId\)\) continue;\s*for \(const s of l\.slugs\) add\(itemId, s\)/.test(twin), 'atelier-looks residences.ts rule 2 changed: update homesByItem to match')
need(!twin || /export const HOME_PICKED = 'home'/.test(twin), 'atelier-looks residences.ts rule 3 changed: update homesByItem to match')
if (fails.length) { console.error('check-item-homes FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('check-item-homes: ok')
