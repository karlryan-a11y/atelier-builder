/**
 * THE ONLY PLACE the builder spells out a URL for a picture in our R2.
 *
 * Two spellings, on purpose:
 *
 *   r2ImageUrl(key)      what a SCREEN loads: atelierbywatson.com/img/<key>, a route in
 *                        wsg-dashboard that reads R2 and answers with CDN-cacheable headers.
 *                        Measured 2026-09-19: the Supabase image-proxy function sat uncached in
 *                        front of every tile, 400-580 ms per 20 KB picture on every view. A CDN
 *                        HIT is a static file. CORS is `*`, so the canvas can still export.
 *
 *   storedProxyUrl(key)  what is WRITTEN to the database or handed to GoodPix: the Supabase
 *                        image-proxy URL, exactly as every existing row already holds it. Rows
 *                        stay in one spelling; screens convert at read time with cdnUrl().
 *
 * The lookbook's twin is atelier-looks src/lib/supabase.ts (r2ImageUrl / cdnUrl / r2KeyOf).
 * scripts/check-image-urls.mjs fails `npm run guard` if another file builds either spelling.
 */

const env = (): Record<string, string | undefined> =>
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}

const IMG_BASE = String(env().VITE_IMG_BASE || 'https://atelierbywatson.com').replace(/\/+$/, '')
const IMAGE_ORIGIN = new URL(IMG_BASE).origin
const PROXY_PATH = '/functions/v1/image-proxy'
/** The R2 custom domain intake approval still writes into raw.processed_image. It does not resolve. */
const DEAD_R2_HOST = 'images.atelierbywatson.com'

const encodeKey = (key: string) => key.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')

/** What a screen loads for one R2 key: the cached photo path. */
export function r2ImageUrl(key: string): string {
  return `${IMG_BASE}/img/${encodeKey(key)}`
}

/** What gets stored in a row or exported: the Supabase image-proxy URL every existing row holds. */
export function storedProxyUrl(key: string, supabaseUrl: string | undefined = env().VITE_SUPABASE_URL): string {
  return `${supabaseUrl}${PROXY_PATH}?key=${encodeURIComponent(key)}`
}

/**
 * The R2 key behind one of OUR picture URLs, in any spelling it is stored or shown in:
 * the image-proxy function (?key=), the /img/ photo path, or the dead R2 host.
 * Null for anything else (GoodPix, /img-proxy/, data:, blob:).
 */
export function r2KeyOf(url: string | null | undefined): string | null {
  if (!url || !/^https?:\/\//.test(url)) return null
  try {
    const u = new URL(url)
    if (u.pathname.endsWith(PROXY_PATH)) {
      const k = u.searchParams.get('key')
      return k ? decodeURIComponent(k).replace(/^\/+/, '') : null
    }
    if (u.hostname === DEAD_R2_HOST) return decodeURIComponent(u.pathname).replace(/^\/+/, '') || null
    if (u.origin === IMAGE_ORIGIN && u.pathname.startsWith('/img/')) {
      return decodeURIComponent(u.pathname.slice('/img/'.length)) || null
    }
  } catch {
    /* not a URL */
  }
  return null
}

/** Any picture URL, pointed at the cached photo path when it is one of ours; others unchanged. */
export function cdnUrl(url: string): string
export function cdnUrl(url: string | null | undefined): string | null
export function cdnUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const key = r2KeyOf(url)
  return key ? r2ImageUrl(key) : url
}
