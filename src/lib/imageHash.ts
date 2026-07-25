// Perceptual image hashing (dHash) for the Audit's "deep match" — comparing a client's
// Google-Drive folder to their collection by the ACTUAL PIXELS, so renamed + HEIC→JPEG-
// transcoded + downscaled copies still match. dHash is robust to scale/format/light JPEG
// artifacts; two visually-identical images hash within a few bits of each other.
//
// Canvas pixel reads require a non-tainted image: R2 images come through the image-proxy
// (Access-Control-Allow-Origin: *) and Drive thumbnails / blob URLs load clean. If a source
// IS tainted (CORS) or can't decode (e.g. a raw HEIC the browser won't draw), we return null
// → the caller buckets it as "couldn't compare", never a false "missing".

const W = 9, H = 8 // 9×8 grayscale → 8×8 = 64 comparison bits

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    let settled = false
    const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok ? img : null) } }
    img.onload = () => done(!!img.naturalWidth)
    img.onerror = () => done(false)
    img.src = url
    setTimeout(() => done(img.complete && !!img.naturalWidth), 20000)
  })
}

export async function dHashFromUrl(url: string): Promise<bigint | null> {
  const img = await loadImage(url)
  if (!img || !img.naturalWidth) return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, W, H)
    const data = ctx.getImageData(0, 0, W, H).data // throws if the canvas is tainted (CORS)
    const gray = new Float64Array(W * H)
    for (let i = 0; i < W * H; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    let hash = 0n, bit = 0n
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W - 1; x++) {
        if (gray[y * W + x] > gray[y * W + x + 1]) hash |= (1n << bit)
        bit++
      }
    }
    return hash
  } catch {
    return null // tainted canvas → couldn't read pixels
  }
}

export async function dHashFromBlobUrl(blobUrl: string): Promise<bigint | null> {
  // Blob/object URLs are same-origin → never tainted. Used for Drive downloads.
  return dHashFromUrl(blobUrl)
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b, c = 0
  while (x > 0n) { c += Number(x & 1n); x >>= 1n }
  return c
}

/** A Drive image matches the collection if its hash is within `threshold` bits of ANY
 *  collection hash. ≤10/64 reliably means "same photo" across transcode/downscale. */
export function matchesAny(hash: bigint, set: bigint[], threshold = 10): boolean {
  for (const h of set) if (hamming(hash, h) <= threshold) return true
  return false
}

/** Run async work over items with bounded concurrency, reporting progress. */
export async function pool<T>(items: T[], limit: number, worker: (item: T, i: number) => Promise<void>, onTick?: () => void): Promise<void> {
  let i = 0
  const run = async () => {
    while (i < items.length) {
      const idx = i++
      await worker(items[idx], idx)
      onTick?.()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
}
