import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import * as dotenv from 'dotenv'
import { writeFileSync } from 'fs'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const anthropic = new Anthropic({
  apiKey: process.env.VITE_ANTHROPIC_API_KEY!,
})

async function main() {
  // Fetch all content_tags
  const { data: contentTags, error } = await supabase
    .from('content_tags')
    .select('id, name, features')

  if (error || !contentTags) {
    console.error('Error fetching content_tags:', error)
    process.exit(1)
  }

  console.log(`Found ${contentTags.length} content_tags:`)
  for (const t of contentTags) {
    console.log(`  ${t.id}: "${t.name}" [${t.features?.join(', ')}]`)
  }

  // Get tag usage counts
  const { data: items } = await supabase
    .from('closet_items')
    .select('content_tag_ids')
    .eq('is_deleted', false)

  const tagCounts = new Map<string, number>()
  for (const item of items ?? []) {
    for (const tagId of item.content_tag_ids ?? []) {
      tagCounts.set(tagId, (tagCounts.get(tagId) ?? 0) + 1)
    }
  }

  // Build tag list for Claude
  const tagList = contentTags.map(t => ({
    id: t.id,
    name: t.name,
    features: t.features,
    item_count: tagCounts.get(t.id) ?? 0,
  }))

  console.log('\nSending to Claude for categorization...')

  const prompt = `Categorize each tag into exactly one category: garment_type, season, occasion, location, workflow_status, or noise.

For each tag return an object with:
- "id": the original GoodPix ID
- "canonical_name": singular, lowercase, hyphenated if multi-word
- "display_name": Title Case, plural for garments
- "category": one of the six categories above
- "aliases": array of original tag name variants that map here (group dupes like "bag"/"bags")

Tags to categorize:
${JSON.stringify(tagList, null, 2)}

Respond with ONLY a JSON array. No markdown, no explanation. Every tag must appear exactly once.`

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16384,
    messages: [
      { role: 'user', content: prompt },
      { role: 'assistant', content: '[' },
    ],
  })

  const text = '[' + (response.content[0].type === 'text' ? response.content[0].text : '')

  let categorized: unknown[]
  try {
    categorized = JSON.parse(text)
  } catch {
    // Try to repair truncated JSON: find last complete object and close the array
    const lastBrace = text.lastIndexOf('}')
    if (lastBrace > 0) {
      const repaired = text.slice(0, lastBrace + 1) + ']'
      try {
        categorized = JSON.parse(repaired)
        console.warn(`⚠ JSON was truncated — repaired. Got ${categorized.length} tags (expected ${contentTags.length}).`)
      } catch (e2) {
        writeFileSync('data/tag-categorization-raw.txt', text)
        console.error('JSON repair failed. Raw response saved to data/tag-categorization-raw.txt')
        process.exit(1)
      }
    } else {
      writeFileSync('data/tag-categorization-raw.txt', text)
      console.error('No valid JSON found. Raw response saved to data/tag-categorization-raw.txt')
      process.exit(1)
    }
  }

  console.log(`\nCategorized ${categorized.length} / ${contentTags.length} tags`)

  console.log('\nCategorized tags:')
  console.log(JSON.stringify(categorized, null, 2))

  // Save for Karl's review
  const output = {
    generated_at: new Date().toISOString(),
    total_tags: contentTags.length,
    total_items: items?.length,
    categorized_tags: categorized,
    original_tags: tagList,
  }

  writeFileSync('data/tag-categorization.json', JSON.stringify(output, null, 2))
  console.log('\nSaved to data/tag-categorization.json for review.')
}

main()
