#!/usr/bin/env node
// check-look-numbering (ADR-0161). Runs check-look-numbering.sql against LIVE through the linked
// Supabase CLI in ~/Downloads/wsg-dashboard. The SQL builds a throwaway client, walks renumber,
// archive, restore, To Try tick/untick, delete, new look, a GoodPix-style name overwrite, a drag
// and undo, then always raises so the whole thing rolls back. Passes only on 'CHECK_OK'.
// A run that measured nothing fails: the OK line must report its assertion count.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const sql = join(dirname(fileURLToPath(import.meta.url)), 'check-look-numbering.sql')
const cwd = process.env.WSG_DASHBOARD_DIR || join(homedir(), 'Downloads', 'wsg-dashboard')
let out = ''
try {
  out = execFileSync('supabase', ['db', 'query', '--linked', '-f', sql], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
} catch (e) {
  out = `${e.stdout ?? ''}${e.stderr ?? ''}`
}
const ok = out.match(/CHECK_OK (\d+) assertions[^"\\]*/)
if (ok && Number(ok[1]) >= 17) {
  console.log(`check-look-numbering: PASS. ${ok[0]}`)
  process.exit(0)
}
const fail = out.match(/CHECK_FAIL[^"\\]*/) || out.match(/ERROR:[^"\\]*/)
console.error(`check-look-numbering: FAIL. ${fail ? fail[0] : out.slice(0, 400)}`)
process.exit(1)
