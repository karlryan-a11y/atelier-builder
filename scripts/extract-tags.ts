import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { readFileSync } from 'fs'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  // Get all unique content_tag_ids across all closet items
  const { data: items, error } = await supabase
    .from('closet_items')
    .select('content_tag_ids')
    .eq('is_deleted', false)

  if (error) {
    console.error('Error fetching:', error)
    process.exit(1)
  }

  const tagCounts = new Map<string, number>()
  for (const item of items ?? []) {
    for (const tagId of item.content_tag_ids ?? []) {
      tagCounts.set(tagId, (tagCounts.get(tagId) ?? 0) + 1)
    }
  }

  console.log(`Total items: ${items?.length}`)
  console.log(`Unique tag IDs: ${tagCounts.size}`)

  // Now fetch the actual tag names - these are in the GoodPix content_tags table
  // or they might just be string IDs. Let's check what they look like.
  const sampleIds = Array.from(tagCounts.keys()).slice(0, 5)
  console.log('\nSample tag IDs:', sampleIds)

  // Try to find a content_tags table
  const { data: tags, error: tagErr } = await supabase
    .from('content_tags')
    .select('*')
    .limit(5)

  if (tagErr) {
    console.log('\nNo content_tags table, checking tags table...')
    const { data: tags2, error: tagErr2 } = await supabase
      .from('tags')
      .select('*')
      .limit(5)

    if (tagErr2) {
      console.log('No tags table either. Tag IDs:', Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]))
    } else {
      console.log('Tags table sample:', tags2)
    }
  } else {
    console.log('\nContent tags sample:', tags)
  }

  // Output all tag IDs with counts, sorted by count desc
  const sorted = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1])
  console.log('\nAll tags by frequency:')
  for (const [id, count] of sorted) {
    console.log(`  ${id}: ${count} items`)
  }
}

main()
