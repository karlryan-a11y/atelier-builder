#!/usr/bin/env node
// Every serverless function must require a signed-in team member.
//
// Each file in api/ runs with the SERVICE-ROLE key, which bypasses every row rule in the database,
// and each one sets CORS '*'. Before this guard, four of them (create-client, add-closet-item,
// store-image, heic-convert) checked nothing at all: knowing the URL was enough to create a client,
// write a closet row, store an image, or spend our Claude and Photoroom credits.
//
// The one documented exception is shopping-ingest, whose caller is an outside tool (Cowork) with no
// login. Its session_id uuid is the capability token, and it can only write that one session.
//
// Reports the count inspected; zero files is a failure.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const API = join(ROOT, 'api')

// name -> why it is allowed to answer an anonymous caller
const EXCEPTIONS = {
  'shopping-ingest.ts':
    'external caller (Cowork); the session_id uuid is the capability token and scopes every write',
}

const files = readdirSync(API).filter((f) => /\.tsx?$/.test(f) && !f.startsWith('_'))
const failures = []
const gated = []

for (const file of files) {
  const text = readFileSync(join(API, file), 'utf8')
  if (!/export default/.test(text)) continue // not an endpoint

  const hasGate = /requireStaff\s*\(\s*req\s*,\s*res\s*\)/.test(text)
  if (EXCEPTIONS[file]) {
    if (hasGate) failures.push(`${file}: listed as an exception but now gates. Remove the exception.`)
    continue
  }
  if (!hasGate) {
    failures.push(`${file}: no requireStaff(req, res) gate - anyone on the internet can call it`)
    continue
  }
  // The gate must run before any work: no service-role fetch may appear above it.
  const gateAt = text.search(/requireStaff\s*\(\s*req\s*,\s*res\s*\)/)
  const handlerAt = text.search(/export default async function handler/)
  // Config guards (if (!SUPABASE_URL || !SERVICE_KEY) ...) are fine above the gate; real work is
  // anything awaited.
  // Drop the gate's own "const caller = await " tail before looking for earlier work.
  const between = text.slice(handlerAt, gateAt).replace(/=\s*await\s*$/, '')
  if (/\bawait\b/.test(between)) {
    failures.push(`${file}: does work before the sign-in gate`)
    continue
  }
  gated.push(file)
}

if (files.length === 0) failures.push('api/: inspected 0 files')

console.log(
  `check-api-auth: inspected ${files.length} endpoints - ${gated.length} gated, ` +
    `${Object.keys(EXCEPTIONS).length} documented exception(s)`
)

if (failures.length) {
  console.error('\nFAIL - a service-role endpoint answers anonymous callers:')
  for (const f of failures) console.error(`  - ${f}`)
  console.error("\nAdd: const caller = await requireStaff(req, res); if (!caller) return")
  process.exit(1)
}
console.log('PASS - every endpoint requires a signed-in team member.')
