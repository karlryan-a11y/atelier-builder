/**
 * THE MATERIAL A PERSON ENTERED (Paige Berndt, 2026-11-09). Migration 043 copied digitizing's tag read
 * into the material column, so a material equal to the tag read counted as not entered. But posting
 * from Needs Review also leaves the two equal, and what she typed opened as an empty box. So a person
 * entering or confirming one now leaves this marker in client_edited_fields, which GoodPix's sync and
 * every save keep. The twin of atelier-looks src/lib/pieceActions.ts, and of the marker written at
 * posting in wsg-dashboard src/lib/captureV2/closetPatch.ts. It is not a field the client set: the
 * Collection's "set by" badge leaves it out.
 */
export const MATERIAL_CONFIRMED = 'material-confirmed'

type MaterialPiece = { material?: string | null; raw?: { material?: unknown } | null; client_edited_fields?: string[] | null }

/** What the Material box opens with: a material a person entered, never an unconfirmed tag read. */
export function enteredMaterialOf(item: MaterialPiece): string {
  const m = (item.material ?? '').trim()
  if (!m) return ''
  if ((item.client_edited_fields ?? []).includes(MATERIAL_CONFIRMED)) return m
  return m !== String(item.raw?.material ?? '').trim().slice(0, 300) ? m : ''
}

/** client_edited_fields with the marker added or taken off, null when nothing is left. */
export function withMaterialConfirmed(fields: string[] | null | undefined, confirmed: boolean): string[] | null {
  const rest = (fields ?? []).filter((f) => f !== MATERIAL_CONFIRMED)
  const next = confirmed ? [...rest, MATERIAL_CONFIRMED] : rest
  return next.length ? next : null
}
