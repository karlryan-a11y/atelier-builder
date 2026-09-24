import type { LookCanvasState, CanvasNode } from '@/types/canvas'

/**
 * A CAPSULE IS A SET OF LOOKS, AND SHE CAN ADD AS MANY AS SHE WANTS. ADR-0152.
 *
 * Cynthia Dada, 2026-09-24: "When I try to add another look to a capsule, it thinks I want to
 * discard and load a new look." The look list beside the canvas could only ever OPEN a look in
 * place of the board, and there was no other way to put a look on a capsule. So she built Janet
 * Foutty's Denver and Cape Cod capsules by dragging pieces on by hand and saving after each look,
 * and every save made another copy: ten capsules for two.
 *
 * This file is the arithmetic, kept pure so a check can run it without a browser: where on the
 * board the next look goes, how big it is drawn there, and which looks a board already holds.
 *
 * THE BOARD IS A GRID OF CELLS, one look per cell, left to right then down. A cell is portrait
 * (a look is taller than it is wide), four across on a board 1500px or wider and three across
 * below that. A look is drawn at the size that fits its CONTENT (not its board, which is often
 * mostly empty) into the cell. When every cell is taken the board grows a row, so there is no
 * number of looks at which adding one fails. Anything already on the board, placed by hand or
 * not, marks its cell taken, so a new look never lands on top of her work.
 *
 * NO IMPORTS BUT TYPES: scripts/check-capsule-add-looks.mjs runs this file directly under Node.
 */

export interface Size { w: number; h: number }
export interface Box { x: number; y: number; w: number; h: number }

export interface CapsuleGrid {
  cols: number
  rows: number
  cellW: number
  cellH: number
}

/** A look cell is 2:3, portrait, like the look boards themselves. */
const CELL_ASPECT = 1.5
/** Breathing room inside a cell, so neighbouring looks never touch. */
const CELL_FILL = 0.9

export function capsuleGrid(canvas: { width: number; height: number }): CapsuleGrid {
  const cols = canvas.width >= 1500 ? 4 : 3
  const cellW = canvas.width / cols
  const cellH = cellW * CELL_ASPECT
  const rows = Math.max(1, Math.floor(canvas.height / cellH))
  return { cols, rows, cellW, cellH }
}

/**
 * The box a node occupies, as near as can be known without drawing it. `dims` is the natural
 * pixel size of a closet piece's photo when it has been measured; without it a piece is assumed
 * 3:4, the shape of almost every garment photo.
 */
export function nodeBox(node: CanvasNode, dims?: Size | null): Box {
  switch (node.type) {
    case 'closet_item': {
      const sx = Math.abs(node.scale || 1)
      const sy = Math.abs(node.scale_y ?? node.scale ?? 1)
      let w: number, h: number
      if (dims && dims.h > 0) {
        if (node.target_height) { h = node.target_height; w = dims.w * (node.target_height / dims.h) }
        else { w = dims.w * sx; h = dims.h * sy }
      } else {
        h = node.target_height ?? 400 * sy
        w = h * 0.75
      }
      // A flipped piece is drawn leftwards from its anchor (see canvasStore.flipNodes).
      const x = node.flipped ? node.x - w : node.x
      return { x, y: node.y, w, h }
    }
    case 'text': {
      const lines = Math.max(1, (node.content || '').split('\n').length)
      const longest = Math.max(1, ...(node.content || '').split('\n').map((l) => l.length))
      const w = node.width ?? longest * node.font_size * 0.55
      return { x: node.x, y: node.y, w, h: lines * node.font_size * 1.3 }
    }
    case 'picture':
    case 'shape':
      return { x: node.x, y: node.y, w: node.width, h: node.height }
    case 'sticker':
      return { x: node.x, y: node.y, w: 100 * (node.scale || 1), h: 100 * (node.scale || 1) }
  }
}

/** The smallest box around everything visible. Null for an empty set. */
export function contentBox(nodes: CanvasNode[], dimsOf: (n: CanvasNode) => Size | null | undefined): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const n of nodes) {
    if (n.type === 'closet_item' && n.hidden) continue
    const b = nodeBox(n, dimsOf(n))
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h)
  }
  if (!Number.isFinite(x0)) return null
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
}

/**
 * Cells already in use. A node takes the cell its centre falls in; a look that was placed by
 * this file sits wholly inside one cell, so it takes exactly that one.
 */
export function occupiedCells(nodes: CanvasNode[], grid: CapsuleGrid, dimsOf: (n: CanvasNode) => Size | null | undefined): Set<number> {
  const taken = new Set<number>()
  for (const n of nodes) {
    if (n.type === 'closet_item' && n.hidden) continue
    const b = nodeBox(n, dimsOf(n))
    const col = Math.min(grid.cols - 1, Math.max(0, Math.floor((b.x + b.w / 2) / grid.cellW)))
    const row = Math.max(0, Math.floor((b.y + b.h / 2) / grid.cellH))
    taken.add(row * grid.cols + col)
  }
  return taken
}

/** Scale a node about the origin by `s`, then move it by (dx, dy). Every size it carries scales. */
export function scaleNode(node: CanvasNode, s: number, dx: number, dy: number): CanvasNode {
  const moved = { ...node, x: node.x * s + dx, y: node.y * s + dy }
  switch (moved.type) {
    case 'closet_item':
      return {
        ...moved,
        scale: moved.scale * s,
        ...(moved.scale_y != null ? { scale_y: moved.scale_y * s } : {}),
        ...(moved.target_height != null ? { target_height: moved.target_height * s } : {}),
      }
    case 'text':
      return { ...moved, font_size: moved.font_size * s, ...(moved.width != null ? { width: moved.width * s } : {}) }
    case 'picture':
      return { ...moved, width: moved.width * s, height: moved.height * s }
    case 'shape':
      return { ...moved, width: moved.width * s, height: moved.height * s, stroke_width: moved.stroke_width * s }
    case 'sticker':
      return { ...moved, scale: moved.scale * s }
  }
}

export interface LookToAdd {
  /** The look's id, stamped on every node it brings. Null for a board that was never saved. */
  lookId: string | null
  state: LookCanvasState
  /** node id (in `state`) → image URL, carried across under the new node ids. */
  imageUrls: Record<string, string>
  /** node id (in `state`) → natural photo size, when measured. */
  dims: Record<string, Size>
}

export interface AddLooksResult {
  state: LookCanvasState
  imageUrls: Record<string, string>
  /** Looks actually placed, in order. */
  added: string[]
  /** Looks refused, with why: already on the board, or nothing on them to place. */
  skipped: { lookId: string | null; reason: 'already_on_board' | 'empty' }[]
}

/** The looks a board holds, in the order they were added. */
export function lookIdsOnBoard(state: { nodes: CanvasNode[] }): string[] {
  const seen: string[] = []
  for (const n of state.nodes) if (n.from_look_id && !seen.includes(n.from_look_id)) seen.push(n.from_look_id)
  return seen
}

/**
 * Put each look in the next free cell, scaled to fit, with fresh node ids stamped with the look.
 * The board grows downward by whole rows when it runs out of cells. Pure: returns a new state.
 */
export function addLooksToBoard(
  board: LookCanvasState,
  boardImageUrls: Record<string, string>,
  boardDimsOf: (n: CanvasNode) => Size | null | undefined,
  looks: LookToAdd[],
  newId: (i: number) => string,
): AddLooksResult {
  const grid = capsuleGrid(board.canvas)
  const already = new Set(lookIdsOnBoard(board))
  const nodes = [...board.nodes]
  const imageUrls = { ...boardImageUrls }
  const placedDims = new Map<string, Size>()
  const dimsOf = (n: CanvasNode) => placedDims.get(n.id) ?? boardDimsOf(n)
  const taken = occupiedCells(nodes, grid, dimsOf)
  const added: string[] = []
  const skipped: AddLooksResult['skipped'] = []
  let z = nodes.reduce((m, n) => Math.max(m, n.z_index), -1) + 1
  let seq = 0
  let rows = grid.rows

  for (const look of looks) {
    if (look.lookId && already.has(look.lookId)) { skipped.push({ lookId: look.lookId, reason: 'already_on_board' }); continue }
    const lookDims = (n: CanvasNode) => look.dims[n.id]
    const box = contentBox(look.state.nodes, lookDims)
    if (!box) { skipped.push({ lookId: look.lookId, reason: 'empty' }); continue }

    let cell = 0
    while (taken.has(cell)) cell++
    taken.add(cell)
    const col = cell % grid.cols
    const row = Math.floor(cell / grid.cols)
    rows = Math.max(rows, row + 1)

    const s = Math.min((grid.cellW * CELL_FILL) / box.w, (grid.cellH * CELL_FILL) / box.h)
    // Centre the look's content in its cell.
    const dx = col * grid.cellW + (grid.cellW - box.w * s) / 2 - box.x * s
    const dy = row * grid.cellH + (grid.cellH - box.h * s) / 2 - box.y * s

    const ordered = [...look.state.nodes].sort((a, b) => a.z_index - b.z_index)
    for (const n of ordered) {
      const id = newId(seq++)
      const placed = { ...scaleNode(n, s, dx, dy), id, z_index: z++, ...(look.lookId ? { from_look_id: look.lookId } : {}) } as CanvasNode
      nodes.push(placed)
      if (look.imageUrls[n.id]) imageUrls[id] = look.imageUrls[n.id]
      if (look.dims[n.id]) placedDims.set(id, look.dims[n.id])
    }
    if (look.lookId) { already.add(look.lookId); added.push(look.lookId) }
  }

  const height = Math.max(board.canvas.height, Math.ceil(rows * grid.cellH))
  return {
    state: { ...board, canvas: { ...board.canvas, height }, nodes },
    imageUrls,
    added,
    skipped,
  }
}

/** A capsule starts on the Landscape board, the one packing capsules are made on. */
export const CAPSULE_BOARD = { width: 1600, height: 1200 } as const
