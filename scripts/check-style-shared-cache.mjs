#!/usr/bin/env node
/**
 * Shared Style data cache (styling wave 3, item 3).
 *
 * The bug: React Query was installed and unused. Every closet screen (canvas closet, Collection,
 * Colors, Review, Nesting) read the client's whole closet for itself, the pages of that read ran
 * one after another, and the canvas looks/capsules and Categorize lists were re-read on every
 * Style tab switch.
 *
 * This guard holds:
 *   1. The app is wrapped in the one QueryClientProvider (src/main.tsx).
 *   2. useClosetItems, useLooks, useCapsules and useLookCategories read through useQuery with
 *      their styleKeys key, so every screen for a client shares one copy.
 *   3. Every closet screen gets the collection from useClosetItems, and none of them reads
 *      gp_closet_items for itself.
 *   4. Nothing else in src reads the client's whole current collection (the
 *      `.is('transitioned_at', null)` read of gp_closet_items) outside hooks/useClosetItems.ts.
 *   5. The closet pages are read in parallel (Promise.all over .range()).
 *
 * Exits non-zero on a break AND on inspecting nothing.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const failures = []
let checked = 0
const read = (f) => readFileSync(f, 'utf8')

// 1
checked++
if (!/<QueryClientProvider client=\{queryClient\}>/.test(read('src/main.tsx'))) failures.push('src/main.tsx: App is not wrapped in <QueryClientProvider client={queryClient}>')

// 2
const HOOKS = [
  ['src/hooks/useClosetItems.ts', 'closet'],
  ['src/hooks/useLooks.ts', 'looks'],
  ['src/hooks/useCapsules.ts', 'capsules'],
  ['src/hooks/useLookCategories.ts', 'lookCategories'],
]
for (const [file, key] of HOOKS) {
  const src = read(file)
  checked++
  if (!/\buseQuery\(\{/.test(src)) failures.push(`${file}: does not read through useQuery, so each screen loads its own copy`)
  checked++
  if (!new RegExp(`queryKey(:|,)\\s*`).test(src) || !new RegExp(`styleKeys\\.${key}\\(clientId\\)`).test(src)) {
    failures.push(`${file}: does not use the shared key styleKeys.${key}(clientId)`)
  }
}

// 3
const SCREENS = [
  'src/components/layout/ClosetPanel.tsx',
  'src/components/categorize/CollectionTab.tsx',
  'src/components/categorize/ColorAuditPanel.tsx',
  'src/components/categorize/ReviewTab.tsx',
  'src/components/categorize/NestingTab.tsx',
]
for (const file of SCREENS) {
  const src = read(file)
  checked++
  if (!/useClosetItems\(/.test(src)) failures.push(`${file}: does not get the collection from useClosetItems`)
  checked++
  if (/\.from\('gp_closet_items'\)\s*\.select\(/.test(src)) failures.push(`${file}: reads gp_closet_items for itself instead of the shared cache`)
}

// 4
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}
let scanned = 0
for (const file of walk('src')) {
  if (file.endsWith('hooks/useClosetItems.ts')) continue
  scanned++
  const src = read(file)
  for (const m of src.matchAll(/\.from\('gp_closet_items'\)([\s\S]{0,900})/g)) {
    const chain = m[1].split(/\n\s*\n|;\s*\n/)[0]
    if (/\.select\(/.test(chain) && /\.is\('transitioned_at', null\)/.test(chain) && /\.eq\('is_deleted', false\)/.test(chain)) {
      checked++
      failures.push(`${file}: reads the client's whole current collection itself; use useClosetItems (the shared cache)`)
    }
  }
}
checked++
if (scanned < 50) failures.push(`scanned only ${scanned} source files; expected the whole src tree`)

// 5
checked++
const closet = read('src/hooks/useClosetItems.ts')
if (!/Promise\.all\([\s\S]{0,300}\.range\(/.test(closet)) failures.push('src/hooks/useClosetItems.ts: the closet pages are not read in parallel')

console.log(`check-style-shared-cache: ${checked} assertions, ${HOOKS.length} hooks, ${SCREENS.length} closet screens, ${scanned} files scanned`)
if (failures.length) {
  console.log(`FAIL (${failures.length}):`)
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}
console.log('PASS - one cached copy of the closet, looks, capsules and Categorize lists per client, shared by every screen.')
