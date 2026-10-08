// A home narrows the piece list; it does not add to it (Cynthia, 2026-10-08, Keil Cadieux:
// Creekside + Denim showed 1,234 pieces, not Creekside's denim). And "Not in this look" is in the
// builder's "Styled in N looks" window, where she works ("where does it say not in this look?").
// FAILS before: both filters were one union, and the window had no such button.
import { readFileSync } from 'node:fs'
const col = readFileSync('src/components/categorize/CollectionTab.tsx', 'utf8')
const pan = readFileSync('src/components/layout/ClosetPanel.tsx', 'utf8')
const hook = readFileSync('src/hooks/useItemLookUsage.ts', 'utf8')
const fails = []
const need = (ok, m) => { if (!ok) fails.push(m) }
const narrows = /\(homesOn\.length === 0 \|\| cats\.some\(\(c\) => homesOn\.includes\(c\)\)\)\s*&& \(typesOn\.length === 0 \|\| cats\.some\(\(c\) => typesOn\.includes\(c\)\)\)/
need(narrows.test(col), 'Collection: a home must narrow the garment filter')
need(narrows.test(pan), 'Canvas: a home chip must narrow the garment chips')
// The rule, run on Keil's shape: Creekside + Denim.
const homes = new Set(['creekside', 'carlton-landing'])
const pick = (sel, cats) => { const h = sel.filter((c) => homes.has(c)), t = sel.filter((c) => !homes.has(c)); return (h.length === 0 || cats.some((c) => h.includes(c))) && (t.length === 0 || cats.some((c) => t.includes(c))) }
need(pick(['creekside', 'denim'], ['denim', 'creekside']) && !pick(['creekside', 'denim'], ['skirts', 'creekside']) && !pick(['creekside', 'denim'], ['denim', 'carlton-landing']), 'rule: Creekside + Denim is the denim at Creekside')
need(pick(['denim', 'skirts'], ['skirts']), 'rule: two garment types still add')
need(/removeItemFromLook/.test(hook) && /data-not-in-look=\{lk\.id\}/.test(col), 'the Styled in N looks window needs Not in this look')
if (fails.length) { console.error('check-homes-narrow FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('check-homes-narrow: ok')
