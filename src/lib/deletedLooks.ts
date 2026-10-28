/**
 * LOOKS A CLIENT DELETED, FOR HER STYLIST TO REVIEW.
 *
 * Maegan Zarley Watson, 2026-09-24: "clients can delete a look and it goes to a place for us to
 * review" and "give them the option to provide notes of why they're deleting it."
 *
 * On her lookbook (atelier-looks lib/lookRemovals.ts) a delete is her 'archived' mark on the look in
 * client_marks, which takes it off her site, plus her note in her client row,
 * gp_clients.raw.look_removals[lookId]. The look itself is never touched.
 *
 * Review > Deleted looks lists every look she has a mark on that is not cleared yet:
 *   Restore = her mark goes, so the look is back on her site where it was (restored_at is kept).
 *   Clear   = it leaves this list and stays off her site (cleared_at is kept).
 * Nothing is ever removed from look_removals: her note stays on record either way.
 */

export interface LookRemoval {
  note: string | null
  at: string
  by: string | null
  cleared_at?: string
  cleared_by?: string
  restored_at?: string
  restored_by?: string
  earlier?: unknown[]
}

export interface DeletedLook {
  lookId: string
  /** When she deleted it: her note's time, else the mark's. */
  at: string
  note: string | null
  by: string | null
}

export function removalsOf(raw: unknown): Record<string, LookRemoval> {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).look_removals : null
  return r && typeof r === 'object' ? (r as Record<string, LookRemoval>) : {}
}

/**
 * Every look she deleted, newest first, split into the ones waiting for review and the ones a
 * stylist cleared (still off her site, and can still be restored).
 */
export function deletedLooks(
  marks: { target_id: string; created_at: string }[],
  raw: unknown,
): { waiting: DeletedLook[]; cleared: DeletedLook[] } {
  const notes = removalsOf(raw)
  const all = marks
    .map((m) => {
      const n = notes[m.target_id]
      return { lookId: m.target_id, at: n?.at ?? m.created_at, note: n?.note ?? null, by: n?.by ?? null, cleared: !!n?.cleared_at }
    })
    .sort((a, b) => b.at.localeCompare(a.at))
  const strip = ({ cleared: _c, ...d }: DeletedLook & { cleared: boolean }): DeletedLook => d
  return { waiting: all.filter((d) => !d.cleared).map(strip), cleared: all.filter((d) => d.cleared).map(strip) }
}

function stamp(raw: unknown, lookId: string, fields: Partial<LookRemoval>, at: string): Record<string, unknown> {
  const base = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const all = { ...removalsOf(base) }
  all[lookId] = { ...(all[lookId] ?? { note: null, at, by: null }), ...fields }
  return { ...base, look_removals: all }
}

/** Her client row's raw with this delete cleared from review. Her note stays. */
export function withCleared(raw: unknown, lookId: string, by: string | null, at: string) {
  return stamp(raw, lookId, { cleared_at: at, cleared_by: by ?? undefined }, at)
}

/** Her client row's raw with this delete marked restored. Her note stays. */
export function withRestored(raw: unknown, lookId: string, by: string | null, at: string) {
  return stamp(raw, lookId, { restored_at: at, restored_by: by ?? undefined }, at)
}
