/**
 * The one place a look's picture comes from, for every surface that SHOWS a look.
 *
 * gp_looks.thumbnail_url holds a base64 2160x2160 JPEG written on every builder Save. It is
 * 641+ looks and ~199 MB in total, and three hooks selected it for every look of the client on
 * every screen open: Danielle York's Categorize grid alone was a ~50 MB response. The same
 * picture is also stored in R2 and linked from raw.main_image_url (every look that has a stored
 * thumbnail also has main_image_url, measured on production 2026-09-18: 648 of 648), served by
 * image-proxy with CORS `*` and a one-year immutable cache, so a canvas composite drawn from it
 * stays untainted.
 *
 * Rule: no browser SELECT of gp_looks / looks names thumbnail_url (or selects `*`), enforced by
 * scripts/check-no-thumbnail-select.mjs. The Save path still WRITES thumbnail_url; moving that
 * storage to R2 only is a separate job.
 */
import { cdnUrl } from './imageUrls.ts'
export function lookImageUrl(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const url = (raw as Record<string, unknown>).main_image_url
  // Rows store the image-proxy spelling; screens load the cached photo path (lib/imageUrls.ts).
  return typeof url === 'string' && url.length > 0 ? cdnUrl(url) : null
}
