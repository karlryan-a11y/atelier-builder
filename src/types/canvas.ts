export interface LookCanvasState {
  version: 1
  canvas: {
    width: number
    height: number
    background: string
  }
  nodes: CanvasNode[]
}

export type CanvasNode =
  | ClosetItemNode
  | TextNode
  | StickerNode
  | ShapeNode

export interface ClosetItemNode {
  id: string
  type: 'closet_item'
  closet_item_id: string
  x: number
  y: number
  scale: number
  rotation: number
  flipped: boolean
  z_index: number
  locked: boolean
  /** When set by compose, the render layer computes scale = target_height / image.naturalHeight.
   *  Cleared on manual transform so user edits stick. */
  target_height?: number
}

export interface TextNode {
  id: string
  type: 'text'
  content: string
  font_family: string
  font_size: number
  fill: string
  x: number
  y: number
  rotation: number
  z_index: number
}

export interface StickerNode {
  id: string
  type: 'sticker'
  sticker_id: string
  x: number
  y: number
  scale: number
  rotation: number
  z_index: number
}

export interface ShapeNode {
  id: string
  type: 'shape'
  shape: 'rect' | 'circle' | 'line'
  x: number
  y: number
  width: number
  height: number
  fill: string
  stroke: string
  stroke_width: number
  z_index: number
}

export interface CapsuleCanvasState {
  version: 1
  canvas: {
    width: number
    height: number
    background: string
  }
  nodes: (LookRefNode | TextNode | StickerNode | ShapeNode)[]
}

export interface LookRefNode {
  id: string
  type: 'look_ref'
  look_id: string
  x: number
  y: number
  scale: number
  rotation: number
  z_index: number
  locked: boolean
  detached?: boolean
}

export function createDefaultLookCanvas(): LookCanvasState {
  return {
    version: 1,
    canvas: { width: 1200, height: 1500, background: '#ffffff' },
    nodes: [],
  }
}

export function createDefaultCapsuleCanvas(): CapsuleCanvasState {
  return {
    version: 1,
    canvas: { width: 2400, height: 1500, background: '#ffffff' },
    nodes: [],
  }
}
