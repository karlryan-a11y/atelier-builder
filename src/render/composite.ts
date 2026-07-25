// Headless-renderer draw path — the SAME Konva drawing code the on-screen builder uses
// (see LookCanvas.tsx), factored so an invisible browser on the renderer box can bake a
// look / board-capsule hero PNG that comes out pixel-identical to a stylist Save.
//
// It is deliberately imperative (plain `konva`, no react-konva / zustand) so it can run on a
// bare render page with no app state. The math MUST stay in lockstep with LookCanvas:
//   • effectiveScale = clamp(target_height / image.naturalHeight)   (LookCanvas.tsx:91-94)
//   • toKonvaConfig()                                               (CanvasAdapter.ts)
//   • toDataURL({ x:0, y:0, width, height, pixelRatio, mimeType })  (LookCanvas.tsx:325-332)
//   • JPEG thumbnail flattened onto white                           (ChatPanel.tsx:78-88)
import Konva from 'konva'
import type { LookCanvasState, ClosetItemNode, TextNode } from '@/types/canvas'
import { toKonvaConfig } from '@/components/canvas/CanvasAdapter'
import { proxyImageUrl } from '@/lib/images'

// Match useCanvasImages: proxy + crossOrigin so toDataURL stays untainted; on failure fall
// back to a direct load (may taint, but a visible item beats a blank one).
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => {
      const fb = new window.Image()
      fb.onload = () => resolve(fb)
      fb.onerror = () => reject(new Error(`image load failed: ${url}`))
      fb.src = url
    }
    img.src = proxyImageUrl(url)
  })
}

// The same families LookCanvas waits on before Konva measures/draws text, so composed brand
// labels ("Amalfi Coast" et al.) bake with the real font instead of a fallback.
const FONT_FAMILIES = ["'Amalfi Coast'", "'Playfair Display SC'", "'Playfair Display'", "'Great Vibes'", "'Neue Haas'", "'Schnyder'"]

async function waitForFonts(): Promise<void> {
  const docFonts = (document as Document & { fonts?: FontFaceSet }).fonts
  if (!docFonts) return
  try {
    await Promise.all(FONT_FAMILIES.map((f) => docFonts.load(`32px ${f}`).catch(() => undefined)))
    await docFonts.ready
  } catch { /* fonts are best-effort */ }
}

// Flatten the PNG onto white and encode a JPEG — the gallery thumbnail + capsule-grid source.
// Returns a full `data:image/jpeg;base64,…` URL (gp_looks.thumbnail_url stores it verbatim).
function toJpegThumbnail(pngDataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, img.width, img.height)
      ctx.drawImage(img, 0, 0)
      resolve(c.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => resolve('')
    img.src = pngDataUrl
  })
}

export interface CompositeResult {
  /** High-res board PNG, base64 with NO `data:` prefix (ready for upload-image). */
  pngBase64: string
  /** `data:image/jpeg;base64,…` thumbnail (stored as gp_looks.thumbnail_url). */
  thumbnailDataUrl: string
}

/**
 * Bake a look / board-capsule hero from its saved canvas_state and a node-id → image-URL map
 * (resolve the map exactly like ChatPanel.resolveLookImageUrls before calling this).
 */
export async function renderCanvasComposite(
  canvasState: LookCanvasState,
  imageUrls: Record<string, string>,
  opts?: { pixelRatio?: number },
): Promise<CompositeResult> {
  const pixelRatio = opts?.pixelRatio ?? 2
  const BW = canvasState.canvas.width
  const BH = canvasState.canvas.height

  // Offscreen container — the stage never touches the visible viewport.
  const container = document.createElement('div')
  container.style.position = 'absolute'
  container.style.left = '-100000px'
  container.style.top = '0'
  document.body.appendChild(container)

  const stage = new Konva.Stage({ container, width: BW, height: BH })
  const layer = new Konva.Layer()
  stage.add(layer)

  // The board IS the export area — fill it with the background (LookCanvas.tsx:738-745).
  layer.add(new Konva.Rect({ x: 0, y: 0, width: BW, height: BH, fill: canvasState.canvas.background, listening: false }))

  const sorted = [...canvasState.nodes].sort((a, b) => a.z_index - b.z_index)

  // Preload every closet-item image up front so naturalHeight (→ scale) is known at draw time.
  const loaded = new Map<string, HTMLImageElement>()
  await Promise.all(
    sorted
      .filter((n): n is ClosetItemNode => n.type === 'closet_item')
      .map(async (n) => {
        const url = imageUrls[n.id]
        if (!url) return
        try { loaded.set(n.id, await loadImage(url)) } catch { /* skip an item we can't fetch */ }
      }),
  )

  await waitForFonts()

  for (const node of sorted) {
    if (node.type === 'closet_item') {
      const image = loaded.get(node.id)
      if (!image) continue
      // compose sets target_height; the render layer computes the exact on-canvas scale.
      let effectiveScale = node.scale
      if (node.target_height && image.naturalHeight > 0) {
        effectiveScale = Math.min(Math.max(node.target_height / image.naturalHeight, 0.03), 3.0)
      }
      const config = toKonvaConfig({ ...node, scale: effectiveScale })
      layer.add(new Konva.Image({
        image,
        x: config.x,
        y: config.y,
        scaleX: config.scaleX,
        scaleY: config.scaleY,
        rotation: config.rotation,
      }))
    } else if (node.type === 'text') {
      const t = node as TextNode
      layer.add(new Konva.Text({
        text: t.content,
        x: t.x,
        y: t.y,
        fontFamily: t.font_family,
        fontSize: t.font_size,
        fontStyle: t.bold ? 'bold' : 'normal',
        textDecoration: t.underline ? 'underline' : '',
        align: t.align ?? 'left',
        ...(t.width ? { width: t.width } : {}),
        fill: t.fill,
        rotation: t.rotation,
      }))
    }
  }

  layer.draw()

  try {
    const pngDataUrl = stage.toDataURL({ x: 0, y: 0, width: BW, height: BH, pixelRatio, mimeType: 'image/png' })
    const thumbnailDataUrl = await toJpegThumbnail(pngDataUrl)
    return {
      pngBase64: pngDataUrl.replace(/^data:image\/png;base64,/, ''),
      thumbnailDataUrl,
    }
  } finally {
    stage.destroy()
    container.remove()
  }
}
