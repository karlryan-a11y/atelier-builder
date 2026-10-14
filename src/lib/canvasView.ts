/**
 * How far the board is zoomed in, and nothing else.
 *
 * Cynthia, 4 Sep: "Can we get a zoom in feature when working on capsules? It would be great to
 * zoom in when working with smaller items on a board for formatting."
 *
 * She is right about the sizes. On the Melbourne + Sydney packing capsule the 1080px board is
 * fitted to roughly 596px on screen, so the median piece is 49px on its short side, 18 of the
 * 61 pieces are under 40px, and the smallest is 19px. She is positioning 19-pixel shoes.
 *
 * 1 is "the whole board, fitted". There is no zooming out past that, because fitted already
 * shows everything. The steps are discrete so the readout is always a round number she can say
 * out loud.
 */
export const ZOOM_STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4] as const

export const MIN_ZOOM = ZOOM_STEPS[0]
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** The next step in or out. Stops at the ends rather than wrapping. */
export function nextZoom(current: number, direction: 1 | -1): number {
  const here = clampZoom(current)
  if (direction === 1) return ZOOM_STEPS.find((z) => z > here + 1e-9) ?? MAX_ZOOM
  const below = ZOOM_STEPS.filter((z) => z < here - 1e-9)
  return below.length ? below[below.length - 1] : MIN_ZOOM
}

/** What the readout says. Always a whole number of percent. */
export function zoomLabel(zoom: number): string {
  return `${Math.round(clampZoom(zoom) * 100)}%`
}

/**
 * HOW SMALL A PIECE MAY BE RESIZED (Cynthia, 2026-10-14: "I'm unable to make this shoe smaller",
 * a brown Gucci horsebit flat on Stacy Janiak's Landscape capsule). The resize handles used to stop
 * at 20 screen px on EITHER side. A flat is wide and short, so its HEIGHT hit 20 px while the shoe
 * still looked big beside the sneakers, and on a Landscape board (shown at about a fifth of its
 * real size) 20 screen px is a lot of board. Now only the LONGER side has a floor, and it is half as
 * big: a piece can get as short as it needs, but never so small you cannot find and grab it. To go
 * smaller still, zoom in (the floor is on screen, so zooming in lowers it on the board).
 * Konva hands boundBoxFunc boxes in screen px, which is what this measures.
 */
export const MIN_PIECE_SCREEN_PX = 10

export function resizeAllowed(box: { width: number; height: number }): boolean {
  const w = Math.abs(box.width)
  const h = Math.abs(box.height)
  if (!Number.isFinite(w) || !Number.isFinite(h)) return false
  return Math.max(w, h) >= MIN_PIECE_SCREEN_PX && Math.min(w, h) >= 1
}
