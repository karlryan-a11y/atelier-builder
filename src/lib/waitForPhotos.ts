/**
 * WAIT UNTIL EVERY PHOTO ON THE BOARD HAS LOADED, before its picture is taken (ADR-0194).
 *
 * 2026-10-20: Peyton's London capsule (32 pieces) was saved while its photos were still loading.
 * The saved picture is a snapshot of the canvas, labels draw at once, and a photo only appears when
 * it has arrived, so her site showed brand names with no clothes. Measured on that board: 0 of 95
 * photos drawn at 2.5 seconds, 21 at 5, 63 at 9.
 *
 * No imports, so the build guard (scripts/check-photos-before-save.mjs) runs it as it ships.
 */
export const PHOTO_WAIT_MS = 20_000
const POLL_MS = 100

/** Resolves true once `pending()` is empty, false if photos are still loading after `timeoutMs`. */
export async function waitForPhotos(
  pending: () => string[],
  { timeoutMs = PHOTO_WAIT_MS, pollMs = POLL_MS }: { timeoutMs?: number; pollMs?: number } = {},
): Promise<boolean> {
  const until = Date.now() + timeoutMs
  while (pending().length > 0) {
    if (Date.now() >= until) return false
    await new Promise((r) => setTimeout(r, pollMs))
  }
  return true
}

/**
 * Share of a picture that is not near-white (the same measure as the 10/22 scan of all 1,518 live
 * pictures). Peyton's broken capsule was 0.037; the lowest good live picture is 0.056.
 */
export const NEARLY_EMPTY_COVERAGE = 0.045
export function inkCoverage(rgba: ArrayLike<number>): number {
  let ink = 0, px = 0
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    px++
    // Transparent counts as white: the board is white behind the picture.
    if (rgba[i + 3] < 16) continue
    const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
    if (lum < 235) ink++
  }
  return px ? ink / px : 0
}
