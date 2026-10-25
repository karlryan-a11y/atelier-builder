import { loadBoardImage } from '@/lib/loadBoardImage'
import type { PhotoSize } from '@/lib/goodpixLayout'

/**
 * A piece's photo as the board will draw it: its natural size, and the box its visible (opaque)
 * part fills. Loaded the one way a board loads a picture (lib/loadBoardImage), so the browser hands
 * the board the same copy a moment later. Used to fit a GoodPix piece into its box
 * (lib/goodpixLayout.ts fitPiecesToPhotos).
 *
 * Never throws: a photo that cannot be loaded or read in time answers null, and the piece opens
 * the way it did before.
 */
export async function measurePhoto(url: string, timeoutMs = 6000): Promise<PhotoSize | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const img = await Promise.race([
      loadBoardImage(url),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs) }),
    ])
    if (!img || !(img.naturalWidth > 0) || !(img.naturalHeight > 0)) return null
    return { width: img.naturalWidth, height: img.naturalHeight, content: visibleBox(img) }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** The box around every pixel that is not see-through, in the photo's own pixels. */
function visibleBox(img: HTMLImageElement): PhotoSize['content'] {
  try {
    const NW = img.naturalWidth, NH = img.naturalHeight
    const s = Math.min(1, 256 / Math.max(NW, NH))   // a downscaled copy is plenty to find the edges
    const w = Math.max(1, Math.round(NW * s)), h = Math.max(1, Math.round(NH * s))
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(img, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data
    let minX = w, minY = h, maxX = -1, maxY = -1
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
    }
    if (maxX < minX || maxY < minY) return null
    return { x: minX / s, y: minY / s, width: (maxX - minX + 1) / s, height: (maxY - minY + 1) / s }
  } catch {
    return null   // unreadable: fit the whole photo
  }
}
