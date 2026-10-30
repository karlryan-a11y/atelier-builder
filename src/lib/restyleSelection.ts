/**
 * WHAT GOES ON THE BOARD WHEN A PULLED LOOK IS RESTYLED — and, just as important, what is left
 * off and why she is told about it.
 *
 * Until now Restyle stripped exactly the pieces recorded in `transitioned_item_ids` and put
 * everything else on the canvas. That is one list short of the truth in two ways:
 *
 * 1. A piece can be transitioned WITHOUT being a recorded cause of this look. It happens when
 *    `closet_item_ids` is rewritten by a GoodPix re-sync after the transition (the scraper
 *    rewrites that column on every incremental sync; `transitioned_item_ids` is ours and is
 *    durable — see lib/lookTransitions.ts). Two of Alicia Hidalgo's 235 pulled looks were in
 *    exactly that state on 2026-09-17: the old code would have laid a garment she no longer
 *    owns back onto the board, and saving it would have pulled the look straight back out of
 *    the lookbook.
 * 2. A piece can be DELETED — GoodPix soft-deletes by nulling `user` and keeps sending the row
 *    (the two-deletes work, 2026-09-17), and Atelier has its own `deleted_at`. Seven such
 *    references sit inside Alicia's pulled looks. A deleted piece is not hers either.
 *
 * So the rule is one sentence: a piece goes on the board only if she still owns it. Everything
 * else is named on screen instead of vanishing, because a piece that disappears with no
 * explanation is what sent Paige Berndt looking for a second transitioned garment that the card
 * had not mentioned.
 *
 * What this DOESN'T fix: `closet_item_ids` on a GoodPix look is the board's pool, not the look's
 * composition, so it can list pieces that were never in the picture (Alicia Hidalgo Look 93
 * lists four shoes; the collage has two). That needs the arrangement itself and is not something
 * this file can know. It is why `RestyleSelection` carries the original image: she can see the
 * difference even though we cannot yet compute it.
 */

import type { ClosetItemNode, LookCanvasState } from '@/types/canvas'

export type OmitReason = 'transitioned' | 'deleted' | 'missing'
  /** GoodPix listed it for the look but it is not in the picture (a piece tried and taken out). */
  | 'not_in_picture'

export interface RestylePiece {
  id: string
  name: string
  brand: string | null
  transitionedAt?: string | null
  isDeleted?: boolean | null
  deletedAt?: string | null
}

export interface OmittedPiece {
  id: string
  name: string
  brand: string | null
  reason: OmitReason
}

export interface RestyleSelection {
  /** Piece ids to put on the board, in the look's own order. */
  keep: string[]
  /** Pieces deliberately left off, with the reason she is shown. */
  omitted: OmittedPiece[]
}

export const OMIT_LABEL: Record<OmitReason, string> = {
  transitioned: 'Transitioned out',
  deleted: 'Deleted from her collection',
  missing: 'No longer in her collection',
  not_in_picture: 'Not in the original picture',
}

/**
 * Decide the board from the look's piece list and the pieces as they stand right now.
 *
 * `pieces` is what the database says today, keyed by id — NOT the cause list. The cause list is
 * why the look is down; it is not the authority on what she still owns.
 */
export function selectRestylePieces(
  closetItemIds: string[],
  pieces: Map<string, RestylePiece>,
): RestyleSelection {
  const keep: string[] = []
  const omitted: OmittedPiece[] = []
  const seen = new Set<string>()

  for (const id of closetItemIds) {
    if (seen.has(id)) continue      // a board pool can list the same piece twice
    seen.add(id)

    const piece = pieces.get(id)
    if (!piece) {
      // The row is gone entirely. Counted and named, never silently dropped.
      omitted.push({ id, name: id, brand: null, reason: 'missing' })
      continue
    }
    const reason = omitReason(piece)
    if (reason) {
      omitted.push({ id, name: piece.name, brand: piece.brand, reason })
      continue
    }
    keep.push(id)
  }

  return { keep, omitted }
}

export function omitReason(piece: RestylePiece): OmitReason | null {
  if (piece.transitionedAt) return 'transitioned'
  if (piece.isDeleted || piece.deletedAt) return 'deleted'
  return null
}

/**
 * RESTYLE AN ATELIER LOOK ON ITS OWN SAVED BOARD: only a transitioned piece comes off.
 *
 * Cynthia Dada, 2026-10-26, Janet Foutty Looks 316 and 319: "I need the image to stay on the
 * board." She adds her own picture of the top and sweater together as a piece, hides the separate
 * garments (ADR-0146) and archives the picture so it stays out of Janet's closet. The rule above
 * treats a deleted piece as not hers, so Restyle took her picture off and left only the hidden
 * garments behind.
 *
 * That rule is right for a GoodPix pool, which is not the look's composition. A saved Atelier
 * board IS the composition: every piece on it was put there by her, and Edit opens it with an
 * archived piece in place. So Restyle does the same and leaves her board alone except for what
 * the transition took away (and a piece with no row, which cannot be drawn). Nodes are copied
 * untouched, so a hidden piece stays hidden and her picture keeps its spot and size.
 * scripts/check-restyle-keeps-image.mjs holds it.
 */
export function restyleSavedBoard(
  canvasState: LookCanvasState,
  pieces: Map<string, RestylePiece>,
  sizes?: Map<string, NaturalSize>,
): BuilderRestylePlan {
  return planBuilderRestyle(canvasState, (id) => savedBoardLetGo(id, pieces), sizes)
}

/**
 * Whether a piece on a saved Atelier board comes off, and why: transitioned, or no row at all.
 * An archived piece stays (above). The Transitions card asks the same question.
 */
export function savedBoardLetGo(id: string, pieces: Map<string, RestylePiece>): OmittedPiece | null {
  const p = pieces.get(id)
  if (!p) return { id, name: id, brand: null, reason: 'missing' }
  return p.transitionedAt ? { id, name: p.name, brand: p.brand, reason: 'transitioned' } : null
}

/**
 * Every piece on a saved board, hidden ones included. Restyle reads the pieces by THIS list, not
 * by `closet_item_ids`: a piece on the board that the column does not list (a stale column, or the
 * read cap) would otherwise have no row in the map and be dropped as missing.
 */
export function boardPieceIds(canvasState: LookCanvasState): string[] {
  return [...new Set(canvasState.nodes.flatMap((n) => (n.type === 'closet_item' ? [n.closet_item_id] : [])))]
}

// ── Where a piece sits on a saved Atelier board ──────────────────────────────────────────────

export interface NaturalSize { width: number; height: number }

/** Below this many board pixels of overlap a piece is not really in the picture. */
const MIN_OVERLAP = 4
/** Board pixels a piece is taken to reach past its corner when its photo size is not known. */
const NEAR = 60

/**
 * IN THE PICTURE, OFF THE SIDE, OR CAN'T TELL WITHOUT THE PHOTO'S SIZE.
 *
 * A stylist parks pieces beside the board while she styles, and a board copied from another look
 * keeps that look's parked pieces (Danielle York Look 155 carried Look 154's Chanel Sheer Mesh
 * dress and Palm Angels shirt at x 1845 on a 1080 board). Those nodes are saved with the look,
 * so they are in `closet_item_ids`, and the Transitions card named a dress that is not in the
 * picture. The card and Restyle now ask this instead.
 *
 * Same geometry the canvas draws with (CanvasAdapter.toKonvaConfig + LookCanvas): (x, y) is the
 * photo's top-left corner before rotation, scaleX is negative when flipped, rotation is degrees
 * clockwise about (x, y), and `target_height` sets the scale once the photo's height is known.
 * Without the photo's size the corner alone decides when it can: a corner inside the board is in
 * the picture, and a corner past an edge with the photo running away from it is off. Anything else
 * is 'unknown' and the caller measures the photo (lib/measurePieces.ts).
 *
 * A hidden piece (ADR-0146) is in the look by design, wherever it sits.
 */
export function placeOnBoard(
  node: ClosetItemNode,
  board: { width: number; height: number },
  size?: NaturalSize | null,
): 'in' | 'off' | 'unknown' {
  if (node.hidden) return 'in'
  const W = board.width, H = board.height
  let scale = node.scale ?? 1
  if (size && node.target_height && size.height > 0) {
    scale = Math.min(Math.max(node.target_height / size.height, 0.03), 3.0)
  }
  const sx = node.flipped ? -scale : scale
  const sy = node.scale_y ?? scale
  const r = ((node.rotation ?? 0) * Math.PI) / 180
  const cos = Math.cos(r), sin = Math.sin(r)

  if (size && size.width > 0 && size.height > 0) {
    const xs: number[] = [], ys: number[] = []
    for (const [u, v] of [[0, 0], [size.width, 0], [0, size.height], [size.width, size.height]]) {
      xs.push(node.x + cos * sx * u - sin * sy * v)
      ys.push(node.y + sin * sx * u + cos * sy * v)
    }
    const ox = Math.min(Math.max(...xs), W) - Math.max(Math.min(...xs), 0)
    const oy = Math.min(Math.max(...ys), H) - Math.max(Math.min(...ys), 0)
    return ox >= MIN_OVERLAP && oy >= MIN_OVERLAP ? 'in' : 'off'
  }

  if (node.x >= 0 && node.x <= W && node.y >= 0 && node.y <= H) return 'in'
  // Which way the photo runs from its corner, for the two angles a board really uses (0 and the
  // 180 Konva writes back for a flip). Other angles need the size.
  const turn = Math.abs(sin) < 1e-6 ? Math.sign(cos) : 0
  if (turn !== 0) {
    const dx = Math.sign(sx) * turn, dy = Math.sign(sy) * turn
    if ((dx > 0 && node.x >= W) || (dx < 0 && node.x <= 0) || (dy > 0 && node.y >= H) || (dy < 0 && node.y <= 0)) return 'off'
    // A garment is drawn at least NEAR board pixels each way, so a corner a few pixels past the
    // top or left edge (Danielle's Look 111 bralette at y -1) is in without fetching its photo.
    const x2 = node.x + dx * NEAR, y2 = node.y + dy * NEAR
    if (Math.min(node.x, x2) < W && Math.max(node.x, x2) > 0 && Math.min(node.y, y2) < H && Math.max(node.y, y2) > 0) return 'in'
  }
  return 'unknown'
}

export interface BuilderRestylePlan {
  /** The board Restyle opens: every node of a piece she let go of is gone, wherever it sat. */
  canvas: LookCanvasState
  /** Let go of and IN THE PICTURE: what the Transitions card names and the panel lists. */
  omitted: OmittedPiece[]
  /** Let go of but parked off the side of the board: taken off too, named apart. */
  notInPicture: OmittedPiece[]
  /** Pieces whose place could not be decided without the photo's size. Counted as in. */
  unknown: string[]
}

/**
 * THE ONE ANSWER for a pulled Atelier look: the card and Restyle both read it, so the pieces the
 * card names are exactly the pieces Restyle takes off the picture.
 *
 * `letGo` says whether a piece is gone and why (null = still hers). Every node of such a piece
 * comes off, including parked ones: a parked node left on the board stays in `closet_item_ids`,
 * and the save would leave the look pulled.
 */
export function planBuilderRestyle(
  canvas: LookCanvasState,
  letGo: (closetItemId: string) => OmittedPiece | null,
  sizes?: Map<string, NaturalSize>,
): BuilderRestylePlan {
  const board = canvas.canvas ?? { width: 1080, height: 1080 }
  const where = new Map<string, 'in' | 'off' | 'unknown'>()
  const gone = new Map<string, OmittedPiece>()
  for (const n of canvas.nodes ?? []) {
    if (n.type !== 'closet_item') continue
    const piece = letGo(n.closet_item_id)
    if (!piece) continue
    gone.set(n.closet_item_id, piece)
    const here = placeOnBoard(n, board, sizes?.get(n.closet_item_id))
    const before = where.get(n.closet_item_id)
    // Two nodes of one piece: in the picture if either is.
    if (before === 'in' || here === 'in') where.set(n.closet_item_id, 'in')
    else if (before === 'unknown' || here === 'unknown') where.set(n.closet_item_id, 'unknown')
    else where.set(n.closet_item_id, 'off')
  }
  const omitted: OmittedPiece[] = []
  const notInPicture: OmittedPiece[] = []
  const unknown: string[] = []
  for (const [id, piece] of gone) {
    const w = where.get(id)
    if (w === 'off') notInPicture.push({ ...piece, reason: 'not_in_picture' })
    else omitted.push(piece)
    if (w === 'unknown') unknown.push(id)
  }
  return {
    canvas: {
      ...canvas,
      nodes: canvas.nodes.filter((n) => n.type !== 'closet_item' || !gone.has(n.closet_item_id)),
    },
    omitted,
    notInPicture,
    unknown,
  }
}

/** The sentence on the canvas panel. Here so the build guard checks the shipped wording. */
export function omittedHeadline(omitted: OmittedPiece[]): string {
  if (omitted.length === 0) return 'Nothing in the picture was taken off: she still has every piece in it.'
  const n = omitted.length
  return `${n} ${n === 1 ? 'piece is' : 'pieces are'} not on the board because she no longer has ${n === 1 ? 'it' : 'them'}.`
}
