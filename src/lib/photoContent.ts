import { proxyImageUrl } from '@/lib/images'
import { cacheBust } from '@/lib/loadBoardImage'
import type { PhotoSize } from '@/lib/goodpixLayout'

/**
 * A piece's photo as the board will draw it: its natural size, and the box its visible (opaque)
 * part fills. Used to fit a GoodPix piece into its box (lib/goodpixLayout.ts fitPiecesToPhotos).
 *
 * Read from its OWN fetched copy, never an <img> the board's way (lib/loadBoardImage). The tester
 * on the preview, 2026-10-26, Danielle York Look 24: when the measuring loaded each photo the
 * board's way first, a piece that did not move still drew grainy where live draws it clean. The
 * board must load and draw every photo exactly as it always has; the measuring only warms the
 * browser's download cache. Same address as the board (the proxy), with the same one retry.
 *
 * Never throws: a photo that cannot be loaded or read in time answers null, and the piece opens
 * the way it did before.
 */
export async function measurePhoto(url: string, timeoutMs = 6000): Promise<PhotoSize | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const first = proxyImageUrl(url)
    const bmp = await Promise.race([
      decode(first).catch(() => decode(cacheBust(first))),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs) }),
    ])
    if (!bmp) return null
    try {
      if (!(bmp.width > 0) || !(bmp.height > 0)) return null
      return { width: bmp.width, height: bmp.height, content: visibleBox(bmp) }
    } finally {
      bmp.close()
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Credentials as the board's own <img crossOrigin="anonymous"> sends them: cookies to our own
// address only. With none at all, a branch preview's sign-in wall answered every photo with a
// redirect loop, nothing was measured and every piece opened the old way (the tester, 2026-10-26,
// Chris Cadieux Looks 11 and 24: ERR_TOO_MANY_REDIRECTS).
async function decode(src: string): Promise<ImageBitmap> {
  const res = await fetch(src, { mode: 'cors', credentials: 'same-origin' })
  if (!res.ok) throw new Error(`photo could not be fetched: ${res.status}`)
  return createImageBitmap(await res.blob())
}

/** The box around every pixel that is not see-through, in the photo's own pixels. */
function visibleBox(bmp: ImageBitmap): PhotoSize['content'] {
  try {
    const NW = bmp.width, NH = bmp.height
    const s = Math.min(1, 256 / Math.max(NW, NH))   // a downscaled copy is plenty to find the edges
    const w = Math.max(1, Math.round(NW * s)), h = Math.max(1, Math.round(NH * s))
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bmp, 0, 0, w, h)
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
