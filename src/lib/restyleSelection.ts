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

import type { LookCanvasState } from '@/types/canvas'

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
  /** Its picture, so a piece with no name left in Atelier is still recognisable. */
  image?: string | null
}

export interface RestyleSelection {
  /** Piece ids to put on the board, in the look's own order. */
  keep: string[]
  /** Pieces deliberately left off, with the reason she is shown. */
  omitted: OmittedPiece[]
}

export const MISSING_NAME = 'A piece no longer in her collection'

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
      // No row of hers: gone from GoodPix, or someone else's piece. Counted and named, never
      // silently dropped; callers that can find its name elsewhere put it in.
      omitted.push({ id, name: MISSING_NAME, brand: null, reason: 'missing' })
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
): { canvas: LookCanvasState; omitted: OmittedPiece[] } {
  const omitted = selectRestylePieces(boardPieceIds(canvasState), pieces).omitted.filter((o) => o.reason !== 'deleted')
  const gone = new Set(omitted.map((o) => o.id))
  return {
    canvas: { ...canvasState, nodes: canvasState.nodes.filter((n) => n.type !== 'closet_item' || !gone.has(n.closet_item_id)) },
    omitted,
  }
}

/**
 * Every piece on a saved board, hidden ones included. Restyle reads the pieces by THIS list, not
 * by `closet_item_ids`: a piece on the board that the column does not list (a stale column, or the
 * read cap) would otherwise have no row in the map and be dropped as missing.
 */
export function boardPieceIds(canvasState: LookCanvasState): string[] {
  return [...new Set(canvasState.nodes.flatMap((n) => (n.type === 'closet_item' ? [n.closet_item_id] : [])))]
}

/** The sentence on the canvas panel. Here so the build guard checks the shipped wording. */
export function omittedHeadline(omitted: OmittedPiece[]): string {
  if (omitted.length === 0) return 'Nothing was left off: every piece in this look is still hers.'
  const n = omitted.length
  return `${n} ${n === 1 ? 'piece is' : 'pieces are'} not on the board because she no longer has ${n === 1 ? 'it' : 'them'}.`
}
