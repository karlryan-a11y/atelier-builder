/**
 * Did a background removal cut into the garment? ONE answer, used by api/remove-bg.ts (the Edit
 * dialog, bulk Remove background, the canvas and Reconciliation all go through it) and by
 * scripts/check-cutout.mjs.
 *
 * WHY. Remove BG on Mr. C's white pinstripe Dior shirt (Cynthia, 10/14) kept only the stripes: the
 * white cloth between them went see-through, and that picture replaced his photo in the builder,
 * the lookbook and every look. Nothing looked at the result before saving it.
 *
 * What counts as damage (measured on the picture's see-through channel, at most 400 px a side):
 *   - holes:  see-through pixels in the body of the cloth. The outline is the cutout with every
 *             gap of a few pixels closed (pinstripe gaps, speckle, cracks), then shrunk so the soft
 *             edges drop out. Jewelry and belts are not judged for holes: a chain or a woven band is
 *             see-through by design, and real cutouts of them score as high as damaged shirts.
 *   - faded:  cloth in that body left half see-through (light dresses and a white bodysuit came
 *             back with the background showing through them, with no pixel fully gone). Open
 *             weaves, sheer fabrics, sunglasses and clear plastic are see-through by design and
 *             not judged for holes or fading.
 *   - drop:   when the photo before was already a cutout of the same size, how much of the
 *             piece is gone.
 *   - empty:  almost nothing left at all.
 *
 * Plain .mjs on purpose: a node script and a Vercel function both import it as is.
 */
import sharp from 'sharp'

export const MAX_SIDE = 400
/**
 * Measured on all 1,999 distinct Remove BG results on live (10/28), each one looked at near the
 * limits: healthy pieces score holes 0.113 at most (strappy sandals) and faded 0.113 at most (a
 * mosaic clutch); the damaged ones score holes 0.19 to 0.76 (Mr. C's shirt 0.76, a white striped
 * blouse 0.23) or faded 0.21 to 0.95 (light dresses, a taffeta skirt, a white bodysuit).
 */
export const MAX_HOLES = 0.15
/** More than this share of the piece gone, compared with a see-through photo before. */
export const MAX_DROP = 0.3
/** Faded: more than this share of the body of the cloth left half see-through. */
export const MAX_FADED = 0.15
/** Below this see-through value (of 255) a pixel of cloth counts as faded. */
export const FADED_ALPHA = 230
/** Less than this share of the picture left is not a piece (a fine chain can be 0.3%). */
export const MIN_AREA = 0.01
export const MIN_AREA_THIN = 0.001
/** Gaps up to twice this share of the picture's long side count as cut into the cloth. */
export const CLOSE_FRACTION = 0.008
/** How far in from the outline the body of the cloth starts. */
export const CORE_FRACTION = 0.02
/** A body smaller than this share of the picture is too thin to judge for holes. */
export const MIN_CORE = 0.005

/** Pieces whose cutout is see-through by design: never judged for holes or fading. */
const THIN = /jewel|necklace|bracelet|earring|\bring|pendant|choker|anklet|brooch|chain|bead|pearl|belt|charm|watch/i
const OPEN = /crochet|mesh|fishnet|openwork|macram|eyelet|sheer|tulle|organza|chiffon|\blace\b(?!-trim)|sunglass|eyewear|glasses|clear|transparent|pvc|jelly|acrylic|lucite/i
export const isThinPiece = (piece) => THIN.test(`${piece?.category ?? ''} ${piece?.name ?? ''}`)
export const isOpenWeave = (piece) => OPEN.test(`${piece?.category ?? ''} ${piece?.name ?? ''}`)

export const DAMAGED_REASON =
  "The background couldn't be removed cleanly: it would have cut into the piece. The photo is unchanged."

/** The see-through channel as 0/1 (1 = piece), at most MAX_SIDE a side. */
export async function maskOf(buffer) {
  const img = sharp(buffer, { failOn: 'none' }).rotate()
  const meta = await img.metadata()
  const hasAlpha = !!meta.hasAlpha
  const { data, info } = await img
    .ensureAlpha()
    .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
    .extractChannel(3)
    .raw()
    .toBuffer({ resolveWithObject: true })
  const mask = new Uint8Array(info.width * info.height)
  for (let i = 0; i < mask.length; i++) mask[i] = data[i] >= 128 ? 1 : 0
  return { mask, alpha: data, w: info.width, h: info.height, hasAlpha, size: `${meta.width}x${meta.height}` }
}

// Square max (grow) or min (shrink) filter of radius r, done as two 1-D passes.
function filter(mask, w, h, r, max) {
  const tmp = new Uint8Array(mask.length)
  const out = new Uint8Array(mask.length)
  const want = max ? 1 : 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = max ? 0 : 1
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) {
        if (mask[y * w + k] === want) { v = want; break }
      }
      tmp[y * w + x] = v
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = max ? 0 : 1
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) {
        if (tmp[k * w + x] === want) { v = want; break }
      }
      out[y * w + x] = v
    }
  }
  return out
}

const area = (m) => { let n = 0; for (const v of m) n += v; return n }

/**
 * Measure a cutout (and, when given, the picture it was made from and the piece's category/name).
 * Returns { ok, holes, faded, drop, area, thin, reason }.
 */
export function judgeMasks(after, before, piece) {
  const { mask, alpha, w, h } = after
  const n = w * h
  const share = area(mask) / n
  const thin = isThinPiece(piece)
  const open = thin || isOpenWeave(piece)
  if (share < (thin ? MIN_AREA_THIN : MIN_AREA)) {
    return { ok: false, holes: 1, faded: 0, drop: 1, area: +share.toFixed(4), thin, reason: DAMAGED_REASON }
  }

  let holes = 0
  let faded = 0
  if (!open) {
    // Close every gap of a few pixels (grow, then shrink by the same radius), then shrink again so
    // only the body of the cloth is left. A real opening (between two legs, a bag handle) is wider
    // than the closing and stays open.
    const r = Math.max(1, Math.round(Math.max(w, h) * CLOSE_FRACTION))
    const outline = filter(filter(mask, w, h, r, true), w, h, r, false)
    const core = filter(outline, w, h, Math.max(1, Math.round(Math.max(w, h) * CORE_FRACTION)), false)
    const coreArea = area(core)
    let inside = 0
    let half = 0
    for (let i = 0; i < n; i++) {
      if (!core[i]) continue
      if (!mask[i]) inside++
      else if (alpha && alpha[i] < FADED_ALPHA) half++
    }
    if (coreArea >= n * MIN_CORE) {
      holes = inside / coreArea
      // Light cloth the remover left half see-through (a white bodysuit, a satin slip): the
      // background shows through the body even though no pixel is fully gone.
      faded = half / coreArea
    }
  }

  // Compared with a picture that was already see-through around the piece, framed the same way
  // (same size). A differently framed picture says nothing: 4 healthy cutouts in 1,000 were
  // "30% smaller" only because the earlier photo was cropped tighter.
  let drop = 0
  // Jewelry and belts are left out here too: a chain's earlier photo often had white filled in
  // between the strands, and taking that out is the point.
  if (!thin && before && before.hasAlpha && before.size === after.size) {
    const was = area(before.mask) / (before.w * before.h)
    if (was >= MIN_AREA && was < 0.98) drop = Math.max(0, 1 - share / was)
  }

  const ok = holes <= MAX_HOLES && faded <= MAX_FADED && drop <= MAX_DROP
  return { ok, holes: +holes.toFixed(3), faded: +faded.toFixed(3), drop: +drop.toFixed(3), area: +share.toFixed(4), thin, reason: ok ? null : DAMAGED_REASON }
}

/** The whole check from two pictures' bytes (before may be null) and the piece { category, name }. */
export async function judgeCutout(afterBytes, beforeBytes, piece) {
  const after = await maskOf(afterBytes)
  let before = null
  if (beforeBytes) { try { before = await maskOf(beforeBytes) } catch { before = null } }
  return judgeMasks(after, before, piece)
}
