/**
 * Analyze GoodPix look images to extract layout patterns.
 *
 * Uses Claude Vision to reverse-engineer item placement, relative sizing,
 * and text/label positioning from styled look screenshots.
 *
 * Output: layout-rules.json with statistical patterns for compose.ts
 */

import Anthropic from '@anthropic-ai/sdk'
import * as fs from 'fs'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const anthropic = new Anthropic({ apiKey: process.env.VITE_ANTHROPIC_API_KEY! })

interface ItemLayout {
  category: string          // dress, top, bottom, outerwear, shoes, bag, jewelry, accessory, belt
  x_pct: number             // x position as % of canvas width (0-100)
  y_pct: number             // y position as % of canvas height (0-100)
  size_pct: number          // size as % of canvas height (0-100) — how tall the item is
  z_order: number           // 0 = back, higher = front
}

interface TextLabel {
  text: string
  x_pct: number
  y_pct: number
  position_relative_to: string  // "above_item", "below_item", "left_of_item", "right_of_item"
  font_style: string            // "script", "sans-serif", "serif"
}

interface LookAnalysis {
  look_id: string
  look_name: string
  item_count: number
  items: ItemLayout[]
  text_labels: TextLabel[]
  overall_composition: string   // "centered", "symmetrical", "asymmetrical"
  hero_item_category: string    // which category is the largest/centermost
  notes: string
}

const VISION_PROMPT = `You are analyzing a styled fashion look image to extract precise layout information.

Examine this image and identify:

1. **Every clothing/accessory item** visible. For each:
   - category: one of [dress, top, bottom, outerwear, shoes, bag, jewelry, accessory, belt, scarf, hat]
   - x_pct: horizontal center position as percentage of image width (0=left edge, 50=center, 100=right edge)
   - y_pct: vertical center position as percentage of image height (0=top, 50=middle, 100=bottom)
   - size_pct: how tall the item is as a percentage of the total image height (a full-length dress might be 50-60%, shoes might be 8-12%)
   - z_order: layer order, 0=back, higher=front. Items overlapping others are higher.

2. **Every text label/brand name** visible. For each:
   - text: what it says
   - x_pct, y_pct: position as percentage
   - position_relative_to: where it is relative to the nearest item ("above_item", "below_item", "left_of_item", "right_of_item")
   - font_style: "script" (handwriting/cursive), "sans-serif", or "serif"

3. **Overall composition**:
   - overall_composition: "centered" (hero item in center), "symmetrical" (balanced left-right), "asymmetrical"
   - hero_item_category: which item type is the largest and most prominent
   - notes: any notable patterns (e.g., "shoes arranged in a row at bottom", "outerwear draped behind dress")

Return ONLY valid JSON matching this exact schema:
{
  "items": [
    {"category": "dress", "x_pct": 50, "y_pct": 40, "size_pct": 55, "z_order": 0}
  ],
  "text_labels": [
    {"text": "Altuzarra", "x_pct": 20, "y_pct": 15, "position_relative_to": "above_item", "font_style": "script"}
  ],
  "overall_composition": "centered",
  "hero_item_category": "dress",
  "notes": "Dress centered, outerwear flanking, shoes in row at bottom"
}

Be precise with percentages. Measure from the image edges, not from other items.`

async function analyzeLookImage(imageUrl: string): Promise<any> {
  // Download image and convert to base64
  const response = await fetch(imageUrl)
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`)
  const buffer = await response.arrayBuffer()
  const base64 = Buffer.from(buffer).toString('base64')
  const mediaType = imageUrl.endsWith('.png') ? 'image/png' : 'image/jpeg'

  const result = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: VISION_PROMPT }
      ]
    }]
  })

  const text = result.content[0].type === 'text' ? result.content[0].text : ''
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, text]
  const jsonStr = jsonMatch[1]?.trim() ?? text.trim()
  return JSON.parse(jsonStr)
}

async function main() {
  const sample = JSON.parse(fs.readFileSync('/tmp/look-sample.json', 'utf-8'))
  const analyses: LookAnalysis[] = []
  let errors = 0

  console.log(`Analyzing ${sample.length} look images...`)

  for (let i = 0; i < sample.length; i++) {
    const look = sample[i]
    const imageUrl = look.main_image_url
    if (!imageUrl) { console.log(`  [${i+1}] Skipped — no image`); continue }

    try {
      const analysis = await analyzeLookImage(imageUrl)
      analyses.push({
        look_id: look.id,
        look_name: look.name,
        item_count: (look.closet_item_ids || []).length,
        ...analysis
      })
      console.log(`  [${i+1}/${sample.length}] ${look.name} — ${analysis.items?.length || 0} items, ${analysis.text_labels?.length || 0} labels`)
    } catch (e: any) {
      console.error(`  [${i+1}] Error: ${e.message}`)
      errors++
    }

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 500))
  }

  console.log(`\nAnalyzed ${analyses.length} looks (${errors} errors)`)

  // Save raw analyses
  fs.writeFileSync('/tmp/look-analyses.json', JSON.stringify(analyses, null, 2))
  console.log('Raw analyses saved to /tmp/look-analyses.json')

  // ── Aggregate into layout rules ──────────────────────────────────

  console.log('\n=== AGGREGATING LAYOUT RULES ===\n')

  // Collect all item placements by category
  const byCat: Record<string, { x: number[], y: number[], size: number[], z: number[] }> = {}
  const textPositions: { relativePos: string, fontStyle: string, dx: number[], dy: number[] }[] = []

  for (const a of analyses) {
    if (!a.items) continue
    for (const item of a.items) {
      if (!byCat[item.category]) byCat[item.category] = { x: [], y: [], size: [], z: [] }
      byCat[item.category].x.push(item.x_pct)
      byCat[item.category].y.push(item.y_pct)
      byCat[item.category].size.push(item.size_pct)
      byCat[item.category].z.push(item.z_order)
    }
    if (a.text_labels) {
      for (const label of a.text_labels) {
        textPositions.push({
          relativePos: label.position_relative_to,
          fontStyle: label.font_style,
          dx: [label.x_pct],
          dy: [label.y_pct]
        })
      }
    }
  }

  const median = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length

  console.log('Category placement statistics (median):')
  console.log('─'.repeat(80))
  console.log('Category'.padEnd(15) + 'Count'.padEnd(8) + 'X%'.padEnd(8) + 'Y%'.padEnd(8) + 'Size%'.padEnd(10) + 'Z-order')
  console.log('─'.repeat(80))

  const rules: Record<string, { x_pct: number, y_pct: number, size_pct: number, z_order: number, count: number }> = {}

  for (const [cat, data] of Object.entries(byCat).sort((a, b) => b[1].size.length - a[1].size.length)) {
    const x = Math.round(median(data.x))
    const y = Math.round(median(data.y))
    const size = Math.round(median(data.size))
    const z = Math.round(median(data.z))
    rules[cat] = { x_pct: x, y_pct: y, size_pct: size, z_order: z, count: data.x.length }
    console.log(`${cat.padEnd(15)}${String(data.x.length).padEnd(8)}${String(x).padEnd(8)}${String(y).padEnd(8)}${String(size).padEnd(10)}${z}`)
  }

  // Composition patterns
  const compositions = analyses.map(a => a.overall_composition).filter(Boolean)
  const compCounts: Record<string, number> = {}
  for (const c of compositions) compCounts[c] = (compCounts[c] || 0) + 1
  console.log('\nComposition types:', compCounts)

  // Hero items
  const heroes = analyses.map(a => a.hero_item_category).filter(Boolean)
  const heroCounts: Record<string, number> = {}
  for (const h of heroes) heroCounts[h] = (heroCounts[h] || 0) + 1
  console.log('Hero item categories:', heroCounts)

  // Text label patterns
  const labelPositions: Record<string, number> = {}
  const labelFonts: Record<string, number> = {}
  for (const t of textPositions) {
    labelPositions[t.relativePos] = (labelPositions[t.relativePos] || 0) + 1
    labelFonts[t.fontStyle] = (labelFonts[t.fontStyle] || 0) + 1
  }
  console.log('Label positions:', labelPositions)
  console.log('Label fonts:', labelFonts)

  // Save layout rules
  const layoutRules = {
    generated_at: new Date().toISOString(),
    sample_size: analyses.length,
    category_placement: rules,
    composition_patterns: compCounts,
    hero_categories: heroCounts,
    text_label_patterns: {
      positions: labelPositions,
      fonts: labelFonts,
      total_labels: textPositions.length
    }
  }

  fs.writeFileSync('/tmp/layout-rules.json', JSON.stringify(layoutRules, null, 2))
  console.log('\nLayout rules saved to /tmp/layout-rules.json')
}

main().catch(console.error)
