#!/usr/bin/env node
/**
 * Guard: her homes are managed on Residences, and each home shows its collection and looks
 * (Paige Berndt, 2026-11-13).
 *
 * 1. Residences can add, rename and remove a home, and removing asks first and only stops it
 *    being a home (setCategoryResidence, never deleteCategory).
 * 2. The Looks/Capsules category rail no longer carries the Home switch; a home row there
 *    sends her to Residences instead.
 * 3. Residences is open for every client, so a client with no homes yet can be given her first.
 * 4. A home's pieces are exactly the ones her Collection puts there (homesByItem), and its looks
 *    are the ones filed there first, then the other looks made with its pieces, never archived ones.
 *
 * Reports the count inspected and exits non-zero at zero, per HARD-RULES.
 */
import { readFileSync } from 'node:fs'
import { homeCollection } from '../src/lib/homeCollection.ts'
import { homesByItem } from '../src/lib/residences.ts'

const failures = []
let checked = 0
const need = (ok, msg) => { checked++; if (!ok) failures.push(msg) }

// ── 4. the rule, on a small closet shaped like Danielle York's ──
const rows = [
  { id: 'cat-ny', slug: 'new-york', label: 'New York', is_residence: true },
  { id: 'cat-sf', slug: 'san-francisco', label: 'San Francisco', is_residence: true },
  { id: 'cat-biz', slug: 'business', label: 'Business', is_residence: false },
]
const pieces = [
  { id: 'p1', custom_categories: ['new-york'] },
  { id: 'p2', custom_categories: ['san-francisco'] },
  { id: 'p3', custom_categories: ['San Francisco', 'tops'] },
  { id: 'p4', custom_categories: [] }, // only at New York through a filed look
  { id: 'p5', custom_categories: ['tops'] }, // no home
]
const looks = [
  { id: 'L1', closetItemIds: ['p4'], categoryIds: ['cat-ny'], published: true, archived: false },
  { id: 'L2', closetItemIds: ['p1', 'p2'], categoryIds: ['cat-biz'], published: true, archived: false },
  { id: 'L3', closetItemIds: ['p3'], categoryIds: [], published: false, archived: false },
  { id: 'L4', closetItemIds: ['p1'], categoryIds: ['cat-ny'], published: false, archived: true },
  { id: 'L5', closetItemIds: ['p5'], categoryIds: [], published: true, archived: false },
]
const byItem = homesByItem(pieces, looks, rows)
const ny = homeCollection(rows[0], pieces, looks, byItem)
const sf = homeCollection(rows[1], pieces, looks, byItem)
const ids = (xs) => xs.map((x) => x.id).join(',')
need(ids(ny.pieces) === 'p1,p4', `New York pieces should be p1,p4 (tagged, and in a filed look), got ${ids(ny.pieces)}`)
need(ids(sf.pieces) === 'p2,p3', `San Francisco pieces should be p2,p3 (either spelling), got ${ids(sf.pieces)}`)
need(ids(ny.filed) === 'L1', `New York filed looks should be L1 (not the archived L4), got ${ids(ny.filed)}`)
need(ids(ny.madeWith) === 'L2', `New York's other looks should be L2 (uses p1), got ${ids(ny.madeWith)}`)
need(ids(sf.filed) === '', `San Francisco has no filed look, got ${ids(sf.filed)}`)
need(ids(sf.madeWith) === 'L2,L3', `San Francisco's looks should be L2,L3 (drafts count, a look with no home piece does not), got ${ids(sf.madeWith)}`)

// ── 1-3. where the controls live ──
const PANEL = 'src/components/categorize/CategorizePanel.tsx'
const HOMES = 'src/components/categorize/HomesManager.tsx'
const TAB = 'src/components/categorize/ResidencesTab.tsx'
const panel = readFileSync(PANEL, 'utf8')
let homes = ''
try { homes = readFileSync(HOMES, 'utf8') } catch { /* checked below */ }
const tab = readFileSync(TAB, 'utf8')

need(homes.length > 0, `${HOMES} is missing: Residences has no place to manage her homes.`)
need(/<HomesManager\b/.test(tab), `${TAB} does not show the homes (HomesManager) above the review queue.`)
need(/addHome\(/.test(homes), `${HOMES}: no Add a home control (addHome).`)
need(/renameCategory\(/.test(homes), `${HOMES}: no rename for a home.`)
need(/setCategoryResidence\([^\n]*false[^\n]*window\.confirm/.test(homes), `${HOMES}: Remove must stop it being a home through setCategoryResidence(..., false, window.confirm ...), asking first.`)
need(!/deleteCategory\(/.test(homes), `${HOMES}: Remove must never delete the category.`)
need(/homeCollection\(/.test(homes), `${HOMES}: a home's pieces and looks must come from homeCollection.`)
need(!/aria-pressed=\{cat\.is_residence\}/.test(panel) && !/handleToggleHome\(cat\)/.test(panel),
  `${PANEL}: the Looks/Capsules category rail still has the Home switch. It lives on Residences now.`)
need(/setMode\('residences'\)/.test(panel), `${PANEL}: a home row in the rail does not send her to Residences.`)
need(!/m !== 'residences' \|\| showResidences/.test(panel), `${PANEL}: Residences is still hidden for a client with fewer than two homes, so her first home cannot be added.`)

const hook = readFileSync('src/hooks/useLookCategories.ts', 'utf8')
need(/const addHome = useCallback/.test(hook), 'useLookCategories has no addHome.')
need(/addHome[\s\S]{0,1600}if \(!confirmWith\(plan\.message\)\) return null/.test(hook), 'addHome does not ask before it writes.')

for (const src of [homes, tab]) {
  const strings = [...src.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((m) => m[1]).join(' ')
  need(!/[—–]/.test(strings), 'Residences copy contains an em or en dash.')
}

if (checked === 0) { console.error('FAIL: check-residences-manage inspected nothing.'); process.exit(1) }
if (failures.length) {
  console.error(`\nFAIL: check-residences-manage (${checked} checked)\n`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`residences-manage: ${checked} checks. Homes are added, renamed and removed on Residences, each home shows its pieces and the looks made from them, and the category rail no longer carries the Home switch.`)
