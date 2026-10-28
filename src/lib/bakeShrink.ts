import type Konva from 'konva'

/**
 * A SHRUNK PIECE BAKES FROM A PROPERLY SHRUNK PHOTO.
 *
 * Cynthia Dada, 2026-10-20, Mr. C's Dior shirt: "Is there a way to make it so that stripe patterns
 * don't look warped when the garment is smaller?" A browser draws a big photo small in one step and
 * skips most of its pixels, so stripes come out uneven (a pinstripe folds into fake wide stripes)
 * and plain wool sparkles. Asking the canvas for imageSmoothingQuality 'high' does nothing in
 * Chromium, and a stepped shrink (59dc8bc) blurred plain pieces, so neither is used.
 *
 * Instead, for the bake only, each photo is shrunk here (Lanczos, the filter the lookbook's small
 * copies use) to the exact pixel size it is drawn at, and Konva draws that copy 1:1 into the very
 * same box. Nothing moves, and a photo that is not shrunk is drawn exactly as before.
 *
 * Both bake paths go through bakeWithShrunkPhotos: the stylist Save (LookCanvas's registered
 * export) and the headless renderer (render/composite.ts). scripts/check-bake-stripes.mjs measures
 * it in a real Chromium and WebKit.
 */

const LOBES = 3
const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x))
const lanczos = (x: number) => (Math.abs(x) < LOBES ? sinc(x) * sinc(x / LOBES) : 0)

/** For each output pixel along one axis: the first source pixel it reads and the weights. */
function weights(srcLen: number, dstLen: number) {
  const ratio = srcLen / dstLen
  const radius = LOBES * ratio
  const taps = Math.ceil(radius) * 2 + 1
  const start = new Int32Array(dstLen)
  const w = new Float32Array(dstLen * taps)
  for (let i = 0; i < dstLen; i++) {
    const center = (i + 0.5) * ratio - 0.5
    const first = Math.ceil(center - radius)
    start[i] = first
    let sum = 0
    for (let t = 0; t < taps; t++) { const v = lanczos((first + t - center) / ratio); w[i * taps + t] = v; sum += v }
    for (let t = 0; t < taps; t++) w[i * taps + t] /= sum
  }
  return { start, w, taps }
}

/**
 * Shrink RGBA pixels (straight alpha, as getImageData gives them) to dw x dh. Alpha is premultiplied
 * while filtering so a cut-out garment's edge does not pick up a dark fringe from its transparent
 * surround. Pure, so it is checked without a browser.
 */
export function shrinkPixels(src: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number): Uint8ClampedArray {
  const pre = new Float32Array(sw * sh * 4)
  for (let i = 0; i < sw * sh; i++) {
    const a = src[i * 4 + 3] / 255
    pre[i * 4] = src[i * 4] * a; pre[i * 4 + 1] = src[i * 4 + 1] * a; pre[i * 4 + 2] = src[i * 4 + 2] * a; pre[i * 4 + 3] = src[i * 4 + 3]
  }
  // Across: sw -> dw, every source row.
  const H = weights(sw, dw)
  const mid = new Float32Array(dw * sh * 4)
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let t = 0; t < H.taps; t++) {
        const wt = H.w[x * H.taps + t]
        if (wt === 0) continue
        const sx = Math.min(sw - 1, Math.max(0, H.start[x] + t))
        const i = (y * sw + sx) * 4
        r += pre[i] * wt; g += pre[i + 1] * wt; b += pre[i + 2] * wt; a += pre[i + 3] * wt
      }
      const o = (y * dw + x) * 4
      mid[o] = r; mid[o + 1] = g; mid[o + 2] = b; mid[o + 3] = a
    }
  }
  // Down: sh -> dh, every column.
  const V = weights(sh, dh)
  const out = new Uint8ClampedArray(dw * dh * 4)
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let t = 0; t < V.taps; t++) {
        const wt = V.w[y * V.taps + t]
        if (wt === 0) continue
        const sy = Math.min(sh - 1, Math.max(0, V.start[y] + t))
        const i = (sy * dw + x) * 4
        r += mid[i] * wt; g += mid[i + 1] * wt; b += mid[i + 2] * wt; a += mid[i + 3] * wt
      }
      const o = (y * dw + x) * 4
      const alpha = Math.min(255, Math.max(0, a))
      out[o + 3] = alpha
      if (alpha > 0) { out[o] = (r * 255) / alpha; out[o + 1] = (g * 255) / alpha; out[o + 2] = (b * 255) / alpha }
    }
  }
  return out
}

type Photo = HTMLImageElement | HTMLCanvasElement
const copies = new WeakMap<Photo, Map<string, HTMLCanvasElement>>()

/** The photo shrunk to w x h, made once per photo and size. Null when its pixels cannot be read. */
function shrunkCopy(photo: Photo, sw: number, sh: number, w: number, h: number): HTMLCanvasElement | null {
  const key = `${w}x${h}`
  const known = copies.get(photo)?.get(key)
  if (known) return known
  try {
    const read = document.createElement('canvas')
    read.width = sw; read.height = sh
    const rctx = read.getContext('2d', { willReadFrequently: true })!
    rctx.drawImage(photo, 0, 0)
    const px = shrinkPixels(rctx.getImageData(0, 0, sw, sh).data, sw, sh, w, h)
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    c.getContext('2d')!.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0)
    if (!copies.has(photo)) copies.set(photo, new Map())
    copies.get(photo)!.set(key, c)
    return c
  } catch {
    return null // unreadable: the piece draws as it always has
  }
}

/**
 * Run `draw` (the bake's toDataURL) with every shrunk photo swapped for its properly shrunk copy,
 * then put everything back exactly as it was, cache and click area included.
 */
export function bakeWithShrunkPhotos<T>(images: Konva.Image[], pixelRatio: number, draw: () => T): T {
  const undo: Array<() => void> = []
  try {
    for (const n of images) {
      const photo = n.image() as Photo | undefined
      if (!photo || !(photo instanceof HTMLImageElement || photo instanceof HTMLCanvasElement) || n.crop()?.width) continue
      const sw = photo instanceof HTMLImageElement ? photo.naturalWidth : photo.width
      const sh = photo instanceof HTMLImageElement ? photo.naturalHeight : photo.height
      const boxW = n.width(), boxH = n.height()
      const s = n.getAbsoluteScale()
      const w = Math.min(sw, Math.round(boxW * Math.abs(s.x) * pixelRatio))
      const h = Math.min(sh, Math.round(boxH * Math.abs(s.y) * pixelRatio))
      if (!(sw > 0 && sh > 0 && w > 0 && h > 0) || (w === sw && h === sh)) continue
      const copy = shrunkCopy(photo, sw, sh, w, h)
      if (!copy) continue
      const prevW = n.getAttr('width'), prevH = n.getAttr('height')
      const cached = n.isCached()
      if (cached) n.clearCache()
      n.setAttrs({ image: copy, width: boxW, height: boxH })
      undo.push(() => {
        n.setAttrs({ image: photo, width: prevW, height: prevH })
        if (cached) { try { n.cache(); n.drawHitFromCache() } catch { /* not laid out; harmless */ } }
      })
    }
    return draw()
  } finally {
    undo.reverse().forEach((u) => u())
  }
}
