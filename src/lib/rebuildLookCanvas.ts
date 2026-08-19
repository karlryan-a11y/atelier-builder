import type { LookCanvasState, ClosetItemNode } from '@/types/canvas'
import { createDefaultLookCanvas } from '@/types/canvas'

/**
 * Synthesize a canvas for a look that has no saved canvas_state — i.e. a GoodPix-scraped
 * look, which is one flat composed image + closet_item_ids. GoodPix never exported per-item
 * layout (look_items is empty for scraped looks), so the original collage cannot be
 * reconstructed; instead the look's pieces are laid out in a centered grid for the stylist
 * to rearrange. Uses target_height so the render layer scales each garment as its image
 * loads (same idiom as drag-drop in App.tsx and AI compose).
 */
export function buildCanvasFromClosetItems(closetItemIds: string[]): LookCanvasState {
  const canvas = createDefaultLookCanvas()
  const n = closetItemIds.length
  if (n === 0) return canvas

  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const cellW = canvas.canvas.width / cols
  const cellH = canvas.canvas.height / rows
  const targetH = Math.min(340, Math.round(cellH * 0.82))
  // Garments render roughly 3:4, so estimate width for horizontal centering in the cell.
  const estW = Math.round(targetH * 0.75)

  canvas.nodes = closetItemIds.map((closetItemId, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    // Center a final partial row instead of leaving it left-aligned.
    const rowCount = row === rows - 1 ? n - (rows - 1) * cols : cols
    const rowOffset = (canvas.canvas.width - rowCount * cellW) / 2
    const node: ClosetItemNode = {
      id: `ci_rebuild_${i}_${closetItemId.slice(0, 8)}`,
      type: 'closet_item',
      closet_item_id: closetItemId,
      x: Math.round(rowOffset + col * cellW + (cellW - estW) / 2),
      y: Math.round(row * cellH + (cellH - targetH) / 2),
      scale: 1,
      target_height: targetH,
      rotation: 0,
      flipped: false,
      z_index: i,
      locked: false,
    }
    return node
  })
  return canvas
}
