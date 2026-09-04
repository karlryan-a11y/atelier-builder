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
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function planCategoryDeletion({ slug, label, lookCount, capsuleCount }: CategoryDeletionInput): CategoryDeletionPlan {
  if (isResidenceSlug(slug)) {
    return {
      action: 'refuse',
      message:
        `"${label}" is one of this client's homes, not an ordinary category.\n\n` +
        `Her home tiles and her Collection's residence picker are built from it, so deleting it ` +
        `would break both without warning. Rename it if the name is wrong; to retire a home, ` +
        `say so and it can be done deliberately.`,
    }
  }

  if (lookCount === 0 && capsuleCount === 0) {
    return {
      action: 'delete',
      message: `Delete "${label}"?\n\nNothing is filed under it, so it just disappears from the client's site. This cannot be undone.`,
    }
  }

  const parts: string[] = []
  if (lookCount) parts.push(plural(lookCount, 'look', 'looks'))
  if (capsuleCount) parts.push(plural(capsuleCount, 'capsule', 'capsules'))

  return {
    action: 'hide',
    message:
      `Delete "${label}"?\n\n` +
      `It disappears from the client's site straight away. ${parts.join(' and ')} ` +
      `${lookCount + capsuleCount === 1 ? 'stays' : 'stay'} on her lookbook — ` +
      `${lookCount + capsuleCount === 1 ? 'it just loses' : 'they just lose'} this tag.\n\n` +
      `Because things are filed under it, it is kept in Hidden below where you can restore it.`,
  }
}
