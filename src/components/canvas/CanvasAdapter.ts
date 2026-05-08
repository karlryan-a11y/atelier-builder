import type { CanvasNode, ClosetItemNode } from '@/types/canvas'

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
        scaleY: node.scale,
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
  return {
    x: attrs.x,
    y: attrs.y,
    scale,
    flipped,
    rotation: attrs.rotation,
  }
}
