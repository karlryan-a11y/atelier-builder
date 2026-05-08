import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const openai = new OpenAI({ apiKey: process.env.VITE_OPENAI_API_KEY! })

async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })
  return response.data[0].embedding
}

async function main() {
  // Find a client with items that have embeddings
  const { data: sample } = await supabase
    .from('closet_items')
    .select('client_id')
    .eq('is_deleted', false)
    .not('description_embedding', 'is', null)
    .limit(1)

  const testClientId = sample?.[0]?.client_id
  console.log(`Test client_id: ${testClientId}`)

  // Count items with embeddings for this client
  const { count } = await supabase
    .from('closet_items')
    .select('*', { count: 'exact', head: true })
    .eq('is_deleted', false)
    .eq('client_id', testClientId)
    .not('description_embedding', 'is', null)
  console.log(`Items with embeddings: ${count}\n`)

  // Test text_search
  console.log('=== TEXT SEARCH: "silk" ===')
  const { data: textResults, error: textErr } = await supabase.rpc('text_search', {
    query_text: 'silk',
    p_client_id: testClientId,
    match_count: 5,
  })
  if (textErr) console.error('  Error:', textErr.message)
  else for (const r of textResults ?? []) console.log(`  ${r.rank.toFixed(3)} | ${r.name} | ${r.brand}`)
  if (!textResults?.length && !textErr) console.log('  (no results)')

  // Test hybrid_search with multiple queries
  const queries = [
    'white silk blouse',
    'black cocktail dress',
    'denim jacket',
    'red shoes',
    'cashmere sweater',
    'Madewell jeans',
    'floral print top',
    'leather handbag',
    'navy blazer',
    'gold earrings',
  ]

  for (const query of queries) {
    console.log(`\n=== HYBRID SEARCH: "${query}" ===`)
    const embedding = await getEmbedding(query)
    const { data, error } = await supabase.rpc('hybrid_search', {
      query_embedding: JSON.stringify(embedding),
      query_text: query,
      p_client_id: testClientId,
      match_threshold: 0.2,
      match_count: 5,
    })
    if (error) {
      console.error('  Error:', error.message)
    } else {
      for (const r of data ?? []) {
        console.log(`  ${r.similarity.toFixed(3)} | ${r.name} | ${r.brand}`)
      }
      if (!data?.length) console.log('  (no results)')
    }
  }
}

main()
