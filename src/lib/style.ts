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
import { detectCategory } from './categorize'
import { composeNodes, pickLayout, type ResolvedItem, type ExtractedItem } from './compose'
import type { ClosetItemNode, CanvasNode } from '@/types/canvas'

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
  currentImageUrls: Record<string, string>
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
    const category = detectCategory(name)

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
  const composed = composeNodes(resolvedItems, layoutName)

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
