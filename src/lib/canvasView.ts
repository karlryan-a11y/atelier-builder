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
