import pg from 'pg'
import * as fs from 'fs'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const sql = fs.readFileSync('supabase/migrations/004_shopping_workflow.sql', 'utf-8')
const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)

// Project confirmed on aws-1-us-east-1 pooler (transaction mode, port 6543).
const regions = ['us-east-1']

async function tryRegion(region: string): Promise<boolean> {
  const connStr = `postgresql://postgres.lejwzpwntjaleqgrcakq:${password}@aws-1-${region}.pooler.supabase.com:6543/postgres`
  const client = new pg.Client({ connectionString: connStr, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 })
  try {
    await client.connect()
    console.log(`Connected on ${region}!`)
    await client.query(sql)
    console.log('Migration 004 executed successfully!')
    await client.end()
    return true
  } catch (err: any) {
    const msg = err.message?.slice(0, 120)
    if (!msg?.includes('Tenant')) console.log(`  ${region}: ${msg}`)
    try { await client.end() } catch {}
    return false
  }
}

async function main() {
  for (const region of regions) {
    process.stdout.write(`Trying ${region}... `)
    const ok = await tryRegion(region)
    if (ok) return
    console.log('nope')
  }
  console.log('\nNo pooler region worked.')
}

main()
