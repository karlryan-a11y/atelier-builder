// Size 28 on the canvas text sizes (Cynthia, 2026-10-09). FAILS before: 24 then 32.
import { readFileSync } from 'node:fs'
const s = readFileSync('src/components/canvas/CanvasToolbar.tsx', 'utf8')
const m = s.match(/const FONT_SIZES = \[([^\]]+)\]/)
const sizes = m ? m[1].split(',').map((x) => Number(x.trim())) : []
if (!sizes.includes(28) || sizes.some((v, i) => i && v <= sizes[i - 1])) { console.error('check-font-28 FAILED: sizes must include 28, in order'); process.exit(1) }
console.log('check-font-28: ok')
