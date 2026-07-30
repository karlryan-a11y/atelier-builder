// Capsule-grid composite — the St. Moritz style hero for look-composed capsules (a grid of the
// member looks' thumbnails, italic serif titles, seamless white background). Extracted verbatim
// from CreateCapsuleDialog so the in-browser "Create capsule" flow AND the headless renderer box
// bake the exact same image — one implementation, no drift when a member look's photo changes.

/**
 * Load an image from a URL or data URL. For data: URLs, no CORS needed.
 * For http URLs, tries with crossOrigin first, falls back without.
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    // Data URLs don't need CORS; only set for http URLs
    if (!src.startsWith('data:')) {
      img.crossOrigin = 'anonymous'
    }
    img.onload = () => resolve(img)
    img.onerror = () => {
      // Retry without crossOrigin (tainted canvas, but we can still draw)
      if (!src.startsWith('data:') && img.crossOrigin) {
        const retry = new window.Image()
        retry.onload = () => resolve(retry)
        retry.onerror = () => reject(new Error(`Failed to load image`))
        retry.src = src
      } else {
        reject(new Error(`Failed to load image`))
      }
    }
    img.src = src
  })
}

/**
 * Auto-crop an image to its content bounds (removes surrounding white space).
 * Returns a new canvas with just the content + small padding.
 */
function autoCropImage(img: HTMLImageElement): HTMLCanvasElement {
  const PADDING = 15
  const WHITE = 200 // Conservative: only crop truly white areas, preserve light-colored items

  // Draw onto temp canvas to read pixels
  const tmp = document.createElement('canvas')
  tmp.width = img.width
  tmp.height = img.height
  const tCtx = tmp.getContext('2d')!
  tCtx.fillStyle = '#FFFFFF'
  tCtx.fillRect(0, 0, tmp.width, tmp.height)
  tCtx.drawImage(img, 0, 0)

  const data = tCtx.getImageData(0, 0, tmp.width, tmp.height).data
  let top = tmp.height, bot = 0, left = tmp.width, right = 0

  for (let y = 0; y < tmp.height; y++) {
    for (let x = 0; x < tmp.width; x++) {
      const i = (y * tmp.width + x) * 4
      if (data[i + 3] > 10 && (data[i] < WHITE || data[i + 1] < WHITE || data[i + 2] < WHITE)) {
        if (y < top) top = y
        if (y > bot) bot = y
        if (x < left) left = x
        if (x > right) right = x
      }
    }
  }

  if (top >= bot || left >= right) return tmp // no content, return as-is

  const sx = Math.max(0, left - PADDING)
  const sy = Math.max(0, top - PADDING)
  const sw = Math.min(tmp.width, right + PADDING) - sx
  const sh = Math.min(tmp.height, bot + PADDING) - sy

  const cropped = document.createElement('canvas')
  cropped.width = sw
  cropped.height = sh
  const cCtx = cropped.getContext('2d')!
  cCtx.fillStyle = '#FFFFFF'
  cCtx.fillRect(0, 0, sw, sh)
  cCtx.drawImage(tmp, sx, sy, sw, sh, 0, 0, sw, sh)
  return cropped
}

export interface CapsuleGridLook {
  name: string
  imageUrl: string | null
  thumbnailUrl: string | null
}

/**
 * Render a seamless capsule composite matching the St. Moritz style:
 * - No cell borders or backgrounds
 * - White background, looks fill the space
 * - Italic serif titles above each look
 * - Tight column layout, no wasted space
 *
 * Returns PNG base64 with NO `data:` prefix (ready for upload-image).
 */
export async function renderCapsuleGrid(
  selectedLooks: CapsuleGridLook[],
): Promise<string> {
  const count = selectedLooks.length
  const COLS = count === 1 ? 1 : count === 2 ? 2 : count <= 4 ? 2 : 3
  const ROWS = Math.ceil(count / COLS)
  const TOTAL_W = 1400
  const GAP = 10
  const MARGIN = 10
  const TITLE_H = 30
  const COL_W = Math.floor((TOTAL_W - MARGIN * 2 - (COLS - 1) * GAP) / COLS)

  // Load and auto-crop all images
  const loaded: Array<{ cropped: HTMLCanvasElement | null; name: string }> = []
  for (const look of selectedLooks) {
    const src = look.imageUrl || look.thumbnailUrl
    if (src) {
      try {
        const img = await loadImage(src)
        loaded.push({ cropped: autoCropImage(img), name: look.name })
      } catch {
        loaded.push({ cropped: null, name: look.name })
      }
    } else {
      loaded.push({ cropped: null, name: look.name })
    }
  }

  // Cell heights from cropped image aspect ratios
  const cellHeights = loaded.map(({ cropped }) => {
    if (!cropped) return 500
    const scale = COL_W / cropped.width
    return cropped.height * scale + TITLE_H
  })

  const rowHeights: number[] = []
  for (let r = 0; r < ROWS; r++) {
    let maxH = 0
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c
      if (idx < cellHeights.length) maxH = Math.max(maxH, cellHeights[idx])
    }
    rowHeights.push(maxH)
  }

  const CANVAS_W = MARGIN * 2 + COLS * COL_W + (COLS - 1) * GAP
  const CANVAS_H = MARGIN * 2 + rowHeights.reduce((a, b) => a + b, 0) + (ROWS - 1) * GAP

  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

  let yOffset = MARGIN
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c
      if (idx >= loaded.length) break

      const { cropped, name } = loaded[idx]
      const x = MARGIN + c * (COL_W + GAP)
      const y = yOffset

      // Title — italic serif
      ctx.fillStyle = '#1A1A1A'
      ctx.font = 'italic 20px Georgia, "Times New Roman", serif'
      ctx.textAlign = 'center'
      ctx.fillText(name, x + COL_W / 2, y + 22, COL_W - 8)

      // Cropped image — scales to fill column width
      if (cropped) {
        const scale = COL_W / cropped.width
        const drawW = COL_W
        const drawH = cropped.height * scale
        ctx.drawImage(cropped, x, y + TITLE_H, drawW, drawH)
      }
    }
    yOffset += rowHeights[r] + GAP
  }

  return canvas.toDataURL('image/png', 1.0).replace(/^data:image\/png;base64,/, '')
}
