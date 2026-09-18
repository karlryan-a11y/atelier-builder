/**
 * Style Button — takes items currently on the canvas and re-arranges them
 * using the same WSG layout engine as compose.
 *
 * Flow:
 * 1. Read closet_item nodes from canvas
 * 2. Look up each item's name/brand from Supabase
 * 3. Detect category from name (using categorize.ts)
 * 4. Run placeItems() + add brand labels
 * 5. Replace canvas state with the styled layout
 */

import { supabase } from './supabase'
import { detectCategory, type Category } from './categorize'
import { composeNodes, pickLayout, type ResolvedItem, type ExtractedItem } from './compose'
import type { ClosetItemNode, CanvasNode, TextNode } from '@/types/canvas'
import {
  pieceType, mixKey, typesKey, rankTemplates, arrangeFromTemplate,
  type LookTemplate, type BoardPiece,
} from './styleFromTemplates'

// detectCategory() returns the grouped CLOSET vocabulary (categorize.ts: 'dresses', 'tops', …);
// the compose engine uses its own extraction vocabulary ('dress', 'top', …). Bridge the two so the
// Style button keeps feeding compose valid categories.
const COMPOSE_CATEGORY: Record<Category, ExtractedItem['category']> = {
  dresses: 'dress', tops: 'top', skirts: 'bottom', pants: 'bottom', jeans: 'bottom',
  shorts: 'bottom', outerwear: 'outerwear', swim: 'other', activewear: 'top',
  shoes: 'shoes', bags: 'bag', jewelry: 'jewelry', belts: 'belt', scarves: 'scarf',
  hats: 'hat', sunglasses: 'accessory', other: 'other',
}

export interface StyleResult {
  nodes: CanvasNode[]
  imageUrls: Record<string, string>
  itemCount: number
  layoutUsed: string
}

/**
 * Takes the current canvas items and returns a fully-styled layout.
 * The caller replaces the canvas state with the returned nodes.
 */
export async function styleCanvas(
  currentNodes: CanvasNode[],
  currentImageUrls: Record<string, string>,
  board?: { width: number; height: number }
): Promise<StyleResult> {
  // Step 1: Get all closet_item nodes
  const closetNodes = currentNodes.filter(
    (n): n is ClosetItemNode => n.type === 'closet_item'
  )

  if (closetNodes.length === 0) {
    throw new Error('No items on canvas to style')
  }

  // Step 2: Look up item details from Supabase
  const itemIds = closetNodes.map((n) => n.closet_item_id)
  const { data: items, error } = await supabase
    .from('closet_items')
    .select('id, name, brand')
    .in('id', itemIds)

  if (error) throw new Error(`Failed to load items: ${error.message}`)

  const itemMap = new Map(
    (items ?? []).map((i: { id: string; name: string; brand: string }) => [i.id, i])
  )

  // Step 3: Detect category for each item and build ResolvedItem list
  const resolvedItems: ResolvedItem[] = closetNodes.map((node) => {
    const item = itemMap.get(node.closet_item_id)
    const name = item?.name ?? ''
    const brand = item?.brand ?? ''
    const category = COMPOSE_CATEGORY[detectCategory(name)]

    const extraction: ExtractedItem = {
      description: name,
      category,
      brand: brand || undefined,
    }

    return {
      extraction,
      candidates: [],
      selected: {
        id: node.closet_item_id,
        name,
        brand,
        similarity: 1,
      },
      needsDisambiguation: false,
    }
  })

  // Step 4: Pick layout and compose
  const extractedItems = resolvedItems.map((r) => r.extraction)
  const layoutName = pickLayout(extractedItems)
  const composed = composeNodes(resolvedItems, layoutName, board)

  // Preserve existing image URLs
  const mergedImageUrls = { ...currentImageUrls, ...composed.imageUrls }

  // Map new node IDs to existing image URLs by closet_item_id
  const oldUrlByItemId = new Map<string, string>()
  for (const node of closetNodes) {
    const url = currentImageUrls[node.id]
    if (url) oldUrlByItemId.set(node.closet_item_id, url)
  }

  // Transfer image URLs from old node IDs to new node IDs
  for (const node of composed.nodes) {
    if (node.type === 'closet_item') {
      const ciNode = node as ClosetItemNode
      const url = oldUrlByItemId.get(ciNode.closet_item_id)
      if (url) mergedImageUrls[node.id] = url
    }
  }

  return {
    nodes: composed.nodes,
    imageUrls: mergedImageUrls,
    itemCount: closetNodes.length,
    layoutUsed: layoutName,
  }
}

// ── ✨ from past looks (ADR-0128) ─────────────────────────────────────────────────────────────


export interface PastLookStyle {
  nodes: CanvasNode[]
  /** The real look the arrangement was copied from; null when there was none and the old rules ran. */
  template: Pick<LookTemplate, 'look_id' | 'look_name' | 'client_id'> | null
  /** Which option this is (0-based) and how many there are. Press again for the next. */
  option: number
  of: number
  sameClient: boolean
  placed: number
  unplaced: number
  labelsAdded: number
}

/**
 * The ✨ button. Arranges the pieces on the board like a real look the team styled with the same
 * mix of pieces — her own looks first — and writes brand labels only for brands saved on the
 * pieces, where that look's stylist put hers. NOTHING IS DELETED: text and pictures stay, and a
 * note moves with the piece it sat beside. `attempt` steps through the ranked options.
 *
 * With no matching look in the library, the old category rules place the pieces instead, still
 * without deleting anything and without writing a label twice.
 */
export async function styleFromPastLooks(opts: {
  nodes: CanvasNode[]
  board: { width: number; height: number }
  clientId: string | null
  attempt: number
  displayOf?: (nodeId: string) => { w: number; h: number } | null
  imageUrls: Record<string, string>
}): Promise<PastLookStyle> {
  const closetNodes = opts.nodes.filter((n): n is ClosetItemNode => n.type === 'closet_item')
  if (closetNodes.length === 0) throw new Error('No pieces on the board to style')

  const ids = [...new Set(closetNodes.map((n) => n.closet_item_id))]
  const { data: rows, error } = await supabase
    .from('gp_closet_items').select('id, name, name_override, brand, category').in('id', ids)
  if (error) throw new Error(`Could not read the pieces: ${error.message}`)
  const byId = new Map((rows ?? []).map((r: any) => [r.id, r]))
  const pieces: BoardPiece[] = closetNodes.map((n) => {
    const r: any = byId.get(n.closet_item_id)
    const brand = r?.brand && r.brand !== 'None' && String(r.brand).trim() ? String(r.brand).trim() : null
    return { nodeId: n.id, pieceId: n.closet_item_id, type: pieceType(r?.name_override?.trim() || r?.name, r?.category), brand }
  })
  const types = pieces.map((p) => p.type)

  const cols = 'look_id, look_name, client_id, board_id, mix_key, types_key, board_w, board_h, slots, labels'
  let { data: cands } = await supabase.from('look_templates').select(cols).eq('mix_key', mixKey(types)).limit(500)
  if (!cands?.length) {
    ;({ data: cands } = await supabase.from('look_templates').select(cols).eq('types_key', typesKey(types)).limit(500))
  }
  const ranked = rankTemplates(types, (cands ?? []) as LookTemplate[], { clientId: opts.clientId, board: opts.board })

  if (ranked.length) {
    const i = opts.attempt % ranked.length
    const tpl = ranked[i]
    const r = arrangeFromTemplate(opts.board, opts.nodes, pieces, tpl, opts.displayOf)
    return {
      nodes: r.nodes,
      template: { look_id: tpl.look_id, look_name: tpl.look_name, client_id: tpl.client_id },
      option: i, of: ranked.length, sameClient: !!opts.clientId && tpl.client_id === opts.clientId,
      placed: r.placed, unplaced: r.unplaced, labelsAdded: r.labelsAdded,
    }
  }

  // No look in the library has this mix: the old category rules, merged without deleting.
  const old = await styleCanvas(opts.nodes, opts.imageUrls, opts.board)
  const oldCloset = old.nodes.filter((n): n is ClosetItemNode => n.type === 'closet_item')
  const queue = new Map<string, ClosetItemNode[]>()
  for (const n of oldCloset) queue.set(n.closet_item_id, [...(queue.get(n.closet_item_id) ?? []), n])
  const merged = opts.nodes.map((n) => {
    if (n.type !== 'closet_item') return n
    const src = queue.get(n.closet_item_id)?.shift()
    return src ? { ...n, x: src.x, y: src.y, target_height: src.target_height, scale: src.scale, scale_y: undefined, rotation: 0, z_index: src.z_index } : n
  })
  const have = new Set(opts.nodes.filter((n) => n.type === 'text').map((n) => (n as TextNode).content.trim().toLowerCase()))
  let labelsAdded = 0
  for (const t of old.nodes) {
    if (t.type !== 'text' || have.has(t.content.trim().toLowerCase())) continue
    merged.push(t); labelsAdded++
  }
  return { nodes: merged, template: null, option: 0, of: 0, sameClient: false, placed: oldCloset.length, unplaced: 0, labelsAdded }
}
