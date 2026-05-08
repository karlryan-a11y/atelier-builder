import pg from 'pg'
import * as fs from 'fs'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const sql = fs.readFileSync('scripts/create-search-rpc.sql', 'utf-8')
const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD!)

const regions = [
  'us-east-1', 'us-west-1', 'us-east-2', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-central-1',
  'ap-southeast-1', 'ap-northeast-1', 'ap-south-1',
  'sa-east-1'
]

async function tryRegion(region: string): Promise<boolean> {
  const connStr = `postgresql://postgres.lejwzpwntjaleqgrcakq:${password}@aws-0-${region}.pooler.supabase.com:5432/postgres`
  const client = new pg.Client({ connectionString: connStr, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 })
  try {
    await client.connect()
    console.log(`Connected on ${region}!`)
    await client.query(sql)
    console.log('SQL executed successfully!')
    await client.end()
    return true
  } catch (err: any) {
    const msg = err.message?.slice(0, 60)
    if (!msg.includes('Tenant')) console.log(`  ${region}: ${msg}`)
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
  console.log('\nNo pooler region worked. Try running the SQL in Supabase dashboard.')
}

main()
