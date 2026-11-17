// Add Item picks the season (Cynthia Dada for Peyton Wheeler, 2026-11-17): "When adding a new item
// to a closet, can you make it possible to choose SS or FW for it in there?"
// On a client whose Collection shows seasons, Add Item offers SS / FW / Both / No season (default
// No season), and Add to Collection saves the same season markers the bulk buttons in Categorize >
// Collection write (lib/pieceSeasons.ts withSeasonChoice). Clients with the switch off get today's
// dialog, and a piece added with No season is saved exactly as before.
// FAILS before: Add Item has no season choice and publish never writes client_edited_fields.
import { readFileSync } from 'node:fs'
const dlg = readFileSync('src/components/layout/AddItemDialog.tsx', 'utf8')
const api = readFileSync('api/add-closet-item.ts', 'utf8')
const fails = []
const need = (ok, m) => { if (!ok) fails.push(m) }

need(/useCollectionSeasons\(clientId\)/.test(dlg), 'Add Item reads the client\'s season switch')
need(/seasonsOn\s*&&/.test(dlg), 'the season choice shows only when her Collection shows seasons')
need(/useState<SeasonChoice>\('none'\)/.test(dlg), 'the season starts at No season')
need(/withSeasonChoice\(null, seasonsOn \? season : 'none'\)/.test(dlg), 'the markers come from withSeasonChoice, the bulk buttons\' rule, and only when the switch is on')
need(/client_edited_fields:/.test(dlg), 'Add to Collection sends the season markers')

// The publish route keeps only season markers from the request and writes nothing new for No season.
const m = api.match(/export function seasonFieldsOf[\s\S]*?\n}\n/)
need(m, 'api/add-closet-item.ts has seasonFieldsOf')
need(/\.\.\.\(seasonFields \? \{ client_edited_fields: seasonFields \} : \{\}\)/.test(api), 'publish writes client_edited_fields only when a season was picked')
if (m) {
  const js = m[0].replace(/^export /, '').replace(/\(body: any\): string\[\] \| null/, '(body)')
  const seasonFieldsOf = new Function(`${js}; return seasonFieldsOf`)()
  const eq = (a, b, what) => need(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)
  eq(seasonFieldsOf({ client_edited_fields: ['season-fw'] }), ['season-fw'], 'FW')
  eq(seasonFieldsOf({ client_edited_fields: ['season-ss', 'season-fw'] }), ['season-ss', 'season-fw'], 'Both')
  eq(seasonFieldsOf({ client_edited_fields: null }), null, 'No season')
  eq(seasonFieldsOf({}), null, 'an older page that sends nothing')
  eq(seasonFieldsOf({ client_edited_fields: ['name', 'home', 'season-ss', 'season-ss'] }), ['season-ss'], 'only season markers, once each')
}
if (fails.length) { console.error('check-additem-season FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('check-additem-season: ok')
