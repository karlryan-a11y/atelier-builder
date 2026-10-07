import { proxyImageUrl } from '@/lib/images'

/**
 * THE ONE WAY A PICTURE GETS ONTO A BOARD. Used by the on-screen board (hooks/useCanvasImages)
 * and the headless renderer (render/composite.ts). ADR-0168.
 *
 * A picture on a Konva board MUST load with CORS. One picture without it "taints" the canvas, and
 * a tainted canvas cannot be read: Konva's hit detection throws SecurityError on every pointer
 * event (nothing can be selected or moved) and toDataURL returns "" (the look saves with no
 * picture). Cynthia Dada, 2026-10-07, Holly McClellan: "it gets stuck where I can't move anything
 * and it won't save." Reproduced on the live builder: a Kendra Scott pendant whose photo was on an
 * outside host.
 *
 * Both loaders used to fall back to loading the picture WITHOUT CORS ("tainted but visible").
 * That fallback is what froze the board, so it is gone. Instead:
 *   1. load through the proxy with crossOrigin (as before);
 *   2. on failure, retry ONCE with a cache-busting parameter. Chrome reuses a plain copy of the
 *      same URL that the rail already showed, and that copy carries no CORS header; a fresh URL
 *      skips it. This is exactly the failure on 10/7;
 *   3. if that fails too, reject. The caller shows a placeholder and Save refuses to run, so a
 *      stylist is told which piece to fix instead of being stuck.
 */
export function loadBoardImage(url: string): Promise<HTMLImageElement> {
  const first = proxyImageUrl(url)
  return loadCors(first).catch(() => loadCors(cacheBust(first)))
}

function loadCors(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`picture could not be loaded safely: ${src}`))
    img.src = src
  })
}

export function cacheBust(src: string): string {
  return src + (src.includes('?') ? '&' : '?') + '_cors=' + Date.now().toString(36)
}

/**
 * A stand-in drawn on a same-origin canvas (it can never taint) for a piece whose photo could not
 * be loaded safely. It says what to do in the stylist's words. Konva draws a canvas like an image.
 */
export function unusablePhotoPlaceholder(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 300
  c.height = 400
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#F5F1EA'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.strokeStyle = '#B7AC9B'
  ctx.setLineDash([8, 6])
  ctx.lineWidth = 2
  ctx.strokeRect(6, 6, c.width - 12, c.height - 12)
  ctx.fillStyle = '#6B5E4E'
  ctx.textAlign = 'center'
  ctx.font = '600 20px sans-serif'
  ctx.fillText('Photo unavailable', c.width / 2, 175)
  ctx.font = '16px sans-serif'
  ctx.fillText('Replace it in Edit item,', c.width / 2, 210)
  ctx.fillText('or remove it from the look', c.width / 2, 234)
  return c
}
