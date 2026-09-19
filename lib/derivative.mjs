/**
 * ONE definition of a "small copy" of a picture, shared by everything that makes one:
 *   - scripts/generate-look-derivatives.mjs  (the original platform pass)
 *   - scripts/backfill-derivatives.mjs       (drafts, pieces, small sources)
 *   - api/derive-image.ts                    (on Save / on Digitize approve / on replace)
 *
 * The lookbook (atelier-looks src/lib/supabase.ts `derivedKeyFor`) and the builder
 * (src/lib/derivedImage.ts) compute the SAME key to ask for it. Change a number here
 * and every existing copy is orphaned: the readers ask for a key nobody wrote.
 * `npm run guard` (check-derivative-parity) fails if the two sides drift.
 *
 * Plain .mjs on purpose: a node script and a Vercel function both import it as is.
 */
import sharp from 'sharp'

/** 760 covers a look tile at 2x on retina; 400 covers a collection tile at 2x. */
export const LOOK_WIDTH = 760
export const ITEM_WIDTH = 400
export const QUALITY = 82

/** The copy's key: a pure function of the original key and the width. */
export const derivedKey = (key, width) => `derived/w${width}q${QUALITY}/${key}.jpg`

/**
 * Build the small copy from the original's bytes.
 *
 * A source already narrower than the target is RE-ENCODED at its own size rather
 * than skipped. The old generator skipped it, so its derived key never existed and
 * every tile that asked for it paid a 404 and then the original. A same-size JPEG
 * is still smaller than a transparent PNG, and now the key always exists.
 *
 * Returns { buffer, srcWidth, outWidth, resized }.
 */
export async function makeDerivative(src, width) {
  const img = sharp(src) // same pipeline as the original generator, byte for byte
  const meta = await img.metadata()
  const srcWidth = meta.width ?? 0
  const resized = srcWidth > width
  let pipeline = img
  if (resized) pipeline = pipeline.resize({ width, withoutEnlargement: true })
  const buffer = await pipeline
    .flatten({ background: '#ffffff' }) // look PNGs are transparent; JPEG needs a matte
    .jpeg({ quality: QUALITY, progressive: true, mozjpeg: true })
    .toBuffer()
  return { buffer, srcWidth, outWidth: resized ? width : srcWidth, resized }
}

/** Cache header written on the object itself (R2 metadata). Keys never change content. */
export const DERIVED_CACHE_CONTROL = 'public, max-age=31536000, immutable'
