import postgres from 'postgres'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { config } from 'dotenv'

config({ path: '.env.local' })

const url = process.env.VITE_SUPABASE_URL!
const password = process.env.SUPABASE_DB_PASSWORD!

if (!url || !password) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_DB_PASSWORD in .env.local')
  process.exit(1)
}

const projectRef = url.replace('https://', '').replace('.supabase.co', '')

const file = process.argv[2]
if (!file) {
  console.error('Usage: npx tsx supabase/run-migration.ts <path-to-sql>')
  process.exit(1)
}

const sql = readFileSync(resolve(file), 'utf-8')
console.log(`Running migration: ${file}`)
console.log(`Project ref: ${projectRef}`)

// Try session mode pooler
const db = postgres({
  host: 'aws-0-us-east-1.pooler.supabase.com',
  port: 5432,
  database: 'postgres',
  username: `postgres.${projectRef}`,
  password: password,
  ssl: 'require',
  connect_timeout: 10,
})

try {
  await db.unsafe(sql)
  console.log('✅ Migration applied successfully.')
} catch (err: any) {
  console.error('❌ Migration failed:', err.message)
  if (err.detail) console.error('Detail:', err.detail)
  process.exit(1)
} finally {
  await db.end()
}
