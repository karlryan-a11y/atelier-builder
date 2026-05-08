import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const c = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  // tag_categories has id + name. Try insert with just name (id auto-gen UUID)
  const r1 = await c.from('tag_categories').insert({ name: 'probe_test' }).select()
  console.log('tag_categories insert:', r1.error?.message ?? `OK data=${JSON.stringify(r1.data)}`)
  if (r1.data?.[0]) {
    const catId = r1.data[0].id
    console.log('tag_categories columns:', Object.keys(r1.data[0]))

    // Try tags with this category UUID
    const r2 = await c.from('tags').insert({ canonical_name: 'probe', display_name: 'Probe', category_id: catId }).select()
    console.log('tags insert:', r2.error?.message ?? `OK data=${JSON.stringify(r2.data)}`)
    if (r2.data?.[0]) {
      console.log('tags columns:', Object.keys(r2.data[0]))
      // Clean up
      await c.from('tags').delete().eq('id', r2.data[0].id)
    }

    // Try with more columns
    const r3 = await c.from('tags').insert({ canonical_name: 'probe2', display_name: 'Probe2', category_id: catId, aliases: ['a'], legacy_content_tag_ids: ['b'] }).select()
    console.log('tags full insert:', r3.error?.message ?? `OK data=${JSON.stringify(r3.data)}`)
    if (r3.data?.[0]) {
      console.log('tags full columns:', Object.keys(r3.data[0]))
      await c.from('tags').delete().eq('id', r3.data[0].id)
    }

    // Check closet_item_tags
    const r4 = await c.from('closet_item_tags').insert({ closet_item_id: 'probe', tag_id: catId }).select()
    console.log('closet_item_tags insert:', r4.error?.message ?? `OK data=${JSON.stringify(r4.data)}`)
    if (r4.data?.[0]) {
      console.log('closet_item_tags columns:', Object.keys(r4.data[0]))
      await c.from('closet_item_tags').delete().eq('closet_item_id', 'probe')
    }

    // Clean up category
    await c.from('tag_categories').delete().eq('id', catId)
  }
}
main()
