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
  /** Horizontal scale (width). `flipped` flips its sign for rendering. */
  scale: number
  /** Vertical scale (height). Absent = uniform (same as `scale`). Set when a stylist drags a
   *  side/top/bottom handle to make a garment wider or taller/shorter independently. */
  scale_y?: number
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
  /** Optional formatting — all default to off/left for backward compatibility. */
  bold?: boolean
  underline?: boolean
  align?: 'left' | 'center' | 'right'
  /** Fixed text-box width; when set, Konva wraps text to it (enables stacked/centered lines). */
  width?: number
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

/**
 * Board-size presets (match GoodPix). The board IS the canvas + the export area.
 * - Square 1080×1080: Instagram standard — the DEFAULT board for new looks / capsules / shopping boards.
 * - Portrait 1200×1600 (3:4): the classic outfit "look" ratio (one tap in the toolbar).
 * - Landscape 1600×1200: big packing capsules.
 */
export const BOARD_PRESETS = {
  portrait: { width: 1200, height: 1600, label: 'Portrait' },
  square: { width: 1080, height: 1080, label: 'Square' },
  landscape: { width: 1600, height: 1200, label: 'Landscape' },
} as const
export type BoardPreset = keyof typeof BOARD_PRESETS

export function createDefaultLookCanvas(): LookCanvasState {
  return {
    version: 1,
    // Square 1080×1080 is the default board; Portrait/Landscape remain one tap away
    // in the toolbar (BOARD_PRESETS). Existing saved looks keep their stored size.
    canvas: { width: 1080, height: 1080, background: '#ffffff' },
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
