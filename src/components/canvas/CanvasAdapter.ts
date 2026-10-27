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
 * Konva hands a flipped picture back as "turned 180 and mirrored the other way" (its decompose
 * always returns a positive scaleX), so that is folded back into the picture's own flip, and
 * (x, y) moves by the change in flip offset so every corner of the image stays where it was.
 */
export function pictureFromKonva(node: PictureNode, n: { x: number; y: number; scaleX: number; scaleY: number; rotation: number }): Partial<PictureNode> {
  const width = Math.max(8, node.width * Math.abs(n.scaleX))
  const height = Math.max(8, node.height * Math.abs(n.scaleY))
  const turned = (n.scaleX < 0) !== !!node.flipped
  const sx = turned ? -n.scaleX : n.scaleX
  const sy = turned ? -n.scaleY : n.scaleY
  let rotation = turned ? n.rotation + 180 : n.rotation
  if (rotation > 180) rotation -= 360
  const flipped = sx < 0
  const flipped_y = sy < 0
  // Offset Konva drew with (the old box) and the one pictureKonvaAttrs will draw with (the new box).
  const dx = (flipped ? -width : 0) - sx * (node.flipped ? node.width : 0)
  const dy = (flipped_y ? -height : 0) - sy * (node.flipped_y ? node.height : 0)
  const r = (rotation * Math.PI) / 180
  return {
    x: n.x + dx * Math.cos(r) - dy * Math.sin(r),
    y: n.y + dx * Math.sin(r) + dy * Math.cos(r),
    width,
    height,
    rotation,
    flipped,
    flipped_y,
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
