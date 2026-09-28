import { useCanvasStore } from '@/stores/canvasStore'
import { resolveClosetImageUrls } from '@/lib/resolveClosetImageUrls'
import { addLooksToBoard, CAPSULE_BOARD, type LookToAdd, type Size, type AddLooksResult } from '@/lib/capsuleLayout'
import type { LookCanvasState, CanvasNode } from '@/types/canvas'

/**
 * Add looks to the capsule on the board. ADR-0152; the layout itself is lib/capsuleLayout.ts.
 *
 * If the board is already a capsule (being edited, rebuilt, or put together), the looks go into
 * its next free places. If it is not (a look she opened, or loose pieces), the board BECOMES a new
 * capsule: a Landscape board with what was on it as the first look and the new ones after it.
 * Either way nothing she had is thrown away, which is the whole point: the old click threw it away.
 */

/** Natural size of each photo, so a look is scaled by what is on it, not by a guess. */
async function measure(urls: Record<string, string>): Promise<Record<string, Size>> {
  const out: Record<string, Size> = {}
  await Promise.all(Object.entries(urls).map(([id, url]) => new Promise<void>((done) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const timer = setTimeout(done, 5000) // a slow photo falls back to the estimate, never blocks
    img.onload = () => { clearTimeout(timer); if (img.naturalHeight > 0) out[id] = { w: img.naturalWidth, h: img.naturalHeight }; done() }
    img.onerror = () => { clearTimeout(timer); done() }
    img.src = url
  })))
  return out
}

export function isCapsuleBoard(s: { currentCapsuleId: string | null; replacesCapsuleId: string | null; buildingCapsule: boolean }): boolean {
  return !!(s.currentCapsuleId || s.replacesCapsuleId || s.buildingCapsule)
}

let seq = 0
const newId = (i: number) => `cl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${seq++}_${i}`

export async function addLooksToCapsuleBoard(looks: { id: string; canvas_state: LookCanvasState | null }[]): Promise<AddLooksResult> {
  const st = useCanvasStore.getState()
  const onCapsule = isCapsuleBoard(st)
  const toAdd: LookToAdd[] = []

  let base: LookCanvasState
  let baseUrls: Record<string, string>
  let baseDims: (n: CanvasNode) => Size | null | undefined
  if (onCapsule) {
    base = st.state
    baseUrls = st.imageUrls
    baseDims = (n) => st.nodeDims[n.id]
  } else {
    base = { version: 1, canvas: { ...CAPSULE_BOARD, background: st.state.canvas.background }, nodes: [] }
    baseUrls = {}
    baseDims = () => null
    // What was on the board becomes the capsule's first look, measured from the canvas itself.
    if (st.state.nodes.length > 0) {
      toAdd.push({ lookId: st.currentLookId ?? null, state: st.state, imageUrls: st.imageUrls, dims: st.nodeDims })
    }
  }

  for (const look of looks) {
    if (!look.canvas_state) continue
    const imageUrls = await resolveClosetImageUrls(look.canvas_state)
    toAdd.push({ lookId: look.id, state: look.canvas_state, imageUrls, dims: await measure(imageUrls) })
  }

  const result = addLooksToBoard(base, baseUrls, baseDims, toAdd, newId)
  // Re-read: the board must not have changed under the awaits above, or we would drop her edit.
  if (useCanvasStore.getState().state !== st.state) {
    throw new Error('The board changed while the looks were loading. Try adding them again.')
  }
  useCanvasStore.getState().applyCapsuleBoard(result.state, result.imageUrls, !onCapsule)
  return result
}
