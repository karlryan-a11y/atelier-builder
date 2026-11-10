/**
 * WHICH PIECES A PULLED LOOK IS MISSING: one answer for the Transitions card AND the look opened
 * from it, so the two can never disagree again.
 *
 * Paige Berndt, 2026-11-10 (and in September): "some items that have been transitioned appear
 * listed below the look, but when I click on the look, there are actually more pieces missing
 * than what was originally indicated." The card read `gp_looks.transitioned_item_ids`, which
 * holds only the pieces of the LATEST transition that pulled the look; a piece transitioned
 * earlier (by someone else, months before) was left off. The opened look worked it out from the
 * pieces themselves (lib/restyleSelection.ts, lib/goodpixBoard.ts). On 2026-11-10, 82 of Alicia
 * Hidalgo's 158 pulled GoodPix looks showed fewer pieces on the card than on the board.
 *
 * So both now ask this file. The rule is the board's rule:
 * - an Atelier look: the pieces on its saved board she no longer has (transitioned, or the row is
 *   gone); a deleted piece stays on her own board (restyleSavedBoard);
 * - a GoodPix look with a stored arrangement: the pieces IN THE PICTURE she no longer has
 *   (transitioned, deleted or gone); pool pieces not in the picture are not counted;
 * - a GoodPix look without one: the look's piece list, same test.
 *
 * scripts/check-look-out-pieces.mjs holds the card and the board to the same list.
 */

import type { LookCanvasState, CanvasNode } from '@/types/canvas'
import { piecesInLayout, type GpLayout } from './goodpixLayout.ts'   // .ts: node scripts import this file
import { selectRestylePieces, restyleSavedBoard, type OmittedPiece, type RestylePiece } from './restyleSelection.ts'

/** A piece as it stands now, with every photo address GoodPix may have drawn it with. */
export type LookPiece = RestylePiece & { urls: string[] }

export interface OutLook {
  source: string | null
  closetItemIds: string[]
  /** gp_looks.gp_layout, for a GoodPix look. */
  layout?: GpLayout | null
  /** gp_looks.canvas_state.nodes, for an Atelier look. */
  boardNodes?: CanvasNode[] | null
}

function hasLayout(layout: GpLayout | null | undefined): layout is GpLayout {
  return !!layout && (layout.objects ?? []).length > 0
}

/**
 * Every piece id the look could be showing, so the caller reads them all before asking. For a
 * GoodPix arrangement that is the look's list, the board's pool and every object's ids (the
 * `productId` is her own piece on most boards, ADR-0132); for an Atelier look, its board.
 */
export function lookCandidateIds(look: OutLook): string[] {
  if (look.source === 'builder' && look.boardNodes) {
    return [...new Set(look.boardNodes.flatMap((n) => (n.type === 'closet_item' ? [n.closet_item_id] : [])))]
  }
  const layout = look.layout
  if (!hasLayout(layout)) return [...new Set(look.closetItemIds)]
  return [...new Set([
    ...look.closetItemIds,
    ...(layout.pool ?? []).map((p) => p.id),
    ...(layout.objects ?? []).flatMap((o) => [o.closetItemId, o.productId]).filter((x): x is string => !!x),
  ])]
}

/** The photo addresses of the pieces read, in candidate order, for matching pictures to pieces. */
export function pieceUrls(candidates: string[], pieces: Map<string, LookPiece>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const id of candidates) {
    const p = pieces.get(id)
    if (p) out.set(id, p.urls)
  }
  return out
}

/** The pieces a GoodPix arrangement actually shows, matched the way the board matches them. */
export function goodPixInPicture(look: OutLook, pieces: Map<string, LookPiece>): string[] | null {
  if (!hasLayout(look.layout)) return null
  return piecesInLayout(look.layout, pieceUrls(lookCandidateIds(look), pieces))
}

/**
 * The pieces the look is missing, in the look's own order: exactly what the opened look lists
 * under "N pieces are not on the board because she no longer has them".
 */
export function piecesOutOfLook(look: OutLook, pieces: Map<string, LookPiece>): OmittedPiece[] {
  if (look.source === 'builder') {
    if (look.boardNodes) {
      return restyleSavedBoard({ nodes: look.boardNodes } as LookCanvasState, pieces).omitted
    }
    // No board saved: nothing opens (Restyle says so), so the card falls back to the list.
    return selectRestylePieces(look.closetItemIds, pieces).omitted.filter((o) => o.reason !== 'deleted')
  }
  const inPicture = goodPixInPicture(look, pieces)
  return selectRestylePieces(inPicture ?? look.closetItemIds, pieces).omitted
}
