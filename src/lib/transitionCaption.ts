/**
 * WHAT A PULLED LOOK'S CARD SAYS — the one place the Transitions tab's wording is decided.
 *
 * Julia Driscoll, 2026-09-09: "we transitioned a bunch out for Alicia Hidalgo and all the looks
 * are below but can I find in the look which piece was the transitioned piece? I wasn't present
 * during all of the transitioning! also helpful when the client does it."
 *
 * The platform always knew. A pulled look stores the exact pieces that pulled it in
 * `gp_looks.transitioned_item_ids` (migration 014, ADR-0100), the tab loaded that list, counted
 * it, and printed "Piece transitioned" without ever saying which. On production 2026-09-10:
 * Alicia Hidalgo had 109 pieces out and 237 looks down, 110 of them over exactly ONE piece, and
 * no screen named it. Every one of the 443 cause references on the platform resolves to a piece
 * the tab has already loaded, so naming it costs no query.
 *
 * Lives here, not in the component, so scripts/check-transition-caption.mjs can run the real
 * wording over real production rows. A caption checked only by reading the JSX is a caption
 * nobody checked. (ADR-0108: "copy a stylist reads is checked by the build, not by Karl.")
 */

export interface CaptionPiece {
  id: string
  name: string
  brand: string | null
  source: string | null   // client | stylist
  /** When THIS piece went. Absent: the look's own date stands in (the old single-event card). */
  transitionedAt?: string | null
  /** Set for a piece that is gone for another reason than a transition (deleted). */
  reason?: string | null
}

/** A piece on the card, with its own "who, when" when the pieces did not all go together. */
export type CaptionLine = CaptionPiece & { note: string | null }

/**
 * A look saved with an EMPTY name renders a card with no title at all — 62 of Alicia Hidalgo's
 * 237 pulled looks, which is why two cards in Julia's screenshot were blank. `?? 'Untitled Look'`
 * only catches a MISSING name, never an empty or whitespace one.
 */
export function lookTitle(name: string | null | undefined): string {
  return name?.trim() || 'Untitled Look'
}

const WHO_LABEL: Record<string, string> = { client: 'by the client', stylist: 'by a stylist' }

export function transitionedOn(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export interface CauseCaption {
  /** The line above the pieces, e.g. "3 pieces removed · by a stylist, 4 Sep". */
  headline: string
  /** The pieces themselves, in the look's order, each with its own note when they differ. */
  pieces: CaptionLine[]
  /** Causes whose piece could not be resolved. Counted, never silently dropped. */
  unresolved: number
}

/** "by the client, 9 Nov", or what else happened to a piece that was not transitioned. */
function eventOf(piece: CaptionPiece, lookAt: string | null): string {
  if (piece.reason === 'deleted') return 'deleted from her collection'
  const who = WHO_LABEL[piece.source ?? ''] ?? ''
  const when = transitionedOn(piece.transitionedAt === undefined ? lookAt : piece.transitionedAt)
  return [who, when].filter(Boolean).join(', ')
}

/**
 * Turn the pieces a pulled look is missing into what the stylist reads.
 *
 * `resolve` is the pieces the tab already holds. An id it cannot resolve is REPORTED, not
 * dropped: a cause we cannot name is exactly the case a stylist must not be told is fine, and it
 * is the shape a future data defect would take.
 *
 * WHO AND WHEN, TRUE FOR EVERY PIECE. Paige Berndt, 2026-11-10: a card read "2 pieces removed ·
 * by the client, Nov 9" while the look was missing four, one taken out by a stylist in
 * September. When every piece went the same way on the same day the headline says so once;
 * otherwise each piece carries its own "by whom, when" and the headline only counts.
 */
export function causeCaption(
  causeItemIds: string[],
  resolve: (id: string) => CaptionPiece | undefined,
  transitionedAt: string | null,
): CauseCaption {
  const found = causeItemIds.map(resolve).filter(Boolean) as CaptionPiece[]
  const unresolved = causeItemIds.length - found.length

  // The card names the pieces in the PICTURE (hooks/useTransitions.ts). A look pulled only over a
  // piece parked off the side of its board has none: say so, and what puts it back.
  if (causeItemIds.length === 0) {
    return { headline: 'Nothing in the picture is gone · Restyle and save to bring it back', pieces: [], unresolved: 0 }
  }

  const what = causeItemIds.length > 1 ? `${causeItemIds.length} pieces removed` : 'Piece removed'
  const events = found.map((p) => eventOf(p, transitionedAt))
  const together = new Set(events).size <= 1 && unresolved === 0
  const pieces = found.map((p, i) => ({ ...p, note: together ? null : events[i] || null }))
  const trailer = together ? events[0] ?? '' : ''

  return { headline: trailer ? `${what} · ${trailer}` : what, pieces, unresolved }
}
