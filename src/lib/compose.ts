/**
 * Phase 6: AI Composition Pipeline
 *
 * Flow:
 *   1. User types description → Claude extracts structured items
 *   2. For each item, run hybrid search → get candidates
 *   3. If ambiguous, surface disambiguation UI
 *   4. Once items resolved, pick layout template and compose
 *   5. Render nodes to canvas
 */

import Anthropic from '@anthropic-ai/sdk'
import { hybridSearch, textSearch, type SearchResult } from './search'
import type { ClosetItemNode, TextNode, CanvasNode } from '@/types/canvas'

// ── Types ───────────────────────────────────────────────────────────

export interface ExtractedItem {
  description: string
  category: 'top' | 'bottom' | 'dress' | 'outerwear' | 'shoes' | 'bag' | 'accessory' | 'jewelry' | 'belt' | 'scarf' | 'hat' | 'other'
  brand?: string
  color?: string
}

export interface CompositionPlan {
  intent: 'create' | 'modify' | 'swap'
  name?: string
  occasion?: string
  season?: string
  items: ExtractedItem[]
  layout?: string
  swap_description?: string
}

export interface ResolvedItem {
  extraction: ExtractedItem
  candidates: SearchResult[]
  selected?: SearchResult
  needsDisambiguation: boolean
}

export interface ComposeMessage {
  role: 'user' | 'assistant'
  content: string
  resolvedItems?: ResolvedItem[]
  awaitingDisambiguation?: boolean
}

// ── Anthropic Client ────────────────────────────────────────────────

let anthropicClient: Anthropic | null = null

function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
      dangerouslyAllowBrowser: true,
    })
  }
  return anthropicClient
}

// ── Step 1: Entity Extraction ───────────────────────────────────────

const EXTRACTION_PROMPT = `You are a fashion stylist's AI assistant. Parse the user's description into a structured composition plan.

Return ONLY valid JSON matching this schema:
{
  "intent": "create" | "modify" | "swap",
  "name": "optional look name",
  "occasion": "optional occasion",
  "season": "optional season",
  "items": [
    {
      "description": "full text description of the item",
      "category": "top" | "bottom" | "dress" | "outerwear" | "shoes" | "bag" | "accessory" | "jewelry" | "belt" | "scarf" | "hat" | "other",
      "brand": "brand name if mentioned",
      "color": "color if mentioned"
    }
  ],
  "layout": "flat_lay_outerwear" | "dress_centered" | "separates_grid" | "accessories_corner" | "mannequin_stack" | null,
  "swap_description": "only for modify/swap intents — what to swap"
}

Rules:
- Extract EVERY individual clothing/accessory item mentioned
- "outfit" or "look" is not an item — break it into component items
- If user says "swap the booties for Manolos" → intent is "swap", extract the replacement item
- Infer category from context (e.g. "blouse" → top, "pumps" → shoes)
- If layout isn't obvious, set to null (we'll pick one based on items)`

export async function extractEntities(
  userMessage: string,
  conversationHistory: ComposeMessage[] = []
): Promise<CompositionPlan> {
  const messages: Anthropic.MessageParam[] = []

  // Include relevant conversation context
  for (const msg of conversationHistory.slice(-6)) {
    messages.push({
      role: msg.role,
      content: msg.content,
    })
  }

  messages.push({ role: 'user', content: userMessage })

  const response = await getAnthropic().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: EXTRACTION_PROMPT,
    messages,
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''

  // Parse JSON — handle markdown code blocks
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, text]
  const jsonStr = jsonMatch[1]?.trim() ?? text.trim()

  try {
    return JSON.parse(jsonStr)
  } catch {
    // Fallback: treat entire input as a single item description
    return {
      intent: 'create',
      items: [{ description: userMessage, category: 'other' }],
    }
  }
}

// ── Step 2: Search for Candidates ───────────────────────────────────

/**
 * Re-rank candidates by boosting items whose name contains the requested color.
 * A color match adds a bonus to the similarity score so the right variant wins.
 */
function reRankByColor(candidates: SearchResult[], color?: string): SearchResult[] {
  if (!color || candidates.length <= 1) return candidates

  const colorLower = color.toLowerCase()
  // Also check common color synonyms (e.g., "light pink" matches "pink", "blush", "rose")
  const colorTerms = colorLower.split(/\s+/)

  return [...candidates]
    .map((c) => {
      const nameLower = (c.name || '').toLowerCase()
      // Check if any color term appears in the item name
      const colorMatch = colorTerms.some((term) => nameLower.includes(term))
      // Boost color matches by 0.10 — enough to flip ranking among similar items
      return { ...c, similarity: colorMatch ? c.similarity + 0.10 : c.similarity }
    })
    .sort((a, b) => b.similarity - a.similarity)
}

/**
 * Detect when top candidates are from the same brand/product line and scores are
 * clustered — disambiguation should fire even if the top score is high.
 */
function hasSameBrandCluster(candidates: SearchResult[], brand?: string): boolean {
  if (candidates.length < 2 || !brand) return false

  const brandLower = brand.toLowerCase()
  const sameBrand = candidates.filter(
    (c) => (c.brand || '').toLowerCase().includes(brandLower)
  )
  if (sameBrand.length < 2) return false

  // If top 2+ same-brand items are within 0.08 of each other, it's a cluster
  const gap = (sameBrand[0]?.similarity ?? 0) - (sameBrand[1]?.similarity ?? 0)
  return gap < 0.08
}

export async function searchForItems(
  items: ExtractedItem[],
  clientId: string
): Promise<ResolvedItem[]> {
  const results: ResolvedItem[] = []

  for (const item of items) {
    // Build search query from description + brand + color
    const queryParts = [item.description]
    if (item.brand) queryParts.push(item.brand)
    if (item.color) queryParts.push(item.color)
    const query = queryParts.join(' ')

    let candidates: SearchResult[] = []
    try {
      candidates = await hybridSearch(query, clientId, item.brand, undefined, 5)
    } catch {
      // Fallback to text search
      candidates = await textSearch(query, clientId, 5)
    }

    // Part B: Re-rank by color match — boost items whose name contains the requested color
    candidates = reRankByColor(candidates, item.color)

    const topScore = candidates[0]?.similarity ?? 0
    const secondScore = candidates[1]?.similarity ?? 0

    // Part A: Force disambiguation when multiple same-brand items score close together
    const sameBrandCluster = hasSameBrandCluster(candidates, item.brand)

    // Auto-select only if:
    //  - Top result is clearly best (>0.15 gap over #2, or score >0.75 after re-ranking)
    //  - AND we don't have a cluster of same-brand items (e.g., 3 Andiamo variants)
    const autoSelect =
      !sameBrandCluster &&
      (topScore > 0.75 || (topScore > 0.4 && topScore - secondScore > 0.15))

    results.push({
      extraction: item,
      candidates,
      selected: autoSelect ? candidates[0] : undefined,
      needsDisambiguation: !autoSelect && candidates.length > 1,
    })
  }

  return results
}

// ── Step 3: Layout — synchronous, uses target_height (render-time scaling) ───

type LayoutName = 'dress_centered' | 'separates_stack' | 'accessories_focused'

// Look Frame: items are placed within this region.
// Matches the export frame in LookCanvas.tsx.
const FRAME_X = 100
const FRAME_Y = 80
const FRAME_W = 1000
const FRAME_H = 1340

/**
 * Target visual HEIGHT per category in pixels on the 1200×1500 canvas.
 * Matched to Karl's 3 WSG reference look screenshots.
 *
 * The actual scale is computed at RENDER TIME in LookCanvas.tsx:
 *   scale = target_height / image.naturalHeight
 *
 * This guarantees correct proportions regardless of source image size.
 * No CORS, no async, no image pre-loading needed at compose time.
 */
// Target heights scaled to FRAME_H (1340px) not full canvas
const TARGET_HEIGHTS: Record<string, number> = {
  dress:      940,    // ~70% of frame — hero piece, dominant
  bottom:     700,    // ~52% — pants/skirts fill center
  top:        390,    // ~29% — visible above pants, overlaps at waist
  outerwear:  470,    // ~35% — flanks the top
  bag:        310,    // ~23% — accent, right side
  shoes:      160,    // ~12% — small but visible, bottom row
  jewelry:     65,    // ~5%  — tiny accent
  belt:        50,    // ~4%  — tiny at waist
  accessory:  215,    // ~16%
  scarf:      375,
  hat:        215,
  other:      240,
}

/**
 * Estimated width:height aspect ratios per category.
 * Used ONLY for centering the x position at compose time
 * (since we don't know the actual image dimensions yet).
 * Derived from measuring 6 real GoodPix items.
 */
const ASPECT_RATIOS: Record<string, number> = {
  dress:      0.65,   // 884:1360
  bottom:     0.65,   // 884:1360
  top:        0.64,   // 790:1228
  outerwear:  0.77,   // 387:500
  shoes:      0.57,   // 376:662
  bag:        1.29,   // 564:438 (landscape)
  jewelry:    1.60,   // 948:592 (landscape)
  belt:       2.00,   // landscape
  accessory:  0.80,
  scarf:      0.70,
  hat:        1.00,
  other:      0.75,
}

/**
 * Placement rules tuned from Karl's 3 WSG reference looks.
 * x_pct/y_pct are CENTER positions (not top-left).
 * We convert to top-left at compose time using estimated width/height.
 */
const CATEGORY_RULES: Record<string, {
  x_pct: number; y_pct: number; z_order: number
}> = {
  dress:      { x_pct: 50, y_pct: 43, z_order: 1 },   // slightly lower so label fits above
  top:        { x_pct: 50, y_pct: 17, z_order: 2 },
  bottom:     { x_pct: 50, y_pct: 50, z_order: 1 },
  outerwear:  { x_pct: 30, y_pct: 17, z_order: 0 },
  bag:        { x_pct: 78, y_pct: 45, z_order: 1 },   // higher — next to dress mid-section
  shoes:      { x_pct: 50, y_pct: 82, z_order: 1 },   // closer to dress/pants hem
  jewelry:    { x_pct: 80, y_pct: 15, z_order: 2 },   // near neckline area
  belt:       { x_pct: 50, y_pct: 36, z_order: 3 },
  accessory:  { x_pct: 82, y_pct: 25, z_order: 1 },
  other:      { x_pct: 78, y_pct: 65, z_order: 1 },
}

/** Convert center position to top-left for Konva, using estimated item dimensions */
function centerToTopLeft(
  centerXPct: number,
  centerYPct: number,
  category: string
): { x: number; y: number } {
  const targetH = TARGET_HEIGHTS[category] ?? 200
  const aspect = ASPECT_RATIOS[category] ?? 0.75
  const estWidth = targetH * aspect
  const estHeight = targetH

  // Place within the frame, not the full canvas
  return {
    x: Math.round(FRAME_X + (centerXPct / 100) * FRAME_W - estWidth / 2),
    y: Math.round(FRAME_Y + (centerYPct / 100) * FRAME_H - estHeight / 2),
  }
}

interface PlacedItem {
  extraction: ExtractedItem
  selected: SearchResult
  x: number
  y: number
  target_height: number
  z_order: number
}

/** Spread multiple items of the same category into a horizontal row */
function placeItems(items: { extraction: ExtractedItem; selected: SearchResult }[]): PlacedItem[] {
  // Group by category
  const groups: Record<string, typeof items> = {}
  for (const item of items) {
    const cat = item.extraction.category
    groups[cat] = groups[cat] || []
    groups[cat].push(item)
  }

  const result: PlacedItem[] = []

  for (const [_cat, group] of Object.entries(groups)) {
    const cat = group[0].extraction.category
    const rule = CATEGORY_RULES[cat] || CATEGORY_RULES['other']
    const targetH = TARGET_HEIGHTS[cat] ?? 200

    if (group.length === 1) {
      const pos = centerToTopLeft(rule.x_pct, rule.y_pct, cat)
      result.push({
        extraction: group[0].extraction,
        selected: group[0].selected,
        x: pos.x,
        y: pos.y,
        target_height: targetH,
        z_order: rule.z_order,
      })
    } else {
      // Spread evenly in a horizontal row at the category's y position
      const centerY = rule.y_pct
      const totalWidth = FRAME_W * 0.7  // 70% of frame — matches reference shoe spread
      const startX = (FRAME_W - totalWidth) / 2
      const spacing = totalWidth / group.length

      for (let i = 0; i < group.length; i++) {
        const centerX = ((startX + spacing * (i + 0.5)) / FRAME_W) * 100
        const pos = centerToTopLeft(centerX, centerY, cat)
        result.push({
          extraction: group[i].extraction,
          selected: group[i].selected,
          x: pos.x,
          y: pos.y,
          target_height: targetH,
          z_order: rule.z_order,
        })
      }
    }
  }

  return result
}

const LAYOUT_LABELS: Record<LayoutName, string> = {
  dress_centered: 'Dress Centered',
  separates_stack: 'Separates Stack',
  accessories_focused: 'Accessories Focused',
}

export function pickLayout(items: ExtractedItem[], hint?: string | null): LayoutName {
  if (hint && hint in LAYOUT_LABELS) return hint as LayoutName
  const cats = new Set(items.map((i) => i.category))
  if (cats.has('dress')) return 'dress_centered'
  if (!cats.has('top') && !cats.has('bottom') && !cats.has('dress')) return 'accessories_focused'
  return 'separates_stack'
}

// ── Step 4: Compose Canvas Nodes (synchronous, render-time scaling) ──

export interface ComposedResult {
  nodes: CanvasNode[]
  imageUrls: Record<string, string>
  layoutUsed: LayoutName
}

/** Brand labels use Amalfi Coast brush calligraphy (exact match to WSG styled looks). */
const BRAND_LABEL_FONT = 'Amalfi Coast, Great Vibes, cursive'
const BRAND_LABEL_SIZE = 32

export function composeNodes(
  resolvedItems: ResolvedItem[],
  layoutName: LayoutName
): ComposedResult {
  const nodes: CanvasNode[] = []
  const imageUrls: Record<string, string> = {}

  const itemsToPlace = resolvedItems
    .filter((r) => r.selected)
    .map((r) => ({ extraction: r.extraction, selected: r.selected! }))

  // Place items using category rules
  const placed = placeItems(itemsToPlace)

  // Create closet_item nodes with target_height (scale computed at render time)
  for (const item of placed) {
    const nodeId = `ci_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    nodes.push({
      id: nodeId,
      type: 'closet_item',
      closet_item_id: item.selected.id,
      x: item.x,
      y: item.y,
      scale: 0.5,           // placeholder — overridden by target_height at render
      rotation: 0,
      flipped: false,
      z_index: item.z_order,
      locked: false,
      target_height: item.target_height,
    } as ClosetItemNode)
  }

  // Add brand labels in script font, positioned relative to each item
  for (let i = 0; i < placed.length; i++) {
    const item = placed[i]
    if (!item.selected.brand) continue

    const cat = item.extraction.category
    const th = item.target_height
    const aspect = ASPECT_RATIOS[cat] ?? 0.75
    const estW = th * aspect

    // Position label based on category — matched to WSG reference looks
    // Labels are 32px Great Vibes, so they need ~40px vertical clearance
    let labelX: number
    let labelY: number

    if (cat === 'outerwear') {
      // Above-left of the outerwear piece (like "Alexander McQueen" or "Boden")
      labelX = item.x
      labelY = item.y - 45
    } else if (cat === 'top') {
      // Above the top, offset right from outerwear label (like "Éterne" or "Khaite")
      labelX = item.x + estW * 0.2
      labelY = item.y - 45
    } else if (cat === 'bottom') {
      // Left side of the bottom, at ~30% down (like "Marni" or "Adam Lippes")
      labelX = item.x - 40
      labelY = item.y + th * 0.35
    } else if (cat === 'bag') {
      // Below the bag (like "Bottega Veneta")
      labelX = item.x
      labelY = item.y + th + 10
    } else if (cat === 'shoes') {
      // Below each shoe (like "Manolo Blahnik", "Khaite")
      labelX = item.x
      labelY = item.y + th + 5
    } else if (cat === 'jewelry') {
      // Below the jewelry (like "Bottega Veneta" under earrings)
      labelX = item.x - 20
      labelY = item.y + th + 5
    } else if (cat === 'dress') {
      // Above the dress, centered (like "Max Mara" or "Adam Lippes")
      labelX = item.x + estW * 0.3
      labelY = item.y - 50
    } else {
      labelX = item.x
      labelY = item.y + th + 10
    }

    // Clamp to canvas with generous margin so labels don't clip
    labelX = Math.max(FRAME_X + 10, Math.min(FRAME_X + FRAME_W - 160, labelX))
    labelY = Math.max(FRAME_Y + 10, Math.min(FRAME_Y + FRAME_H - 50, labelY))

    const textId = `txt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    nodes.push({
      id: textId,
      type: 'text',
      content: item.selected.brand,
      font_family: BRAND_LABEL_FONT,
      font_size: BRAND_LABEL_SIZE,
      fill: '#1A1A1A',
      x: Math.round(labelX),
      y: Math.round(labelY),
      rotation: 0,
      z_index: 100 + i,
    } as TextNode)
  }

  return { nodes, imageUrls, layoutUsed: layoutName }
}

// ── Full Pipeline ───────────────────────────────────────────────────

export interface PipelineResult {
  plan: CompositionPlan
  resolvedItems: ResolvedItem[]
  composed?: ComposedResult
  needsDisambiguation: boolean
  summary: string
}

export async function runComposePipeline(
  userMessage: string,
  clientId: string,
  conversationHistory: ComposeMessage[] = []
): Promise<PipelineResult> {
  // Step 1: Extract entities
  const plan = await extractEntities(userMessage, conversationHistory)

  // Step 2: Search for each item
  const resolvedItems = await searchForItems(plan.items, clientId)

  // Check if any need disambiguation
  const needsDisambiguation = resolvedItems.some((r) => r.needsDisambiguation)

  if (needsDisambiguation) {
    const lines: string[] = ['Here\'s what I found:']
    for (const r of resolvedItems) {
      if (r.selected) {
        lines.push(`✓ ${r.extraction.description} → ${r.selected.name} (${r.selected.brand || 'no brand'})`)
      } else if (r.candidates.length > 0) {
        lines.push(`? ${r.extraction.description} — ${r.candidates.length} options, please pick one:`)
        for (let i = 0; i < Math.min(3, r.candidates.length); i++) {
          const c = r.candidates[i]
          lines.push(`  ${i + 1}. ${c.name} (${c.brand || 'no brand'}) — ${(c.similarity * 100).toFixed(0)}% match`)
        }
      } else {
        lines.push(`✗ ${r.extraction.description} — no matches found`)
      }
    }

    return {
      plan,
      resolvedItems,
      needsDisambiguation: true,
      summary: lines.join('\n'),
    }
  }

  // Step 3: Pick layout and compose (synchronous — scale computed at render time)
  const layoutName = pickLayout(plan.items, plan.layout)
  const composed = composeNodes(resolvedItems, layoutName)

  const placed = resolvedItems.filter((r) => r.selected).length
  const summary = `Composed ${placed} item${placed !== 1 ? 's' : ''} using ${LAYOUT_LABELS[layoutName]} layout.`

  return {
    plan,
    resolvedItems,
    composed,
    needsDisambiguation: false,
    summary,
  }
}

// ── Disambiguation Resolution ───────────────────────────────────────

export function resolveDisambiguation(
  resolvedItems: ResolvedItem[],
  itemIndex: number,
  candidateIndex: number
): ResolvedItem[] {
  return resolvedItems.map((r, i) => {
    if (i !== itemIndex) return r
    return {
      ...r,
      selected: r.candidates[candidateIndex],
      needsDisambiguation: false,
    }
  })
}

export function allResolved(resolvedItems: ResolvedItem[]): boolean {
  return resolvedItems.every((r) => r.selected || r.candidates.length === 0)
}
