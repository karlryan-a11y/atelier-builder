// SS / FW / All on her Collection (Cynthia Dada for Peyton Wheeler, 2026-11-05): a stylist marks
// pieces SS, FW or Both in bulk in Categorize > Collection, and turns the tabs on per client.
// FAILS before: no lib/pieceSeasons.ts, no switch, no bulk season buttons.
import { readFileSync, existsSync } from 'node:fs'
const LIB = 'src/lib/pieceSeasons.ts'
const fails = []
const need = (ok, m) => { if (!ok) fails.push(m) }
const lib = existsSync(LIB) ? readFileSync(LIB, 'utf8') : ''
const col = readFileSync('src/components/categorize/CollectionTab.tsx', 'utf8')
const hook = existsSync('src/hooks/useCollectionSeasons.ts') ? readFileSync('src/hooks/useCollectionSeasons.ts', 'utf8') : ''
need(lib, `${LIB} is missing`)
need(/SEASON_MARKERS[^=]*=\s*\{ ss: 'season-ss', fw: 'season-fw' \}/.test(lib), 'the season markers must stay season-ss / season-fw (her lookbook reads them)')
need(/const kept = \(fields \?\? \[\]\)\.filter\(\(f\) => !isSeasonMarker\(f\)\)/.test(lib), 'a season choice must keep her other markers (name, home)')
need(/raw->collection_seasons_on/.test(hook) && /\.\.\.\(\(cur as/.test(hook), 'the switch lives in gp_clients.raw and the write keeps the rest of raw')
need(/useCollectionSeasons\(clientId\)/.test(col), 'Collection has the "Seasons on her Collection page" switch')
need(/SEASON_CHOICES\.map/.test(col) && /setSeasonOn\(\[\.\.\.selected\]/.test(col), 'the selected pieces get SS / FW / Both / No season in one tap')
need(/\.eq\('client_id', clientId\)\.select\('id'\)/.test(col), 'each season write names the client and asks for its row back (ADR-0108)')
need(/filter\(\(f\) => !isSeasonMarker\(f\)\)(\.filter\(\(f\) => !is\w+Marker\(f\)\))*\.map\(\(f\) => FIELD_LABEL/.test(col), 'a season is not shown as "set by" the client')
// The lookbook reads the same file. A checkout without the lookbook beside it skips the twin check.
const twinPath = '../atelier-looks/' + LIB
if (existsSync(twinPath)) need(readFileSync(twinPath, 'utf8') === lib, `${LIB} differs from atelier-looks: one rule, or the tabs she sees disagree with what the stylist marked`)
if (fails.length) { console.error('check-piece-seasons FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('check-piece-seasons: ok')
