import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const openai = new OpenAI({ apiKey: process.env.VITE_OPENAI_API_KEY! })

const BATCH_SIZE = 50
const DELAY_BETWEEN_BATCHES_MS = 2000
const DELAY_BETWEEN_UPDATES_MS = 50
const EMBEDDING_MODEL = 'text-embedding-3-small'

async function buildTagLookup(): Promise<Map<string, string[]>> {
  const { data: junctions } = await supabase
    .from('closet_item_tags')
    .select('closet_item_id, tags(display_name)')

  const map = new Map<string, string[]>()
  for (const row of junctions ?? []) {
    const tagName = (row as any).tags?.display_name
    if (!tagName) continue
    const arr = map.get(row.closet_item_id) ?? []
    arr.push(tagName)
    map.set(row.closet_item_id, arr)
  }
  return map
}

function buildEmbeddingText(
  name: string,
  brand: string,
  tagNames: string[]
): string {
  const parts: string[] = []
  if (name) parts.push(name)
  if (brand) parts.push(brand)
  if (tagNames.length > 0) parts.push(tagNames.join(', '))
  return parts.join(' | ')
}

async function main() {
  console.log('Building tag lookup...')
  const tagLookup = await buildTagLookup()
  console.log(`Tag lookup: ${tagLookup.size} items have tags`)

  // Count items needing embeddings
  const { count } = await supabase
    .from('closet_items')
    .select('*', { count: 'exact', head: true })
    .eq('is_deleted', false)
    .is('description_embedding', null)
  console.log(`Items needing embeddings: ${count}`)

  if (!count || count === 0) {
    console.log('All items already have embeddings!')
    return
  }

  let processed = 0
  let errors = 0

  while (true) {
    // Fetch batch of items without embeddings
    const { data: batch } = await supabase
      .from('closet_items')
      .select('id, name, brand')
      .eq('is_deleted', false)
      .is('description_embedding', null)
      .limit(BATCH_SIZE)

    if (!batch || batch.length === 0) break

    // Build texts for this batch
    const texts: string[] = []
    const ids: string[] = []

    for (const item of batch) {
      const tags = tagLookup.get(item.id) ?? []
      const text = buildEmbeddingText(item.name ?? '', item.brand ?? '', tags)
      if (!text.trim()) continue
      texts.push(text)
      ids.push(item.id)
    }

    if (texts.length === 0) {
      // Skip items with no embeddable text — mark them with empty embedding
      for (const item of batch) {
        await supabase
          .from('closet_items')
          .update({ description_embedding: '[]' })
          .eq('id', item.id)
      }
      processed += batch.length
      continue
    }

    // Call OpenAI embeddings API
    try {
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts,
      })

      // Update each item with its embedding (with small delay to avoid saturating DB)
      for (let i = 0; i < response.data.length; i++) {
        const embedding = response.data[i].embedding
        const { error } = await supabase
          .from('closet_items')
          .update({ description_embedding: JSON.stringify(embedding) })
          .eq('id', ids[i])

        if (error) {
          console.error(`  Error updating ${ids[i]}:`, error.message)
          errors++
        }
        if (DELAY_BETWEEN_UPDATES_MS > 0) {
          await new Promise(r => setTimeout(r, DELAY_BETWEEN_UPDATES_MS))
        }
      }

      processed += batch.length
      const pct = ((processed / count!) * 100).toFixed(1)
      console.log(`  ${processed}/${count} (${pct}%) — ${errors} errors`)

      // Pause between batches to let Supabase breathe
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES_MS))
    } catch (e: any) {
      console.error(`\nOpenAI API error:`, e.message)
      if (e.status === 429) {
        console.log('Rate limited, waiting 30s...')
        await new Promise(r => setTimeout(r, 30000))
        continue
      }
      errors++
      // Mark these items to skip on retry
      for (const item of batch) {
        await supabase
          .from('closet_items')
          .update({ description_embedding: '[]' })
          .eq('id', item.id)
      }
      processed += batch.length
    }
  }

  console.log(`\n\nDone! Processed ${processed} items with ${errors} errors.`)

  // Verify
  const { count: remaining } = await supabase
    .from('closet_items')
    .select('*', { count: 'exact', head: true })
    .eq('is_deleted', false)
    .is('description_embedding', null)
  console.log(`Remaining without embeddings: ${remaining}`)
}

main()
