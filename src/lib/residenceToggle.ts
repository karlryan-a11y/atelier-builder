/**
 * What "make this a home" / "stop this being a home" actually does — decided in one pure
 * place so the sentence the stylist reads and the write that follows can never disagree.
 * Twin of planCategoryDeletion; same house rules for the wording.
 *
 * WHY THIS EXISTS. The Home toggle is one click, it sits between two other one-click controls
 * (the styling note and the rename pencil), and it is used on an iPad. A mis-tap changes what
 * a client sees when she opens her lookbook. Karl asked for a verification step before anyone
 * could do that by accident, and he is right: every other control on that row is recoverable
 * by looking at it, and this one is not — the stylist is on the builder, and the thing that
 * changed is on the client's phone.
 *
 * WHAT IS AND IS NOT AT RISK. Nothing is destroyed either way. `is_residence` is a flag; the
 * category, its label, its looks and every piece filed under it are untouched, and re-ticking
 * puts it back exactly as it was. So the confirm is not asking "are you sure you want to lose
 * something", it is asking "did you mean to change her front page". The messages say so,
 * because a warning that overstates the danger gets clicked through.
 *
 * THE THRESHOLD IS THE THING. Two or more homes is what turns the home-tile front page on
 * (MIN_RESIDENCES). So the toggle that matters is the one that CROSSES that line: 1 -> 2
 * switches her whole front page over, and 2 -> 1 switches it back to the ordinary one. Those
 * two get a message that says exactly that. The others are adding or removing one tile, and
 * are worded that way.
 */
import { MIN_RESIDENCES } from './residences.ts'

export interface ResidenceTogglePlan {
  /** What the write will do. */
  action: 'enable' | 'disable'
  /** The sentence to put in front of the stylist before writing. */
  message: string
  /** True when this toggle switches the client's whole front page over, either way. */
  crossesThreshold: boolean
}

export interface ResidenceToggleInput {
  /** The category's label, as the client sees it. */
  label: string
  /** True when the stylist is turning it ON. */
  turningOn: boolean
  /** How many of her categories are homes RIGHT NOW, before this toggle. */
  currentHomeCount: number
  /** Published looks filed under this category. */
  lookCount: number
  /** The client's name, so the message reads like a sentence about a person. */
  clientName?: string
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "Maegan" / "this client" — a first name whenever we have one. */
const who = (clientName?: string) => (clientName ?? '').trim().split(/\s+/)[0] || 'this client'
const whose = (clientName?: string) => {
  const first = (clientName ?? '').trim().split(/\s+/)[0]
  return first ? `${first}'s` : "this client's"
}

export function planResidenceToggle({
  label,
  turningOn,
  currentHomeCount,
  lookCount,
  clientName,
}: ResidenceToggleInput): ResidenceTogglePlan {
  const after = currentHomeCount + (turningOn ? 1 : -1)

  if (turningOn) {
    // 1 -> 2. This is the one that changes everything: her front page stops being the normal
    // one and becomes a tile per home.
    if (after === MIN_RESIDENCES) {
      return {
        action: 'enable',
        crossesThreshold: true,
        message:
          `Make ${label} one of ${whose(clientName)} homes?\n\n` +
          `That gives her two homes, so her front page changes: she will see a tile for each ` +
          `one instead of her usual home page.\n\n` +
          `A home only gets a tile once looks are filed into it. Untick to undo.`,
      }
    }
    // 0 -> 1. Nothing visible happens yet, and saying so stops her hunting for a change.
    if (after < MIN_RESIDENCES) {
      return {
        action: 'enable',
        crossesThreshold: false,
        message:
          `Make ${label} one of ${whose(clientName)} homes?\n\n` +
          `Nothing changes on her site yet. ${who(clientName)} needs two homes before the ` +
          `home tiles appear, and this is the first.`,
      }
    }
    // 2 -> 3 and up. One more tile.
    return {
      action: 'enable',
      crossesThreshold: false,
      message:
        `Make ${label} one of ${whose(clientName)} homes?\n\n` +
        `She already has ${currentHomeCount}, so this adds a tile. It shows up once looks are ` +
        `filed into ${label}.`,
    }
  }

  // 2 -> 1. Her front page goes back to the ordinary one. This is the destructive-feeling one,
  // and the one most likely to be a mis-tap, so it says the whole consequence.
  if (currentHomeCount === MIN_RESIDENCES) {
    return {
      action: 'disable',
      crossesThreshold: true,
      message:
        `Stop ${label} being one of ${whose(clientName)} homes?\n\n` +
        `She would be down to one home, so her home tiles go away and her front page goes back ` +
        `to normal.\n\n` +
        `${label} stays as an ordinary category` +
        (lookCount ? ` with ${plural(lookCount, 'look', 'looks')} in it` : '') +
        `. Tick Home again to put it back.`,
    }
  }

  // 3 -> 2 and down. One tile goes.
  return {
    action: 'disable',
    crossesThreshold: false,
    message:
      `Stop ${label} being one of ${whose(clientName)} homes?\n\n` +
      `Its tile comes off her front page now.\n\n` +
      `${label} stays as an ordinary category` +
      (lookCount ? ` with ${plural(lookCount, 'look', 'looks')} in it` : '') +
      `. Tick Home again to put it back.`,
  }
}
