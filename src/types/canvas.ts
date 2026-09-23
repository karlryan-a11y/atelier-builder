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
  | PictureNode

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
  /**
   * OFF THE BOARD, STILL IN THE LOOK. ADR-0146.
   *
   * Cynthia Dada, 2026-09-23: "I need to add an image of this scarf tied around the waist but
   * need to keep the item on the board invisible so it's still linked to this look."
   *
   * A hidden piece is not drawn and is not in the saved picture, but it IS still a node, and
   * `closet_item_ids` is built from the nodes (hooks/useLooks.ts). So the client still sees the
   * scarf under "Pieces in this look" and can still shop it, while the board shows the photo of
   * it actually tied. Deleting the piece instead would break that link, which is the thing she
   * was trying to avoid.
   *
   * Only a closet piece can be hidden. A plain picture has no link worth keeping, so hiding one
   * would just be a confusing way to delete it.
   */
  hidden?: boolean
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

/**
 * A plain picture that is NOT one of the client's pieces — today, the shop products and pasted
 * images on a GoodPix look, carried across so a rebuilt look still looks the way it was styled
 * (ADR-0127; Karl, 2026-09-18: "bring plain pictures"). About a third of the pictures on a
 * GoodPix look are these. It never counts as a piece: it is not in `closet_item_ids`, it does not
 * appear under In this look, and a transition can never pull a look because of it.
 *
 * Geometry is the unflipped, unrotated box: (x, y) is its top-left corner, `width`/`height` its
 * size on the board. A flip mirrors inside that box (the render sets offset = size), so flipping
 * never moves it — unlike a closet piece, whose flip is anchored on its right edge.
 */
export interface PictureNode {
  id: string
  type: 'picture'
  src: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  flipped: boolean
  flipped_y?: boolean
  z_index: number
  locked: boolean
  /** The GoodPix shop product it came from, when there was one. */
  product_id?: string | null
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
