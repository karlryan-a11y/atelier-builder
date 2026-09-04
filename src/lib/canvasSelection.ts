/**
 * Canvas selection decisions, in one place.
 *
 * The bug this exists for (Cynthia, 4 Sep: "the select function is working maybe 15% of the
 * time for me", "when i click on an item, it should select it. i don't want to click it twice"):
 *
 * Every solid garment on the board carries a PIXEL-PERFECT hit mask, so only its opaque pixels
 * are clickable. Selection used to be wired to Konva's `click`, and Konva fires `click` only
 * when the shape under the pointer at press is the SAME shape as at release
 * (Stage._pointerup: `clickStartShape === shape`). On a packing capsule, a two-pixel trackpad
 * drift crosses a mask boundary, the two disagree, and no click event is fired at all. The
 * release then reads as "on the stage", which ALSO cleared the whole selection, because the
 * clear never asked where the press had started.
 *
 * Measured on the real boards, per visible garment pixel: on "Back Up Save for Capsule"
 * (167 nodes) 19.4% of presses could not fire a click, on "Melbourne + Sydney Packing Capsule"
 * 15.0%, against 9.0% on a 23-node look. It gets worse the denser the board, which is why it
 * reads as broken on capsules and merely fussy elsewhere.
 *
 * So: a piece is selected on the PRESS, and a selection is only cleared when the press itself
 * began on empty board. Both decisions live here so a third surface cannot re-derive them.
 */

/** What the pointer was over at each end of one press-and-release gesture. */
export interface Gesture {
  /** The press (mouse-down / touch-start) landed on empty board, not on a piece. */
  pressedEmpty: boolean
  /** The release (mouse-up) landed on empty board. */
  releasedEmpty: boolean
  /** The gesture became a marquee drag, which sets its own selection. */
  marquee: boolean
}

/**
 * Clicking empty board clears the selection. A press that STARTED on a piece never does,
 * however far the pointer drifted before it came up - that drift is the bug, not an intent.
 */
export function shouldClearSelection(g: Gesture): boolean {
  if (g.marquee) return false
  return g.pressedEmpty && g.releasedEmpty
}

export interface PressModifiers {
  shiftKey?: boolean
  metaKey?: boolean
  /** MouseEvent.button. Undefined for touch. Only the primary button selects. */
  button?: number
}

export type SelectionOutcome =
  | { action: 'ignore' }
  | { action: 'toggle'; nodeId: string }
  | { action: 'keep-group' }
  | { action: 'replace'; nodeId: string }

/**
 * What a press on `nodeId` should do to the current selection.
 *
 * `keep-group` is the one non-obvious case: pressing a piece that is already part of a
 * multi-selection must NOT collapse to that one piece, or dragging several pieces together
 * would break the moment you touched one of them.
 */
export function selectionOnPress(
  current: readonly string[],
  nodeId: string,
  mods: PressModifiers = {}
): SelectionOutcome {
  if (mods.button !== undefined && mods.button !== 0) return { action: 'ignore' }
  if (mods.shiftKey || mods.metaKey) return { action: 'toggle', nodeId }
  if (current.length > 1 && current.includes(nodeId)) return { action: 'keep-group' }
  return { action: 'replace', nodeId }
}

/**
 * Offsets to probe around a press that landed on nothing, nearest first, excluding the centre
 * (the centre is what already missed).
 *
 * Why this is needed at all: a garment's hit area is an alpha mask rasterised at on-screen
 * scale, so thin detail comes out of the rasteriser with no coverage. A chain strap, a heel, a
 * spaghetti strap is visible and unclickable. Measured over every visible garment pixel of the
 * Melbourne + Sydney packing capsule, pressing the garment resolved to nothing 16.6% of the
 * time. Probing a 4px ring takes that to 0.5%, and 8px to 0%.
 *
 * Kept deliberately small. This is "she was aiming at the piece", not "find her something".
 */
export function ringOffsets(maxRadius: number, step = 2, spokes = 16): { dx: number; dy: number }[] {
  const out: { dx: number; dy: number }[] = []
  for (let radius = step; radius <= maxRadius; radius += step) {
    for (let spoke = 0; spoke < spokes; spoke++) {
      const angle = (spoke * 2 * Math.PI) / spokes
      out.push({ dx: radius * Math.cos(angle), dy: radius * Math.sin(angle) })
    }
  }
  return out
}
