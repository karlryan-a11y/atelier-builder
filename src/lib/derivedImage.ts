/**
 * The small, pre-built copy of an image, for every GRID TILE that shows a look or a piece.
 *
 * Look pictures are baked at 2160x2160 (~1.9 MB PNG, ~18 MB decoded on an iPad); GoodPix
 * pictures are 800 to 1080 px. A tile draws them at a few hundred px. scripts/
 * generate-look-derivatives.mjs writes a resized JPEG next to each original in R2 under
 * `derived/w<width>q82/`, and the client lookbook already reads them. This is the SAME rule as
 * atelier-looks/src/lib/supabase.ts `derivedKeyFor` / `derivedImageUrl`: KEEP ALL THREE IN STEP.
 * A drift fails as a 404 per image that the tile's fallback hides by loading the original, so
 * the screen still works and silently weighs ten times what it should.
 *
 * One builder-only addition: the Builder rewrites GoodPix URLs to the same-origin `/img-proxy/`
 * path (lib/images.ts proxyImageUrl), so that form is read back as the GoodPix file it names.
 *
 * Widths that exist: 760 for looks, 400 for collection pieces. Variants are built for PUBLISHED
 * looks and live pieces only, so a draft look has none: callers must fall back to the original
 * (components/common/TileImage.tsx does). Full size stays for the canvas, editor and zoom.
 */
export type DerivedWidth = 400 | 760
export const LOOK_TILE_WIDTH: DerivedWidth = 760
export const PIECE_TILE_WIDTH: DerivedWidth = 400
const DERIVED_QUALITY = 82
const GOODPIX_HOST = 'goodpix-co.s3.amazonaws.com'

export function derivedKeyFor(url: string, width: DerivedWidth): string | null {
  // Our own R2, addressed through the proxy.
  if (url.includes('/functions/v1/image-proxy')) {
    try {
      const key = new URL(url).searchParams.get('key')
      if (!key) return null
      const original = decodeURIComponent(key)
      if (original.startsWith('derived/')) return null // already a variant
      return `derived/w${width}q${DERIVED_QUALITY}/${original}.jpg`
    } catch {
      return null
    }
  }
  // GoodPix-hosted. The filename is a content hash, so it keys the variant directly.
  if (url.includes(GOODPIX_HOST)) {
    try {
      const file = new URL(url).pathname.replace(/^\/+/, '')
      if (!file) return null
      return `derived/w${width}q${DERIVED_QUALITY}/goodpix/${file}.jpg`
    } catch {
      return null
    }
  }
  // Builder-only: a GoodPix URL already rewritten to the same-origin proxy path.
  if (url.startsWith('/img-proxy/')) {
    const file = url.slice('/img-proxy/'.length).split(/[?#]/)[0]
    return file ? `derived/w${width}q${DERIVED_QUALITY}/goodpix/${file}.jpg` : null
  }
  return null
}

const envBase = (): string | undefined =>
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_URL

/** The variant's URL, or null when there is none to point at (callers use the original). */
export function derivedImageUrl(
  url: string | null | undefined,
  width: DerivedWidth,
  supabaseUrl: string | undefined = envBase(),
): string | null {
  if (!url || !supabaseUrl) return null
  const key = derivedKeyFor(url, width)
  return key ? `${supabaseUrl}/functions/v1/image-proxy?key=${encodeURIComponent(key)}` : null
}
