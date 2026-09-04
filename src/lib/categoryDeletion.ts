import { isResidenceSlug } from './residences.ts'

/**
 * What "delete this category" should actually do — decided in one pure place so the
 * confirm text the stylist reads and the write that follows can never disagree.
 *
 * Three outcomes:
 *
 *  refuse — the category is a RESIDENCE (Aspen / The Hamptons / New York City). On the
 *    handful of multi-home clients these are not filters, they drive the home-page tiles
 *    and decide which pieces appear in her Collection when she picks a house. Deleting one
 *    breaks that silently, so the button says no rather than asking.
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
 * The wording is for a stylist, not for us. She does not know what a "residence picker" or a
 * "junction table" is and should not have to: every sentence here is about her client's
 * lookbook and what happens to it.
 */
export type CategoryDeletionPlan =
  | { action: 'refuse'; message: string }
  | { action: 'delete'; message: string }
  | { action: 'hide'; message: string }

export interface CategoryDeletionInput {
  slug: string
  label: string
  lookCount: number
  capsuleCount: number
  /** The client's first name, so the message reads like a sentence about a person. */
  clientName?: string
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "Margaux's" / "this client's" — never a bare possessive with no name. */
const whose = (clientName?: string) => {
  const first = (clientName ?? '').trim().split(/\s+/)[0]
  return first ? `${first}'s` : "this client's"
}

export function planCategoryDeletion({ slug, label, lookCount, capsuleCount, clientName }: CategoryDeletionInput): CategoryDeletionPlan {
  if (isResidenceSlug(slug)) {
    return {
      action: 'refuse',
      message:
        `You can't delete "${label}" — it's one of ${whose(clientName)} homes.\n\n` +
        `The front page of her lookbook has a tile for each home, and her Collection lets her ` +
        `look at one house at a time. Both are built from this. Deleting it would break them.\n\n` +
        `You can rename it with the pencil. If a home really does need to come off her ` +
        `lookbook, ask Karl.`,
    }
  }

  if (lookCount === 0 && capsuleCount === 0) {
    return {
      action: 'delete',
      message: `Delete "${label}"?\n\nNothing is in it, so it just disappears from her lookbook.\n\nThis can't be undone.`,
    }
  }

  const parts: string[] = []
  if (lookCount) parts.push(plural(lookCount, 'look', 'looks'))
  if (capsuleCount) parts.push(plural(capsuleCount, 'capsule', 'capsules'))
  const total = lookCount + capsuleCount

  return {
    action: 'hide',
    message:
      `Delete "${label}"?\n\n` +
      `It comes off her lookbook straight away.\n\n` +
      `The ${parts.join(' and ')} in it ${total === 1 ? 'stays' : 'stay'} — ` +
      `${total === 1 ? 'it just loses' : 'they just lose'} this tag. Nothing is deleted.\n\n` +
      `Because it isn't empty, it's kept under Hidden at the bottom of the list, so you can ` +
      `put it back if you need to.`,
  }
}
