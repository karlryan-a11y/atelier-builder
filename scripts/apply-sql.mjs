#!/usr/bin/env node
/**
 * Apply a .sql file to the live Atelier Postgres.
 *
 *   node scripts/apply-sql.mjs migrations/020_category_is_residence.sql
 *
 * Generalised from scripts/exec-sql.ts, which hardcodes a single filename
 * (scripts/create-search-rpc.sql) and so could only ever run that one file.
 * Every migration in migrations/ needs this, and "paste it into the dashboard"
 * is how a migration gets applied to the wrong project.
 *
 * Needs SUPABASE_DB_PASSWORD in .env.local. Supabase does not publish which
 * pooler region a project is on, so we try each and stop at the first that
 * accepts the tenant -- same approach as exec-sql.ts.
 */
import pg from 'pg'
import fs from 'node:fs'
import dotenv from 'dotenv'

dotenv.config({ path: new URL('../.env.local', import.meta.url).pathname })

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/apply-sql.mjs <path/to/file.sql>')
  process.exit(1)
}
const sql = fs.readFileSync(file, 'utf-8')
const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD ?? '')
if (!password) {
  console.error('SUPABASE_DB_PASSWORD is not set in .env.local')
  process.exit(1)
}

// Supabase moved projects onto `aws-1-<region>` poolers. This list only had `aws-0-`,
// so on 2026-09-04 every region answered "tenant not found" and the script reported
// "no pooler region accepted the connection" — which reads as a dead host and is
// actually a hostname prefix. This project answers on aws-1-us-east-1. Prefixes first,
// so the working one is found in one attempt rather than twelve.
const PREFIXES = ['aws-1', 'aws-0']
const REGIONS = [
  'us-east-1', 'us-west-1', 'us-east-2', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-central-1',
  'ap-southeast-1', 'ap-northeast-1', 'ap-south-1', 'sa-east-1',
].flatMap((r) => PREFIXES.map((p) => `${p}-${r}`))

for (const region of REGIONS) {
  const client = new pg.Client({
    connectionString: `postgresql://postgres.lejwzpwntjaleqgrcakq:${password}@${region}.pooler.supabase.com:5432/postgres`,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  })
  try {
    await client.connect()
    const result = await client.query(sql)
    console.log(`connected on ${region} -- applied ${file}`)
    for (const r of (Array.isArray(result) ? result : [result])) {
      if (r.command) console.log(`  ${r.command} rowCount=${r.rowCount}`)
      if (r.rows?.length) console.log(`  ${JSON.stringify(r.rows)}`)
    }
    await client.end()
    process.exit(0)
  } catch (e) {
    // "Tenant or user not found" just means this is the wrong region; anything
    // else is a real error worth seeing.
    if (!String(e.message).includes('Tenant')) console.log(`  ${region}: ${String(e.message).slice(0, 120)}`)
    try { await client.end() } catch {}
  }
}

console.error('no pooler region accepted the connection')
process.exit(1)
