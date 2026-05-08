import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
const s = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  // Check if any items already have embeddings
  const { data: withEmb } = await s.from('closet_items')
    .select('id')
    .eq('is_deleted', false)
    .not('description_embedding', 'is', null)
    .limit(1)
  console.log('Items with embeddings:', withEmb?.length ? 'some exist' : 'none')

  // Sample items with name/brand populated
  const { data: samples } = await s.from('closet_items')
    .select('id, name, brand, raw')
    .eq('is_deleted', false)
    .not('name', 'is', null)
    .limit(5)

  for (const item of samples ?? []) {
    const r = item.raw ?? {}
    console.log(`\n--- ${item.name} / ${item.brand} ---`)
    console.log('raw.name:', r.name)
    console.log('raw.brand:', r.brand)
    console.log('raw.category:', r.category)
    console.log('raw.department:', r.department)
    console.log('raw.tags:', JSON.stringify(r.tags)?.slice(0, 200))
    console.log('raw.price:', r.price)
  }

  // Count items with actual name values
  const { count: named } = await s.from('closet_items')
    .select('*', { count: 'exact', head: true })
    .eq('is_deleted', false)
    .neq('name', '')
  console.log('\nItems with non-empty name:', named)

  const { count: total } = await s.from('closet_items')
    .select('*', { count: 'exact', head: true })
    .eq('is_deleted', false)
  console.log('Total active:', total)
}
main()
