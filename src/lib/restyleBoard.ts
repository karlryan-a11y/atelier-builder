/**
 * WHAT A GOODPIX LOOK'S BOARD WILL HOLD, decided without the database, so the Restyle board and
 * the Transitions card can never disagree about what she no longer has. lib/goodpixBoard.ts does
 * the reads and calls this; the card (hooks/useTransitions.ts) calls it with the same reads; and
 * scripts/check-restyle-not-hers.mjs runs it in node.
 *
 * Relative imports with the extension, so node can load this file as it ships.
 */
import { convertGoodPixLayout, piecesInLayout, piecesNotHers, type GpLayout, type LayoutConversion } from './goodpixLayout.ts'
import { selectRestylePieces, type OmittedPiece, type RestylePiece } from './restyleSelection.ts'

export type BoardPiece = RestylePiece & { urls: string[] }

export interface BoardPlan {
  conversion: LayoutConversion
  /** In the picture and left off because she no longer has it, each with its reason. */
  omitted: OmittedPiece[]
  /** GoodPix listed it for the look, it is not in the picture: not placed, only named. */
  notInPicture: OmittedPiece[]
}

/**
 * `pieces` are the rows read for THIS CLIENT only (ADR-0132). `names` may hold the name a piece
 * had under any client, so a piece that moved away can still be called by its name.
 * `storeProducts` are the ids on the board's own product list.
 */
export function planGoodPixBoard(
  lookId: string,
  layout: GpLayout,
  closetItemIds: string[],
  pieces: Map<string, BoardPiece>,
  storeProducts: Set<string>,
  mirrorUrl: (key: string) => string,
  names: Map<string, { name: string; brand: string | null }> = new Map(),
): BoardPlan {
  const extraUrls = new Map([...pieces].map(([id, p]) => [id, p.urls]))
  const notHers = piecesNotHers(layout, extraUrls, storeProducts, mirrorUrl)
  const gone = new Set(notHers.map((p) => p.id))
  const pictureOf = new Map(notHers.map((p) => [p.id, p.image]))

  const inPicture = piecesInLayout(layout, extraUrls, gone)
  const { keep, omitted } = selectRestylePieces(inPicture, pieces)
  const keepSet = new Set(keep)
  const conversion = convertGoodPixLayout(layout, {
    keep: (id) => keepSet.has(id),
    extraUrls,
    mirrorUrl,
    idPrefix: lookId.slice(-6),
    gone,
  })

  const named = omitted.map((o) => {
    const p = pieces.get(o.id)
    const image = p?.urls[0] ?? pictureOf.get(o.id) ?? null
    if (o.reason !== 'missing') return { ...o, image }
    const known = names.get(o.id)
    return known ? { ...o, name: known.name, brand: known.brand, image } : { ...o, image }
  })

  const shown = new Set(inPicture)
  const notInPicture: OmittedPiece[] = closetItemIds
    .filter((id) => !shown.has(id))
    .map((id) => pieces.get(id))
    .filter((p): p is BoardPiece => !!p)
    .map((p) => ({ id: p.id, name: p.name, brand: p.brand, reason: 'not_in_picture' as const }))

  return { conversion, omitted: named, notInPicture }
}

/** The ids a plan needs read: the look's list, the board's pool, and every id an object carries. */
export function boardCandidateIds(layout: GpLayout | null, closetItemIds: string[]): string[] {
  return [...new Set([
    ...closetItemIds,
    ...(layout?.pool ?? []).map((p) => p.id),
    ...(layout?.objects ?? []).flatMap((o) => [o.closetItemId, o.productId]).filter((x): x is string => !!x),
  ])]
}
