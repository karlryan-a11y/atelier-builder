// The Style picker lists clients with a lookbook (Cynthia, 2026-10-08: "remove the Keil Cadieux
// ... closets"). FAILS before: every directory row was listed, so Keil's QuickBooks billing record
// (no lookbook, holds her hours) sat beside her real account, and migration 040 did not exist.
import { readFileSync, existsSync } from 'node:fs'
const dir = readFileSync('src/lib/clientDirectory.ts', 'utf8')
const bar = readFileSync('src/components/layout/ClientBar.tsx', 'utf8')
const app = readFileSync('src/App.tsx', 'utf8')
const fails = []
const need = (ok, msg) => { if (!ok) fails.push(msg) }
need(/hasLookbook: !!c\.microsite \|\| \(c\.pieces/.test(dir), 'directory rows must say whether there is a lookbook')
need(/styleOnly \? all\.filter\(\(c\) => c\.hasLookbook\)/.test(bar), 'ClientBar must filter in Style')
need((app.match(/<ClientBar styleOnly \/>/g) ?? []).length === 1 && (app.match(/<ClientBar \/>/g) ?? []).length === 1, 'only the Style bar filters; Shop keeps every record')
need(existsSync('migrations/040_client_directory_hides_combined.sql') && /where c\.merged_into is null/.test(readFileSync('migrations/040_client_directory_hides_combined.sql', 'utf8')), 'migration 040 hides combined accounts')
if (fails.length) { console.error('check-style-picker-lookbooks FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('check-style-picker-lookbooks: ok')
