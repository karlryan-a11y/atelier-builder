import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { readFileSync } from 'fs'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface CategorizedTag {
  id: string
  canonical_name: string
  display_name: string
  category: string
  aliases: string[]
}

const CATEGORY_ORDER: Record<string, number> = {
  garment_type: 1,
  season: 2,
  occasion: 3,
  location: 4,
  workflow_status: 5,
  noise: 6,
}

const CATEGORY_DISPLAY: Record<string, string> = {
  garment_type: 'Garment Type',
  season: 'Season',
  occasion: 'Occasion',
  location: 'Location',
  workflow_status: 'Workflow Status',
  noise: 'Noise',
}

async function main() {
  const raw = JSON.parse(readFileSync('data/tag-categorization.json', 'utf-8'))
  const tags: CategorizedTag[] = raw.categorized_tags

  // Deduplicate by canonical_name within each category
  const deduped = new Map<string, CategorizedTag & { legacyIds: string[] }>()

  for (const t of tags) {
    // Merge "summer-spring" into "spring-summer"
    const canonical = t.canonical_name === 'summer-spring' ? 'spring-summer' : t.canonical_name
    const key = `${t.category}::${canonical}`

    if (deduped.has(key)) {
      const existing = deduped.get(key)!
      existing.aliases = [...new Set([...existing.aliases, ...t.aliases])]
      existing.legacyIds.push(t.id)
    } else {
      deduped.set(key, { ...t, canonical_name: canonical, aliases: [...t.aliases], legacyIds: [t.id] })
    }
  }

  const uniqueTags = Array.from(deduped.values())
  console.log(`Deduplicated: ${tags.length} → ${uniqueTags.length} unique tags`)

  // Step 1: Insert categories
  console.log('\n1. Inserting categories...')
  const categoryIdMap = new Map<string, string>()

  for (const [slug, order] of Object.entries(CATEGORY_ORDER)) {
    const { data, error } = await supabase
      .from('tag_categories')
      .upsert(
        { name: CATEGORY_DISPLAY[slug], display_order: order, client_visible: slug !== 'noise' && slug !== 'workflow_status' },
        { onConflict: 'name', ignoreDuplicates: false }
      )
      .select('id, name')
      .single()

    if (error) {
      // Maybe upsert on name doesn't work — try select first
      const { data: existing } = await supabase.from('tag_categories').select('id').eq('name', CATEGORY_DISPLAY[slug]).single()
      if (existing) {
        categoryIdMap.set(slug, existing.id)
        console.log(`  ${slug}: exists → ${existing.id}`)
      } else {
        const { data: inserted, error: e2 } = await supabase
          .from('tag_categories')
          .insert({ name: CATEGORY_DISPLAY[slug], display_order: order, client_visible: slug !== 'noise' && slug !== 'workflow_status' })
          .select('id')
          .single()
        if (e2) { console.error(`  ${slug}: FAILED`, e2.message); continue }
        categoryIdMap.set(slug, inserted!.id)
        console.log(`  ${slug}: inserted → ${inserted!.id}`)
      }
    } else {
      categoryIdMap.set(slug, data.id)
      console.log(`  ${slug}: ${data.id}`)
    }
  }

  // Step 2: Insert tags
  console.log('\n2. Inserting tags...')
  const oldIdToNewTagId = new Map<string, string>()
  let inserted = 0

  for (const t of uniqueTags) {
    const catId = categoryIdMap.get(t.category)
    if (!catId) { console.error(`  No category for ${t.category}`); continue }

    // Check if already exists
    const { data: existing } = await supabase
      .from('tags')
      .select('id')
      .eq('category_id', catId)
      .eq('canonical_name', t.canonical_name)
      .single()

    let tagId: string
    if (existing) {
      tagId = existing.id
    } else {
      const { data, error } = await supabase
        .from('tags')
        .insert({
          category_id: catId,
          canonical_name: t.canonical_name,
          display_name: t.display_name,
          aliases: t.aliases,
          display_order: 0,
        })
        .select('id')
        .single()

      if (error) { console.error(`  ${t.canonical_name}: ${error.message}`); continue }
      tagId = data!.id
      inserted++
    }

    for (const legacyId of t.legacyIds) {
      oldIdToNewTagId.set(legacyId, tagId)
    }
  }

  console.log(`  Inserted ${inserted} new tags, ${uniqueTags.length - inserted} already existed`)
  console.log(`  Legacy ID mapping: ${oldIdToNewTagId.size} old IDs → ${new Set(oldIdToNewTagId.values()).size} new UUIDs`)

  // Step 3: Migrate closet_item_tags
  console.log('\n3. Migrating closet_item_tags...')
  const { data: items } = await supabase
    .from('closet_items')
    .select('id, content_tag_ids')
    .eq('is_deleted', false)

  let rowCount = 0
  let skipped = 0
  let batch: { closet_item_id: string; tag_id: string }[] = []

  for (const item of items ?? []) {
    const seen = new Set<string>()
    for (const oldId of item.content_tag_ids ?? []) {
      const newId = oldIdToNewTagId.get(oldId)
      if (newId && !seen.has(newId)) {
        seen.add(newId)
        batch.push({ closet_item_id: item.id, tag_id: newId })
        rowCount++
      } else if (!newId) {
        skipped++
      }
    }

    if (batch.length >= 500) {
      const { error } = await supabase.from('closet_item_tags').upsert(batch, { onConflict: 'closet_item_id,tag_id' })
      if (error) console.error('  Batch error:', error.message)
      batch = []
      process.stdout.write('.')
    }
  }

  if (batch.length > 0) {
    const { error } = await supabase.from('closet_item_tags').upsert(batch, { onConflict: 'closet_item_id,tag_id' })
    if (error) console.error('  Final batch error:', error.message)
  }

  console.log(`\n  Inserted ${rowCount} closet_item_tags rows (${skipped} unmapped old IDs skipped)`)

  // Step 4: Spot check
  console.log('\n4. Spot check:')
  const { data: sample } = await supabase
    .from('closet_item_tags')
    .select('closet_item_id, tags(canonical_name, tag_categories(name))')
    .limit(20)

  const byItem = new Map<string, string[]>()
  for (const row of sample ?? []) {
    const tag = (row as any).tags
    const cat = tag?.tag_categories?.name ?? '?'
    const label = `${cat}:${tag?.canonical_name}`
    if (!byItem.has(row.closet_item_id)) byItem.set(row.closet_item_id, [])
    byItem.get(row.closet_item_id)!.push(label)
  }
  for (const [itemId, tagLabels] of Array.from(byItem.entries()).slice(0, 5)) {
    console.log(`  ${itemId.slice(0, 12)}…: ${tagLabels.join(', ')}`)
  }

  // Summary
  const { data: catCounts } = await supabase.from('tags').select('category_id, tag_categories(name)')
  const counts = new Map<string, number>()
  for (const row of catCounts ?? []) {
    const name = (row as any).tag_categories?.name ?? '?'
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  console.log('\nFinal tag counts by category:')
  for (const [name, count] of counts) {
    console.log(`  ${name}: ${count}`)
  }

  const { count: junctionCount } = await supabase.from('closet_item_tags').select('*', { count: 'exact', head: true })
  console.log(`\nTotal closet_item_tags rows: ${junctionCount}`)
  console.log('\nDone!')
}

main()
