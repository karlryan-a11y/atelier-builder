// Patterns & Textures (Cynthia for Peyton Wheeler, 11/05): Atelier sorts a client's pieces into ten
// patterns, the stylist checks and fixes them on Categorize > Collection, and the client filters her
// Collection by them. FAILS before: no lib/piecePatterns.ts and nothing on the Collection cards.
// The builder writes the markers and atelier-looks reads them with the same file, so the two copies
// must be identical or a pattern Cynthia sets never shows on the client's page.
import { readFileSync, existsSync } from 'node:fs'
const lib = readFileSync('src/lib/piecePatterns.ts', 'utf8')
const hook = readFileSync('src/hooks/usePiecePatterns.ts', 'utf8')
const tab = readFileSync('src/components/categorize/CollectionTab.tsx', 'utf8')
const twinPath = '../atelier-looks/src/lib/piecePatterns.ts'
const twin = existsSync(twinPath) ? readFileSync(twinPath, 'utf8') : null // a checkout without the lookbook beside it skips the twin check
const fails = []
const need = (ok, m) => { if (!ok) fails.push(m) }
need(/patterns_on === true/.test(lib), 'only a client with raw.patterns_on gets patterns')
need(/const kept = \(fields \?\? \[\]\)\.filter\(\(f\) => !isPatternMarker\(f\)\)/.test(lib), 'a pattern change must keep every other marker on the piece')
need(/\.eq\('client_id', clientId\)\.select\('id, client_edited_fields'\)/.test(hook), 'the save names the client and asks for the row back')
need(/const patternsHere = usePatternsOn\(clientId\)/.test(tab), 'the Collection tab reads her switch')
need(/\{patternsHere && <PatternPicker /.test(tab), 'each card shows its patterns, only when she has them on')
need(/\{patternsHere && \(\s*<div data-pattern-filter/.test(tab), 'the pattern row shows only when she has them on')
need(/\.filter\(\(f\) => !isPatternMarker\(f\)\)\.map\(\(f\) => FIELD_LABEL\[f\] \?\? f\)/.test(tab), 'a pattern must never read as "set by" the client')
// The Edit dialog's save releases only the fields a stylist changed; anything else (a pattern) stays.
need(/return true\s*\}\)\s*if \(nextOwned\.length !== owned\.length\)/.test(tab), 'the Edit save must keep markers it does not own')
need(!twin || twin === lib, 'atelier-looks has a different lib/piecePatterns.ts: keep the two copies the same')
if (fails.length) { console.error('check-piece-patterns FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('check-piece-patterns: ok' + (twin ? ' (twin checked)' : ''))
