// Each piece says which home it is at, and the team can find the ones with none (Madeline +
// Maegan, Karl 2026-10-09). FAILS before: no homeLine, no NO_HOME filter.
import { readFileSync } from 'node:fs'
const hook = readFileSync('src/hooks/useItemHomes.ts', 'utf8')
const col = readFileSync('src/components/categorize/CollectionTab.tsx', 'utf8')
const pan = readFileSync('src/components/layout/ClosetPanel.tsx', 'utf8')
const cat = readFileSync('src/components/categorize/CategorizePanel.tsx', 'utf8')
const fails = []
const need = (ok, m) => { if (!ok) fails.push(m) }
need(/export const NO_HOME = '__no_home__'/.test(hook) && /'No home yet'/.test(hook), 'useItemHomes must give a home line and a No home yet filter')
need(/if \(homes\.size === 0\) return ''/.test(hook), 'a client without homes shows no home line')
need(/data-piece-home/.test(col) && /data-piece-home/.test(pan) && /home=\{homeLine\(item\.id\)\}/.test(pan), 'Collection cards and Canvas tiles show the home')
need(/label="No home yet"/.test(cat), 'the Collection rail offers No home yet')
need(/c === NO_HOME/.test(col) && /homes\.has\(c\) \|\| c === NO_HOME/.test(pan), 'No home yet narrows like a home')
if (fails.length) { console.error('check-piece-home FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('check-piece-home: ok')
