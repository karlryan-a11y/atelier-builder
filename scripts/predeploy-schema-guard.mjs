#!/usr/bin/env node
/**
 * Pre-deploy schema guard.
 *
 * Catches the class of incident where deployed code SELECTs a column (or queries
 * a table) that does not exist on the target Supabase database — which makes
 * PostgREST return 42703/PGRST and the app silently shows empty results
 * (e.g. the 2026-06-24 "NO PIECES FOUND" Style-canvas outage: code selected
 * gp_closet_items.category before migration 006 was applied to live).
 *
 * What it does: scans src/ for `.from('table').select('cols')` chains, then asks
 * the TARGET database (via PostgREST `?select=cols&limit=0`) whether each query
 * is valid. Any error → non-zero exit, so the deploy is blocked.
 *
 * Usage:
 *   node scripts/predeploy-schema-guard.mjs            # uses .env.local
 *   SUPABASE_URL=... SUPABASE_KEY=... node scripts/predeploy-schema-guard.mjs
 *
 * Point SUPABASE_URL/SUPABASE_KEY at the SAME environment you are about to
 * deploy to (e.g. live) so "code vs target DB" is what's verified.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'

// ── target DB creds (default to .env.local) ──
function loadEnv() {
  const out = {}
  if (existsSync('.env.local')) {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m) out[m[1]] = m[2]
    }
  }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || out.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY || out.VITE_SUPABASE_ANON_KEY
  return { url, key }
}

// ── collect source files ──
function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (['.ts', '.tsx'].includes(extname(e.name))) acc.push(p)
  }
  return acc
}

// ── extract (table, selectCols) pairs ──
// Tracks the most recent `.from('x')` and pairs it with the next `.select('...')`
// within a few lines (the common chained-builder pattern).
function extractQueries(files) {
  const queries = []
  const fromRe = /\.from\(\s*['"]([a-z0-9_]+)['"]\s*\)/i
  const selRe = /\.select\(\s*['"]([^'"]+)['"]/
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n')
    let pending = null
    for (let i = 0; i < lines.length; i++) {
      const fm = lines[i].match(fromRe)
      if (fm) pending = { table: fm[1], line: i, file: f }
      const sm = lines[i].match(selRe)
      if (sm && pending && i - pending.line <= 6) {
        queries.push({ table: pending.table, select: sm[1].replace(/\s+/g, ' ').trim(), file: f, line: pending.line + 1 })
        pending = null
      }
    }
  }
  return queries
}

// Skip selects with embedded relations/aggregates we can't cheaply validate here.
const isSimpleSelect = (s) => !/[()]/.test(s)

async function main() {
  const { url, key } = loadEnv()
  if (!url || !key) {
    console.error('schema-guard: missing SUPABASE_URL / SUPABASE_KEY (or VITE_* in .env.local)')
    process.exit(2)
  }
  const queries = extractQueries(walk('src'))
  // de-dupe by table+select
  const seen = new Set()
  const uniq = queries.filter((q) => { const k = q.table + '|' + q.select; if (seen.has(k)) return false; seen.add(k); return true })

  const failures = []
  for (const q of uniq) {
    if (!isSimpleSelect(q.select)) continue
    const endpoint = `${url}/rest/v1/${q.table}?select=${encodeURIComponent(q.select)}&limit=0`
    let res
    try { res = await fetch(endpoint, { headers: { apikey: key, Authorization: `Bearer ${key}` } }) }
    catch (e) { failures.push({ ...q, error: `network: ${e.message}` }); continue }
    if (!res.ok) {
      let body = ''
      try { body = JSON.stringify(await res.json()) } catch { /* ignore */ }
      // 401/403 = RLS/auth, not a schema problem — don't fail the guard on those.
      if (res.status === 401 || res.status === 403) continue
      failures.push({ ...q, error: `${res.status} ${body}` })
    }
  }

  console.log(`schema-guard: checked ${uniq.length} distinct queries against ${url.replace(/https:\/\/([a-z0-9]{8}).*/, '$1…')}`)
  if (failures.length) {
    console.error(`\n❌ ${failures.length} query(ies) reference schema that does not exist on the target DB:\n`)
    for (const f of failures) {
      console.error(`  ${f.file}:${f.line}  .from('${f.table}').select('${f.select.slice(0, 80)}${f.select.length > 80 ? '…' : ''}')`)
      console.error(`     → ${f.error}\n`)
    }
    console.error('Deploy BLOCKED. Apply the missing migration(s) to the target DB first, then redeploy.')
    process.exit(1)
  }
  console.log('✅ all queries valid against the target DB — safe to deploy.')
}

main()
