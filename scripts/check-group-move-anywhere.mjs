// With 2+ pieces selected, a press anywhere inside the selection box moves them (Cynthia,
// 2026-10-08). FAILS before: the group Transformer had no shouldOverdrawWholeArea, so the space
// between pieces belonged to the board and a press there started a new selection box.
import { readFileSync } from 'node:fs'
const s = readFileSync('src/components/canvas/LookCanvas.tsx', 'utf8')
const i = s.indexOf('ref={groupTrRef}')
const tag = s.slice(s.lastIndexOf('<Transformer', i), s.indexOf('/>', i))
if (!/shouldOverdrawWholeArea/.test(tag)) { console.error('check-group-move-anywhere FAILED: the group selection box must be grabbable everywhere inside (shouldOverdrawWholeArea)'); process.exit(1) }
console.log('check-group-move-anywhere: ok')
