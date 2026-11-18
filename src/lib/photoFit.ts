import type { ClosetItemNode } from '@/types/canvas'

/**
 * A PIECE KEEPS ITS SIZE AND PLACE WHEN ITS PHOTO IS REPLACED.
 *
 * A piece on a board is saved as a scale of its photo. Cynthia Dada, 2026-11-18: Chris Cadieux's
 * Thanksgiving Looks capsule "opened with items larger and out of place" because on 11/12 the
 * Prada crewneck's photo went from 400x500 to 1212x1297 and the loafers' from 357x500 to
 * 1673x940, and the same scale drew them three to five times bigger.
 *
 * So each piece remembers the photo size it was sized against (photo_w, photo_h). When it is drawn
 * with a photo of another size, the new photo is fitted into the same box, centred, keeping any
 * stretch, flip and turn, and the piece then remembers the new photo. A piece that has never
 * remembered a photo only learns it (it was saved before this, so its scale is all there is).
 * A piece Compose sized by height (target_height) is drawn from its photo's height already.
 *
 * Returns the very same node when nothing changes, so callers can skip the update.
 */
export function fitToPhoto(node: ClosetItemNode, w: number, h: number): ClosetItemNode {
  if (!(w > 0 && h > 0)) return node
  if (node.photo_w === w && node.photo_h === h) return node
  if (!(node.photo_w && node.photo_h) || node.target_height) return { ...node, photo_w: w, photo_h: h }

  const f = Math.min(node.photo_w / w, node.photo_h / h)
  const sx = node.scale, sy = node.scale_y ?? node.scale
  // Space left over inside the old box, split evenly, in the piece's own (unturned) frame.
  // A flipped piece is drawn leftward from x, so its offset runs the other way.
  const dx = ((node.photo_w - w * f) * sx / 2) * (node.flipped ? -1 : 1)
  const dy = (node.photo_h - h * f) * sy / 2
  const r = ((node.rotation || 0) * Math.PI) / 180
  return {
    ...node,
    x: node.x + dx * Math.cos(r) - dy * Math.sin(r),
    y: node.y + dx * Math.sin(r) + dy * Math.cos(r),
    scale: sx * f,
    ...(node.scale_y != null ? { scale_y: node.scale_y * f } : {}),
    photo_w: w,
    photo_h: h,
  }
}
