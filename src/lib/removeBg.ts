/**
 * REMOVE BG, the one place every Remove BG button calls (Edit Item, bulk Remove BG, the canvas
 * toolbar, the Drive check).
 *
 * Cynthia Dada, 2026-11-18: Peyton's new Jacquemus pieces said "couldn't fetch the item image (403)".
 * GoodPix brought them in with their photo still on jacquemus.com, and that site refuses the
 * background remover's download (it answers an ordinary server fine). So a photo on a store's own
 * site goes through api/remove-bg.ts, which keeps a copy in our storage and hands the remover that
 * copy. Photos already on GoodPix's storage or ours go straight to the remover, as before.
 */

import { authHeader } from '@/lib/authHeader'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

// Where our own photos live: GoodPix's bucket, the database's storage and image-proxy, our photo paths.
const OUR_PHOTO_HOSTS = /(^|\.)(goodpix-co\.s3\.amazonaws\.com|supabase\.co|atelierbywatson\.com|watsonstylegroup\.com|r2\.dev|vercel\.app)$/i

/** True when the photo sits on a store's own site (not ours, not GoodPix's), so the remover can't fetch it. */
export function isStorePhoto(url: string | null | undefined): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false
  let host = ''
  try { host = new URL(url).hostname } catch { return false }
  return !OUR_PHOTO_HOSTS.test(host)
}

// The app is served under atelierbywatson.com/style, where a relative /api/... is the dashboard, so
// call the builder's own address. A branch preview calls its own copy (same as AddItemDialog).
const REMOVE_BG_API = typeof location !== 'undefined' && /-wsgautomations-projects\.vercel\.app$/.test(location.hostname)
  ? '/api/remove-bg'
  : 'https://atelier-builder.vercel.app/api/remove-bg'

export interface RemoveBgResult { ok: boolean; url?: string; reason?: string; error?: string }

/** Remove one piece's background. Never throws for a refusal: read `ok` and `reason`. */
export async function removeItemBackground(itemId: string, clientId: string | null | undefined, imageUrl: string | null | undefined): Promise<RemoveBgResult> {
  const headers = { 'Content-Type': 'application/json', ...(await authHeader()) }
  const resp = isStorePhoto(imageUrl)
    ? await fetch(REMOVE_BG_API, { method: 'POST', headers, body: JSON.stringify({ item_id: itemId, client_id: clientId, image_url: imageUrl }) })
    : await fetch(`${SUPABASE_URL}/functions/v1/intake-remove-bg-item`, { method: 'POST', headers, body: JSON.stringify({ item_id: itemId, image_url: imageUrl }) })
  const d = await resp.json().catch(() => ({}))
  return { ...d, ok: resp.ok && !!d?.ok }
}
