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
  category: 'top' | 'bottom' | 'dress' | 'outerwear' | 'shoes' | 'bag' | 'accessory' | 'jewelry' | 'other'
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
      "category": "top" | "bottom" | "dress" | "outerwear" | "shoes" | "bag" | "accessory" | "jewelry" | "other",
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

    const topScore = candidates[0]?.similarity ?? 0
    const secondScore = candidates[1]?.similarity ?? 0

    // Auto-select if top result is clearly best (>0.15 gap over #2, or score >0.65)
    const autoSelect = topScore > 0.65 || (topScore > 0.4 && topScore - secondScore > 0.15)

    results.push({
      extraction: item,
      candidates,
      selected: autoSelect ? candidates[0] : undefined,
      needsDisambiguation: !autoSelect && candidates.length > 1,
    })
  }

  return results
}

// ── Step 3: Layout Templates ────────────────────────────────────────

type LayoutName =
  | 'flat_lay_outerwear'
  | 'dress_centered'
  | 'separates_grid'
  | 'accessories_corner'
  | 'mannequin_stack'

interface LayoutSlot {
  category: ExtractedItem['category'] | 'any'
  x: number
  y: number
  scale: number
}

const CANVAS_W = 1200

// Each layout defines slots by category priority
const LAYOUTS: Record<LayoutName, { slots: LayoutSlot[]; label: string }> = {
  flat_lay_outerwear: {
    label: 'Flat Lay (Outerwear)',
    slots: [
      { category: 'outerwear', x: 600, y: 350, scale: 1.1 },
      { category: 'top', x: 600, y: 650, scale: 0.9 },
      { category: 'bottom', x: 600, y: 950, scale: 0.9 },
      { category: 'shoes', x: 350, y: 1200, scale: 0.7 },
      { category: 'bag', x: 850, y: 1200, scale: 0.7 },
      { category: 'accessory', x: 200, y: 400, scale: 0.5 },
      { category: 'jewelry', x: 1000, y: 400, scale: 0.5 },
    ],
  },
  dress_centered: {
    label: 'Dress Centered',
    slots: [
      { category: 'dress', x: 600, y: 550, scale: 1.2 },
      { category: 'outerwear', x: 250, y: 400, scale: 0.8 },
      { category: 'shoes', x: 600, y: 1150, scale: 0.75 },
      { category: 'bag', x: 900, y: 800, scale: 0.7 },
      { category: 'accessory', x: 250, y: 200, scale: 0.5 },
      { category: 'jewelry', x: 950, y: 200, scale: 0.5 },
    ],
  },
  separates_grid: {
    label: 'Separates Grid',
    slots: [
      { category: 'top', x: 400, y: 350, scale: 0.9 },
      { category: 'top', x: 800, y: 350, scale: 0.9 },
      { category: 'bottom', x: 400, y: 800, scale: 0.9 },
      { category: 'bottom', x: 800, y: 800, scale: 0.9 },
      { category: 'shoes', x: 400, y: 1200, scale: 0.7 },
      { category: 'bag', x: 800, y: 1200, scale: 0.7 },
      { category: 'accessory', x: 200, y: 200, scale: 0.5 },
      { category: 'jewelry', x: 1000, y: 200, scale: 0.5 },
    ],
  },
  accessories_corner: {
    label: 'Accessories Corner',
    slots: [
      { category: 'bag', x: 600, y: 400, scale: 1.0 },
      { category: 'shoes', x: 350, y: 800, scale: 0.85 },
      { category: 'jewelry', x: 850, y: 300, scale: 0.6 },
      { category: 'accessory', x: 850, y: 700, scale: 0.6 },
      { category: 'jewelry', x: 350, y: 300, scale: 0.5 },
      { category: 'any', x: 600, y: 1100, scale: 0.7 },
    ],
  },
  mannequin_stack: {
    label: 'Mannequin Stack',
    slots: [
      { category: 'outerwear', x: 600, y: 250, scale: 1.0 },
      { category: 'top', x: 600, y: 500, scale: 0.95 },
      { category: 'bottom', x: 600, y: 800, scale: 0.95 },
      { category: 'shoes', x: 600, y: 1100, scale: 0.75 },
      { category: 'bag', x: 250, y: 700, scale: 0.65 },
      { category: 'accessory', x: 950, y: 300, scale: 0.5 },
      { category: 'jewelry', x: 950, y: 600, scale: 0.5 },
    ],
  },
}

export function pickLayout(items: ExtractedItem[], hint?: string | null): LayoutName {
  if (hint && hint in LAYOUTS) return hint as LayoutName

  const cats = new Set(items.map((i) => i.category))

  if (cats.has('dress')) return 'dress_centered'
  if (cats.has('outerwear')) return 'flat_lay_outerwear'
  if (!cats.has('top') && !cats.has('bottom') && !cats.has('dress')) return 'accessories_corner'
  if (items.length >= 4 && cats.has('top') && cats.has('bottom')) return 'separates_grid'
  return 'mannequin_stack'
}

// ── Step 4: Compose Canvas Nodes ────────────────────────────────────

export interface ComposedResult {
  nodes: CanvasNode[]
  imageUrls: Record<string, string>
  layoutUsed: LayoutName
}

export function composeNodes(
  resolvedItems: ResolvedItem[],
  layoutName: LayoutName
): ComposedResult {
  const layout = LAYOUTS[layoutName]
  const nodes: CanvasNode[] = []
  const imageUrls: Record<string, string> = {}

  // Match resolved items to layout slots
  const usedSlots = new Set<number>()
  const itemsToPlace = resolvedItems.filter((r) => r.selected)

  for (const item of itemsToPlace) {
    // Find best matching slot by category
    let slotIdx = layout.slots.findIndex(
      (s, i) => !usedSlots.has(i) && (s.category === item.extraction.category || s.category === 'any')
    )

    // Fallback: use first unused slot
    if (slotIdx === -1) {
      slotIdx = layout.slots.findIndex((_, i) => !usedSlots.has(i))
    }

    if (slotIdx === -1) {
      // No slots left — stack at bottom
      const nodeId = `ci_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      nodes.push({
        id: nodeId,
        type: 'closet_item',
        closet_item_id: item.selected!.id,
        x: 300 + Math.random() * 600,
        y: 1200 + Math.random() * 200,
        scale: 0.7,
        rotation: 0,
        flipped: false,
        z_index: nodes.length,
        locked: false,
      } as ClosetItemNode)
      continue
    }

    usedSlots.add(slotIdx)
    const slot = layout.slots[slotIdx]
    const nodeId = `ci_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    nodes.push({
      id: nodeId,
      type: 'closet_item',
      closet_item_id: item.selected!.id,
      x: slot.x,
      y: slot.y,
      scale: slot.scale,
      rotation: 0,
      flipped: false,
      z_index: nodes.length,
      locked: false,
    } as ClosetItemNode)
  }

  // Add brand labels as text nodes
  let labelY = 80
  for (const item of itemsToPlace) {
    if (!item.selected?.brand) continue
    const textId = `txt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    nodes.push({
      id: textId,
      type: 'text',
      content: item.selected.brand.toUpperCase(),
      font_family: 'Neue Haas Grotesk Display Pro',
      font_size: 14,
      fill: '#1A1A1A',
      x: CANVAS_W - 180,
      y: labelY,
      rotation: 0,
      z_index: nodes.length,
    } as TextNode)
    labelY += 24
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
    // Build summary of what we found
    const lines: string[] = ['Here\'s what I found:']
    for (const r of resolvedItems) {
      if (r.selected) {
        lines.push(`✓ **${r.extraction.description}** → ${r.selected.name} (${r.selected.brand || 'no brand'})`)
      } else if (r.candidates.length > 0) {
        lines.push(`? **${r.extraction.description}** — ${r.candidates.length} options, please pick one:`)
        for (let i = 0; i < Math.min(3, r.candidates.length); i++) {
          const c = r.candidates[i]
          lines.push(`  ${i + 1}. ${c.name} (${c.brand || 'no brand'}) — ${(c.similarity * 100).toFixed(0)}% match`)
        }
      } else {
        lines.push(`✗ **${r.extraction.description}** — no matches found`)
      }
    }

    return {
      plan,
      resolvedItems,
      needsDisambiguation: true,
      summary: lines.join('\n'),
    }
  }

  // Step 3: Pick layout and compose
  const layoutName = pickLayout(plan.items, plan.layout)
  const composed = composeNodes(resolvedItems, layoutName)

  // Build summary
  const placed = resolvedItems.filter((r) => r.selected).length
  const summary = `Composed ${placed} item${placed !== 1 ? 's' : ''} using ${LAYOUTS[layoutName].label} layout.`

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
