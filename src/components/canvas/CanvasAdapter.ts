import type { CanvasNode, ClosetItemNode, PictureNode } from '@/types/canvas'

export interface KonvaNodeConfig {
  id: string
  type: string
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
  draggable: boolean
  image?: HTMLImageElement
  closetItemId?: string
  zIndex: number
}

export function toKonvaConfig(node: CanvasNode): KonvaNodeConfig {
  switch (node.type) {
    case 'closet_item':
      return {
        id: node.id,
        type: 'closet_item',
        x: node.x,
        y: node.y,
        scaleX: node.flipped ? -node.scale : node.scale,
        scaleY: node.scale_y ?? node.scale,
        rotation: node.rotation,
        draggable: !node.locked,
        closetItemId: node.closet_item_id,
        zIndex: node.z_index,
      }
    case 'text':
      return {
        id: node.id,
        type: 'text',
        x: node.x,
        y: node.y,
        scaleX: 1,
        scaleY: 1,
        rotation: node.rotation,
        draggable: true,
        zIndex: node.z_index,
      }
    case 'shape':
      return {
        id: node.id,
        type: 'shape',
        x: node.x,
        y: node.y,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        draggable: true,
        zIndex: node.z_index,
      }
    case 'sticker':
      return {
        id: node.id,
        type: 'sticker',
        x: node.x,
        y: node.y,
        scaleX: node.scale,
        scaleY: node.scale,
        rotation: node.rotation,
        draggable: true,
        zIndex: node.z_index,
      }
    case 'picture':
      return {
        id: node.id,
        type: 'picture',
        x: node.x,
        y: node.y,
        scaleX: node.flipped ? -1 : 1,
        scaleY: node.flipped_y ? -1 : 1,
        rotation: node.rotation,
        draggable: !node.locked,
        zIndex: node.z_index,
      }
  }
}

/**
 * The Konva attributes of a plain picture — the ONE definition both draw paths use (the on-screen
 * board in LookCanvas.tsx and the headless renderer in render/composite.ts), so a saved look and
 * its baked hero cannot disagree about where a picture sits. A flip mirrors inside the picture's
 * own box: offset by the size, then scale -1, so (x, y) stays the box's top-left corner.
 */
export function pictureKonvaAttrs(node: PictureNode) {
  return {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: node.rotation,
    scaleX: node.flipped ? -1 : 1,
    scaleY: node.flipped_y ? -1 : 1,
    offsetX: node.flipped ? node.width : 0,
    offsetY: node.flipped_y ? node.height : 0,
  }
}

/**
 * Write a Transformer's result back onto a picture: settle any scale into width/height so the
 * saved geometry is the geometry on screen (the same lesson as text, ADR-0093), keep the flip.
 */
export function pictureFromKonva(node: PictureNode, n: { x: number; y: number; scaleX: number; scaleY: number; rotation: number }): Partial<PictureNode> {
  return {
    x: n.x,
    y: n.y,
    width: Math.max(8, node.width * Math.abs(n.scaleX)),
    height: Math.max(8, node.height * Math.abs(n.scaleY)),
    rotation: n.rotation,
  }
}

export function fromKonvaDrag(
  _node: CanvasNode,
  x: number,
  y: number
): Partial<CanvasNode> {
  return { x, y } as Partial<CanvasNode>
}

export function fromKonvaTransform(
  _node: ClosetItemNode,
  attrs: { x: number; y: number; scaleX: number; scaleY: number; rotation: number }
): Partial<ClosetItemNode> {
  const scale = Math.abs(attrs.scaleX)
  const flipped = attrs.scaleX < 0
  // Capture width (scale) AND height (scale_y) independently so side/top/bottom handles stick.
  // Clear target_height so the render layer uses these explicit scales, not the composed height.
  return {
    x: attrs.x,
    y: attrs.y,
    scale,
    scale_y: attrs.scaleY,
    flipped,
    rotation: attrs.rotation,
    target_height: undefined,
  }
}
