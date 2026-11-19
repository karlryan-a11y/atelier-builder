/**
 * A SCREEN CHANGES ONLY WHAT IT CHANGED (Cynthia Dada for Peyton Wheeler, 2026-11-19: "some of them
 * are in the wrong season now but we didn't change them").
 *
 * A piece's `client_edited_fields` holds markers that several screens own: its season, its
 * patterns, "a person entered this Material", the home she picked, the fields the client edited. A
 * screen that wrote the whole list back from the copy it loaded earlier (an Edit Item box opened
 * before the season was set, another stylist's tab) put back what that copy had, and a season set in
 * the meantime was undone. So every builder write says what it changed, from -> to, and only that
 * change is applied to the list the piece has NOW. saveEditedFields.ts does the read and the write.
 *
 * Pure, so the rule can be tested without a browser or a database (scripts/check-season-kept.mjs).
 */

/**
 * `now` with the change from `from` to `to` applied: what the screen took off comes off, what it
 * added goes on, and every marker it did not touch stays as it is now. null when nothing is left.
 */
export function mergeEditedFields(
  now: readonly string[] | null | undefined,
  from: readonly string[] | null | undefined,
  to: readonly string[] | null | undefined,
): string[] | null {
  const before = new Set(from ?? [])
  const after = new Set(to ?? [])
  const out = (now ?? []).filter((f) => !(before.has(f) && !after.has(f)))
  for (const f of after) if (!before.has(f) && !out.includes(f)) out.push(f)
  return out.length ? out : null
}

/** The same list? Order and repeats don't matter. */
export function sameEditedFields(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  const x = new Set(a ?? []), y = new Set(b ?? [])
  return x.size === y.size && [...x].every((f) => y.has(f))
}

/** The list as a Postgres array literal, for "only if it is still this" on the write. */
export function editedFieldsLiteral(fields: readonly string[]): string {
  return '{' + fields.map((f) => '"' + f.replace(/["\\]/g, (c) => '\\' + c) + '"').join(',') + '}'
}
