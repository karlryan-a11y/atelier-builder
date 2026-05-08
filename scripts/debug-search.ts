import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
const s = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  // Check what embeddings look like
  const { data: withEmb } = await s.from('closet_items')
    .select('id, name, brand, client_id, description_embedding')
    .eq('is_deleted', false)
    .not('description_embedding', 'is', null)
    .limit(3)

  for (const item of withEmb ?? []) {
    const emb = item.description_embedding
    const embStr = typeof emb === 'string' ? emb : JSON.stringify(emb)
    console.log(`${item.name} | ${item.brand} | client: ${item.client_id}`)
    console.log(`  embedding type: ${typeof emb}, length: ${embStr.length}, starts: ${embStr.slice(0, 80)}`)
    if (embStr === '[]') console.log('  *** EMPTY EMBEDDING ***')
  }

  // Check column type
  const { data: cols } = await s.rpc('text_search', { query_text: 'test', match_count: 1 }).select()
  console.log('\ntext_search result:', cols)

  // Check closet_items column info
  const { data: sample } = await s.from('closet_items')
    .select('id, name, brand, client_id')
    .eq('is_deleted', false)
    .not('name', 'is', null)
    .limit(3)
  console.log('\nSample items:', sample)
}
main()
