/**
 * REMOVE BG, the one place every Remove BG button calls (Edit Item, bulk Remove BG, the canvas
 * toolbar, the Drive check).
 *
 * Cynthia Dada, 2026-11-18: Peyton's new Jacquemus pieces said "couldn't fetch the item image (403)".
 * GoodPix brought them in with their photo still on jacquemus.com, and that site refuses every
 * server (the background remover's, Vercel's, image services), while it shows the photo in her own
 * browser. Nothing on our side can fetch it, so when a store's site refuses, she is told the one thing
 * that works: save the photo from the store's page and use Replace photo, which cleans it the same way.
 */

import { authHeader } from '@/lib/authHeader'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

// Where photos the remover can read live: GoodPix's storage and Cloudinary, our database storage and
// image-proxy, our photo paths. Anything else is a store's own site.
const OUR_PHOTO_HOSTS = /(^|\.)(amazonaws\.com|cloudinary\.com|supabase\.co|atelierbywatson\.com|watsonstylegroup\.com|r2\.dev|vercel\.app)$/i

/** True when the photo sits on a store's own site, not on GoodPix's storage or ours. */
export function isStorePhoto(url: string | null | undefined): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false
  let host = ''
  try { host = new URL(url).hostname } catch { return false }
  return !OUR_PHOTO_HOSTS.test(host)
}

/** The store's name as she'd say it: "jacquemus.com" for www.jacquemus.com. */
export function storeSite(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return "the store's site" }
}

/** What she reads when the remover couldn't download the photo from the store. */
export function storeRefusedMessage(url: string): string {
  return `${storeSite(url)} won't let Atelier download this photo, so the background can't be removed here. ` +
    `Open the piece on ${storeSite(url)}, save the photo to your computer, then use Replace photo on this piece: ` +
    `it comes back as a clean cutout.`
}

export interface RemoveBgResult { ok: boolean; url?: string; reason?: string; error?: string }

/** Remove one piece's background. Never throws for a refusal: read `ok` and `reason`. */
export async function removeItemBackground(itemId: string, imageUrl: string | null | undefined): Promise<RemoveBgResult> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-remove-bg-item`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ item_id: itemId, image_url: imageUrl }),
  })
  const d = await resp.json().catch(() => ({}))
  const ok = resp.ok && !!d?.ok
  const said = String(d?.reason || d?.error || '')
  if (!ok && imageUrl && isStorePhoto(imageUrl) && /couldn'?t fetch|fetch the item image|\b40[13]\b/i.test(said)) {
    return { ...d, ok, reason: storeRefusedMessage(imageUrl) }
  }
  return { ...d, ok }
}
