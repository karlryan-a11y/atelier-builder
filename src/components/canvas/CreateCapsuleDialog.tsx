import { useState, useCallback } from 'react'
import { X, Check, Package, Loader2 } from 'lucide-react'
import type { LookRow } from '@/hooks/useLooks'

interface CreateCapsuleDialogProps {
  looks: LookRow[]
  saving: boolean
  onSave: (data: { name: string; description: string; lookIds: string[]; compositeBase64: string }) => void
  onClose: () => void
}

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
 * Render a seamless capsule composite matching the St. Moritz style:
 * - No cell borders or backgrounds
 * - White background, looks fill the space
 * - Italic serif titles above each look
 * - Tight column layout, no wasted space
 */
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

async function renderCapsuleGrid(
  selectedLooks: Array<{ name: string; imageUrl: string | null; thumbnailUrl: string | null }>,
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

export function CreateCapsuleDialog({ looks, saving, onSave, onClose }: CreateCapsuleDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedLookIds, setSelectedLookIds] = useState<Set<string>>(new Set())
  const [rendering, setRendering] = useState(false)

  const toggleLook = (id: string) => {
    setSelectedLookIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSave = useCallback(async () => {
    if (!name.trim() || selectedLookIds.size === 0) return
    setRendering(true)

    try {
      // Gather look data with image URLs
      const selectedLooks = looks.filter(l => selectedLookIds.has(l.id))

      // Use thumbnails directly (they're base64 data URLs, no CORS issues)
      // Thumbnails are already rendered from the canvas with brand labels included
      const lookData = selectedLooks.map((look) => ({
        name: look.name,
        imageUrl: look.thumbnail_url, // base64 data URL — always available, no CORS
        thumbnailUrl: look.thumbnail_url,
      }))

      // Render the composite grid image
      const compositeBase64 = await renderCapsuleGrid(lookData)

      onSave({
        name: name.trim(),
        description: description.trim(),
        lookIds: Array.from(selectedLookIds),
        compositeBase64,
      })
    } catch (err) {
      console.error('Failed to render capsule:', err)
      // Save without composite image
      onSave({
        name: name.trim(),
        description: description.trim(),
        lookIds: Array.from(selectedLookIds),
        compositeBase64: '',
      })
    } finally {
      setRendering(false)
    }
  }, [name, description, selectedLookIds, looks, onSave])

  const isSaving = saving || rendering

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-sm shadow-xl w-[520px] max-h-[80vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E4DF]">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-blush" />
            <h2 className="text-sm font-medium tracking-[0.1em] uppercase text-[#1A1A1A]">Create Capsule</h2>
          </div>
          <button onClick={onClose} className="text-[#888] hover:text-[#1A1A1A]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-[9px] tracking-[0.15em] uppercase text-[#888] mb-1">Capsule Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Nashville Trip, Fall Work Rotation"
              className="w-full border border-[#E8E4DF] rounded-sm px-3 py-2 text-sm text-[#1A1A1A] focus:border-[#888] focus:outline-none"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[9px] tracking-[0.15em] uppercase text-[#888] mb-1">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Notes for the client..."
              className="w-full border border-[#E8E4DF] rounded-sm px-3 py-2 text-sm text-[#1A1A1A] focus:border-[#888] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[9px] tracking-[0.15em] uppercase text-[#888] mb-2">
              Select Looks ({selectedLookIds.size} selected)
            </label>
            {looks.length === 0 ? (
              <p className="text-sm text-[#888] py-4 text-center">No saved looks yet. Save some looks first.</p>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {looks.map(look => (
                  <button
                    key={look.id}
                    onClick={() => toggleLook(look.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-sm border transition-colors text-left ${
                      selectedLookIds.has(look.id)
                        ? 'border-[#1A1A1A] bg-[#F8F7F5]'
                        : 'border-[#E8E4DF] hover:border-[#ccc]'
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="w-12 h-12 rounded-sm bg-[#F8F7F5] overflow-hidden shrink-0">
                      {look.thumbnail_url ? (
                        <img src={look.thumbnail_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[8px] text-[#ccc]">—</div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#1A1A1A] font-medium truncate">{look.name}</p>
                      <p className="text-[10px] text-[#888]">
                        {look.tags?.join(', ') || 'No tags'}
                      </p>
                    </div>

                    {/* Checkbox */}
                    <div className={`w-5 h-5 rounded-sm border flex items-center justify-center shrink-0 ${
                      selectedLookIds.has(look.id)
                        ? 'bg-[#1A1A1A] border-[#1A1A1A]'
                        : 'border-[#ccc]'
                    }`}>
                      {selectedLookIds.has(look.id) && (
                        <Check className="h-3 w-3 text-white" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[#E8E4DF] flex gap-3">
          <button
            onClick={handleSave}
            disabled={isSaving || !name.trim() || selectedLookIds.size === 0}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#1A1A1A] text-white text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#333] disabled:opacity-40 transition-colors"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {rendering ? 'Rendering capsule...' : 'Saving...'}
              </>
            ) : (
              <>
                <Package className="h-3.5 w-3.5" />
                Create Capsule ({selectedLookIds.size} looks)
              </>
            )}
          </button>
          <button
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2.5 border border-[#E8E4DF] text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#F8F7F5] disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
