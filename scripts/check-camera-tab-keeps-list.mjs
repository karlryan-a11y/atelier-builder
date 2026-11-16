// @checks guard
// Tapping "From the camera" when it is already picked keeps the list of pieces waiting (Paige Berndt, 2026-11-16).
// FAILS before: the tap always emptied the list, and the camera screen only sends its list again when the list
// changes, so the sidebar said "Nothing from the camera is ready yet." beside a piece that was waiting.
import { readFileSync } from 'node:fs'
const src = readFileSync('src/components/intake/IntakeInbox.tsx', 'utf8')
const fails = []
const at = src.indexOf("['camera', 'From the camera'")
const tap = at < 0 ? '' : src.slice(src.indexOf('onClick={() => {', at), src.indexOf('}}', src.indexOf('onClick={() => {', at)))
if (!tap) fails.push('the From the camera / Uploads buttons were not found')
else if (!/if \(k !== reviewSrc\) \{[^}]*setCap\(/.test(tap)) fails.push('the list may only be emptied when the stylist switches to the other list, not on a tap of the one already picked')
if (fails.length) { console.error('check-camera-tab-keeps-list FAILED:\n  ' + fails.join('\n  ')); process.exit(1) }
console.log('check-camera-tab-keeps-list: ok (1 button rule)')
