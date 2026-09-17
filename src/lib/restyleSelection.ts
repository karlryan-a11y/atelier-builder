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

export type OmitReason = 'transitioned' | 'deleted' | 'missing'

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

/** The sentence on the canvas panel. Here so the build guard checks the shipped wording. */
export function omittedHeadline(omitted: OmittedPiece[]): string {
  if (omitted.length === 0) return 'Nothing was left off — every piece in this look is still hers.'
  const n = omitted.length
  return `${n} ${n === 1 ? 'piece is' : 'pieces are'} not on the board because she no longer has ${n === 1 ? 'it' : 'them'}.`
}
