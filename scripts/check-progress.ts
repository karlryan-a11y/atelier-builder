import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
const s = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  const { count: withEmb } = await s.from('closet_items')
    .select('*', { count: 'exact', head: true })
    .eq('is_deleted', false)
    .not('description_embedding', 'is', null)
  console.log('Items WITH embeddings:', withEmb)

  const { count: without } = await s.from('closet_items')
    .select('*', { count: 'exact', head: true })
    .eq('is_deleted', false)
    .is('description_embedding', null)
  console.log('Items WITHOUT embeddings:', without)

  const { count: total } = await s.from('closet_items')
    .select('*', { count: 'exact', head: true })
    .eq('is_deleted', false)
  console.log('Total active:', total)
}
main()
