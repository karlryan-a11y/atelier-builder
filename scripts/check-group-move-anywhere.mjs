// With 2+ pieces selected, a press on empty space inside the selection box moves them, and pieces
// inside the box stay clickable (Cynthia, 2026-10-08; review 2026-10-08). FAILS before: the gap
// started a new selection box; then shouldOverdrawWholeArea covered the pieces so nothing inside
// could be clicked. Also: a group move is ONE undo step.
import { readFileSync } from 'node:fs'
const s = readFileSync('src/components/canvas/LookCanvas.tsx', 'utf8')
const fails = []
const need = (ok, m) => { if (!ok) fails.push(m) }
const i = s.indexOf('ref={groupTrRef}')
const tag = s.slice(s.lastIndexOf('<Transformer', i), s.indexOf('/>', i))
need(!/shouldOverdrawWholeArea/.test(tag), 'no invisible sheet over the selection (shouldOverdrawWholeArea)')
need(/tr\.nodes\(\)\.length > 1 && !e\.evt\.shiftKey[\s\S]{0,400}tr\.nodes\(\)\[0\]\.startDrag\(\)/.test(s), 'a press inside the box must start the group move')
need(/if \(dragGroup\.current && dragGroup\.current\.others\.some\(\(o\) => o\.id === id\)\) return/.test(s), 'followers must not open a second group')
need(/justCommitted\.current\.has\(id\)/.test(s), 'followers must not add their own undo steps')
if (fails.length) { console.error('check-group-move-anywhere FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('check-group-move-anywhere: ok')
