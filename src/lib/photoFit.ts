import type { ClosetItemNode } from '@/types/canvas'

/**
 * A PIECE KEEPS ITS SIZE AND PLACE WHEN ITS PHOTO IS REPLACED.
 *
 * A piece on a board is saved as a scale of its photo. Cynthia Dada, 2026-11-18: Chris Cadieux's
 * Thanksgiving Looks capsule "opened with items larger and out of place" because on 11/12 the
 * Prada crewneck's photo went from 400x500 to 1212x1297 and the loafers' from 357x500 to
 * 1673x940, and the same scale drew them three to five times bigger.
 *
 * So each piece remembers the photo it was sized against: its size (photo_w, photo_h) and, when the
 * board could measure it, the box of the garment inside it (photo_box, the see-through margin left
 * out). When it is drawn with a photo of another size, the garment in the new photo is fitted into
 * where the garment was, centred, keeping any stretch, flip and turn; then the piece remembers the
 * new photo. Fitting by the garment matters: a replaced photo is often cropped tight where the old
 * one had a wide empty margin (Round Top's earrings), and fitting whole photos would enlarge it.
 *
 * A piece that has never remembered a photo only learns it (it was saved before this, so its scale
 * is all there is). A piece Compose sized by height (target_height) is drawn from its photo's
 * height already. Returns the very same node when nothing changes, so callers can skip the update.
 */
export type PhotoBox = [number, number, number, number]

export function fitToPhoto(node: ClosetItemNode, w: number, h: number, box?: PhotoBox | null): ClosetItemNode {
  if (!(w > 0 && h > 0)) return node
  const learned = { photo_w: w, photo_h: h, ...(box ? { photo_box: box } : {}) }
  if (node.photo_w === w && node.photo_h === h) {
    // Same size. Only a garment that sits clearly elsewhere in it (a new photo cropped another way,
    // Round Top's ring) is refitted; reading the same photo again never moves anything.
    const moved = box && node.photo_box && box.some((v, i) => Math.abs(v - node.photo_box![i]) > 0.03 * Math.max(w, h))
    if (!moved) return box && !node.photo_box ? { ...node, photo_box: box } : node
  }
  if (!(node.photo_w && node.photo_h) || node.target_height) return { ...node, ...learned }

  // Garment boxes when both are known, else the whole photos.
  const both = !!(box && node.photo_box)
  const ob = both ? node.photo_box! : [0, 0, node.photo_w, node.photo_h]
  const nb = both ? box! : [0, 0, w, h]
  const obW = ob[2] - ob[0], obH = ob[3] - ob[1], nbW = nb[2] - nb[0], nbH = nb[3] - nb[1]
  if (!(obW > 0 && obH > 0 && nbW > 0 && nbH > 0)) return { ...node, ...learned }
  const f = Math.min(obW / nbW, obH / nbH)
  const sx = node.scale, sy = node.scale_y ?? node.scale
  // Move the origin so the new garment's centre lands on the old one's, in the piece's own
  // (unturned) frame. A flipped piece is drawn leftward from x, so its offset runs the other way.
  const dx = ((ob[0] + obW / 2) * sx - (nb[0] + nbW / 2) * sx * f) * (node.flipped ? -1 : 1)
  const dy = (ob[1] + obH / 2) * sy - (nb[1] + nbH / 2) * sy * f
  const r = ((node.rotation || 0) * Math.PI) / 180
  return {
    ...node,
    x: node.x + dx * Math.cos(r) - dy * Math.sin(r),
    y: node.y + dx * Math.sin(r) + dy * Math.cos(r),
    scale: sx * f,
    ...(node.scale_y != null ? { scale_y: node.scale_y * f } : {}),
    photo_w: w,
    photo_h: h,
    ...(box ? { photo_box: box } : { photo_box: undefined }),
  }
}

/**
 * The box of what is drawn in a photo (its non see-through pixels), in the photo's own pixels, read
 * from a copy no bigger than 96px so it is cheap. Null when the photo can't be read (tainted) or
 * is empty. `coverage` is how much of that box is filled, which the board uses for its click area.
 */
export function photoContent(image: CanvasImageSource & { width: number; height: number }, natW: number, natH: number): { box: PhotoBox; coverage: number } | null {
  try {
    const s = Math.min(1, 96 / Math.max(natW, natH))
    const w = Math.max(1, Math.round(natW * s)), h = Math.max(1, Math.round(natH * s))
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(image, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data
    let minX = w, minY = h, maxX = -1, maxY = -1, opaque = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) { opaque++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
    }
    if (maxX < minX || maxY < minY) return null
    const bw = maxX - minX + 1, bh = maxY - minY + 1
    return { box: [minX / s, minY / s, (maxX + 1) / s, (maxY + 1) / s], coverage: opaque / (bw * bh) }
  } catch {
    return null
  }
}
