/**
 * What "delete this category" should actually do — decided in one pure place so the
 * confirm text the stylist reads and the write that follows can never disagree.
 *
 * Three outcomes:
 *
 *  refuse — the category is one of this client's HOMES. These are not filters: they drive
 *    her home-page tiles and decide which pieces appear in her Collection when she picks a
 *    house. Deleting one breaks that silently, so the button says no rather than asking.
 *    Since ADR-0111 the refusal is no longer a dead end — a home is a checkbox on the
 *    category, so the message tells her to untick Home and then delete, which she can do
 *    herself. It used to say "ask Karl".
 *
 *  delete — nothing is filed under it, so the row goes for good. Nothing is lost because
 *    there was nothing in it.
 *
 *  hide  — looks or capsules ARE filed under it. A hard delete would cascade those
 *    assignments away, and the record of WHICH looks were in it cannot be reconstructed.
 *    The client's lookbook already skips hidden categories (getLookCategories filters
 *    is_hidden), so hiding removes it from her site exactly as a delete would, and a
 *    mis-click stays recoverable.
 *
 * The wording is for a stylist, not for us. Short lines, her client's name, no jargon and no
 * em dashes. She is reading this between appointments, so it says the one thing she needs and
 * stops. check-category-deletion.mjs enforces all of that.
 */
export type CategoryDeletionPlan =
  | { action: 'refuse'; message: string }
  | { action: 'delete'; message: string }
  | { action: 'hide'; message: string }

export interface CategoryDeletionInput {
  slug: string
  label: string
  /**
   * Whether this category is one of the client's homes. Passed in from her row rather than
   * derived from the slug: "aspen" is a home for the client whose stylist said so and an
   * ordinary category for everyone else, and only the row knows which (ADR-0111).
   */
  isResidence: boolean
  lookCount: number
  capsuleCount: number
  /** The client's first name, so the message reads like a sentence about a person. */
  clientName?: string
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "Margaux" / "this client" — a first name whenever we have one. */
const who = (clientName?: string) => (clientName ?? '').trim().split(/\s+/)[0] || 'this client'
const whose = (clientName?: string) => {
  const first = (clientName ?? '').trim().split(/\s+/)[0]
  return first ? `${first}'s` : "this client's"
}

export function planCategoryDeletion({ label, isResidence, lookCount, capsuleCount, clientName }: CategoryDeletionInput): CategoryDeletionPlan {
  if (isResidence) {
    return {
      action: 'refuse',
      message:
        `${label} is one of ${whose(clientName)} homes.\n\n` +
        `Her lookbook is built around them, so this one cannot be deleted.\n\n` +
        `Rename it if the name is wrong. To remove the home, untick Home first, then delete.`,
    }
  }

  if (lookCount === 0 && capsuleCount === 0) {
    return {
      action: 'delete',
      message: `Delete ${label}?\n\nIt is empty. This cannot be undone.`,
    }
  }

  const parts: string[] = []
  if (lookCount) parts.push(plural(lookCount, 'look', 'looks'))
  if (capsuleCount) parts.push(plural(capsuleCount, 'capsule', 'capsules'))
  const total = lookCount + capsuleCount

  return {
    action: 'hide',
    message:
      `Delete ${label}?\n\n` +
      `It comes off ${who(clientName)}'s lookbook now. ` +
      `${parts.join(' and ')} ${total === 1 ? 'stays' : 'stay'}, ` +
      `${total === 1 ? 'it just loses' : 'they just lose'} the tag.\n\n` +
      `You will find it under Hidden if you want it back.`,
  }
}
