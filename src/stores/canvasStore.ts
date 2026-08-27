import { create } from 'zustand'
import type { LookCanvasState, CanvasNode, ClosetItemNode } from '@/types/canvas'
import { createDefaultLookCanvas } from '@/types/canvas'

const MAX_HISTORY = 50
const AUTOSAVE_KEY = 'atelier-canvas-draft'
const IMAGE_URLS_KEY = 'atelier-canvas-image-urls'

function loadDraft(): LookCanvasState | null {
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return null
}

function saveDraft(state: LookCanvasState) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state))
  } catch {}
}

function loadImageUrls(): Record<string, string> {
  try {
    const saved = localStorage.getItem(IMAGE_URLS_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return {}
}

function saveImageUrls(urls: Record<string, string>) {
  try {
    localStorage.setItem(IMAGE_URLS_KEY, JSON.stringify(urls))
  } catch {}
}

interface CanvasStoreState {
  state: LookCanvasState
  selectedNodeIds: string[]
  imageUrls: Record<string, string>
  // Natural pixel dimensions per node (reported by the canvas once each image loads). Used to
  // flip a piece IN PLACE — transient, not persisted, not in undo history.
  nodeDims: Record<string, { w: number; h: number }>
  past: LookCanvasState[]
  future: LookCanvasState[]
  currentLookId: string | null
  // Set when a saved capsule (gp_boards row with raw.canvas_state) is loaded onto the canvas
  // for editing via Categorize → Capsules → Edit. Mutually exclusive with currentLookId — loading
  // a look, duplicating, or starting a new look all clear this. Lets ChatPanel's "Save as Capsule"
  // flow know to UPDATE this same gp_boards row instead of inserting a new capsule.
  currentCapsuleId: string | null
  isDirty: boolean
  // When a text node is added, we ask the canvas to open its inline editor immediately so the
  // stylist can just start typing (GoodPix-style). Transient UI hint, not persisted.
  pendingEditTextId: string | null
  // Remembers the last font + size the stylist used on a text node, so the NEXT text they add
  // reuses it (fast when labelling many items). Transient, session-only.
  lastTextStyle: { font_family: string; font_size: number } | null
}

// Export function registered by LookCanvas, called by ChatPanel
type ExportCanvasFn = (opts?: { pixelRatio?: number; padding?: number }) => string | null

let _registeredExportFn: ExportCanvasFn | null = null

// In-memory copy/paste clipboard (not persisted — lives for the session). Holds
// detached snapshots so paste still works after the originals are deleted.
let _clipboard: { nodes: CanvasNode[]; urls: Record<string, string> } | null = null

/** Called by LookCanvas on mount to register its export function */
export function registerCanvasExport(fn: ExportCanvasFn) {
  _registeredExportFn = fn
}

/** Called by LookCanvas on unmount */
export function unregisterCanvasExport() {
  _registeredExportFn = null
}

// Settle function registered by LookCanvas, called before anything reads the state or
// photographs the board. See settleCanvasTransforms below.
type SettleCanvasFn = () => void

let _registeredSettleFn: SettleCanvasFn | null = null

/** Called by LookCanvas on mount to register its settle sweep */
export function registerCanvasSettle(fn: SettleCanvasFn) {
  _registeredSettleFn = fn
}

/** Called by LookCanvas on unmount */
export function unregisterCanvasSettle() {
  _registeredSettleFn = null
}

/**
 * Copy whatever is actually on the board into the saved state.
 *
 * The saved state and the exported picture come from two different places: the picture is a
 * photograph of the Konva stage, the state is what we write to the database. A handler that
 * forgets to persist part of a transform leaves the two out of step SILENTLY — the export looks
 * right because it photographs the stage, and the file underneath is already wrong. It only
 * surfaces when the look is reopened days later. (The text rotate handle did exactly this: it
 * saved the box width and dropped the angle, so every rotated label came back flat.)
 *
 * So call this FIRST in any save path, before reading `state` and before exporting. Anything a
 * handler missed gets picked up here, including handlers nobody has written yet.
 *
 * Synchronous: the store is updated by the time this returns, so `getState().state` immediately
 * afterwards is settled (React will not have re-rendered yet, which does not matter).
 */
export function settleCanvasTransforms(): void {
  _registeredSettleFn?.()
}

/**
 * Export the canvas to a data URL using Konva's native API.
 * Automatically crops to content bounds with padding.
 * Returns null if no canvas is registered.
 */
export function exportCanvasImage(opts?: { pixelRatio?: number; padding?: number }): string | null {
  return _registeredExportFn ? _registeredExportFn(opts) : null
}

interface CanvasStoreActions {
  setCanvasState: (state: LookCanvasState) => void
  addNode: (node: CanvasNode, imageUrl?: string) => void
  updateNode: (id: string, updates: Partial<CanvasNode>) => void
  updateNodes: (patches: { id: string; updates: Partial<CanvasNode> }[]) => void
  removeNode: (id: string) => void
  removeNodes: (ids: string[]) => void
  setSelectedNodeIds: (ids: string[]) => void
  toggleNodeSelection: (id: string) => void
  duplicateNodes: (ids: string[]) => void
  copyNodes: (ids: string[]) => void
  pasteNodes: () => void
  moveLayer: (ids: string[], direction: 'up' | 'down' | 'top' | 'bottom') => void
  setNodeImageUrl: (id: string, url: string) => void
  setNodeDims: (id: string, w: number, h: number) => void
  flipNodes: (ids: string[]) => void
  alignNodes: (ids: string[], edge: 'left' | 'right' | 'top' | 'bottom' | 'center-h' | 'center-v') => void
  distributeNodes: (ids: string[], axis: 'horizontal' | 'vertical') => void
  undo: () => void
  redo: () => void
  reset: () => void
  loadLook: (id: string, state: LookCanvasState, imageUrls: Record<string, string>) => void
  loadLookAsNew: (state: LookCanvasState, imageUrls: Record<string, string>) => void
  // Load a saved capsule's canvas_state back onto the board for editing (see currentCapsuleId).
  loadCapsule: (id: string, state: LookCanvasState, imageUrls: Record<string, string>) => void
  markClean: () => void
  setBackground: (color: string) => void
  setCanvasSize: (width: number, height: number) => void
  requestTextEdit: (id: string | null) => void
  rememberTextStyle: (style: { font_family: string; font_size: number }) => void
}

type CanvasStore = CanvasStoreState & CanvasStoreActions

function pushHistory(past: LookCanvasState[], current: LookCanvasState): LookCanvasState[] {
  const next = [...past, current]
  if (next.length > MAX_HISTORY) next.shift()
  return next
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  state: loadDraft() ?? createDefaultLookCanvas(),
  selectedNodeIds: [],
  imageUrls: loadImageUrls(),
  nodeDims: {},
  past: [],
  future: [],
  currentLookId: null,
  currentCapsuleId: null,
  isDirty: false,
  pendingEditTextId: null,
  lastTextStyle: null,

  requestTextEdit: (id) => set({ pendingEditTextId: id }),
  rememberTextStyle: (style) => set({ lastTextStyle: style }),

  setCanvasState: (newState) => {
    const { state: current, past } = get()
    set({
      past: pushHistory(past, current),
      future: [],
      state: newState,
      isDirty: true,
    })
    saveDraft(newState)
  },

  setCanvasSize: (width, height) => {
    const { state: current, past } = get()
    const newState = { ...current, canvas: { ...current.canvas, width, height } }
    set({ past: pushHistory(past, current), future: [], state: newState, isDirty: true })
    saveDraft(newState)
  },

  addNode: (node, imageUrl) => {
    const { state: current, past, imageUrls } = get()
    const updated = { ...current, nodes: [...current.nodes, node] }
    const newUrls = imageUrl ? { ...imageUrls, [node.id]: imageUrl } : imageUrls
    set({
      past: pushHistory(past, current),
      future: [],
      state: updated,
      imageUrls: newUrls,
      isDirty: true,
    })
    saveDraft(updated)
    saveImageUrls(newUrls)
  },

  updateNode: (id, updates) => {
    const { state: current, past } = get()
    const updated: LookCanvasState = {
      ...current,
      nodes: current.nodes.map((n) =>
        n.id === id ? ({ ...n, ...updates } as CanvasNode) : n
      ),
    }
    set({
      past: pushHistory(past, current),
      future: [],
      state: updated,
      isDirty: true,
    })
    saveDraft(updated)
  },

  // Patch several nodes in ONE history step (group move / group flip), so undo reverts
  // the whole gesture at once instead of node-by-node.
  updateNodes: (patches) => {
    const { state: current, past } = get()
    const m = new Map(patches.map((p) => [p.id, p.updates]))
    const updated: LookCanvasState = {
      ...current,
      nodes: current.nodes.map((n) => (m.has(n.id) ? ({ ...n, ...m.get(n.id) } as CanvasNode) : n)),
    }
    set({ past: pushHistory(past, current), future: [], state: updated, isDirty: true })
    saveDraft(updated)
  },

  // Swap the image a canvas node renders (e.g. after Remove BG returns a transparent URL).
  // imageUrlMap is derived from imageUrls, so this triggers the image to reload in place.
  setNodeImageUrl: (id, url) => {
    const { imageUrls } = get()
    const newUrls = { ...imageUrls, [id]: url }
    set({ imageUrls: newUrls })
    saveImageUrls(newUrls)
  },

  setNodeDims: (id, w, h) => {
    const { nodeDims } = get()
    const cur = nodeDims[id]
    if (cur && cur.w === w && cur.h === h) return
    set({ nodeDims: { ...nodeDims, [id]: { w, h } } })
  },

  // Flip selected closet items horizontally IN PLACE — mirror without moving. A negative
  // scaleX mirrors around the node's corner (shifting it by its width), so we compensate the
  // x/y by the rendered width along the item's rotation, keeping the visual position fixed.
  flipNodes: (ids) => {
    const { state: current, past, nodeDims } = get()
    const idSet = new Set(ids)
    let touched = false
    const nodes = current.nodes.map((n) => {
      if (n.type !== 'closet_item' || !idSet.has(n.id)) return n
      touched = true
      const cn = n as ClosetItemNode
      const dim = nodeDims[n.id]
      let dx = 0, dy = 0
      if (dim && dim.h > 0) {
        const effScale = cn.target_height ? Math.min(Math.max(cn.target_height / dim.h, 0.03), 3.0) : cn.scale
        const w = dim.w * effScale // rendered width
        const rad = ((cn.rotation || 0) * Math.PI) / 180
        const sign = cn.flipped ? -1 : 1
        dx = sign * w * Math.cos(rad)
        dy = sign * w * Math.sin(rad)
      }
      return { ...cn, flipped: !cn.flipped, x: cn.x + dx, y: cn.y + dy } as CanvasNode
    })
    if (!touched) return
    const updated = { ...current, nodes }
    set({ past: pushHistory(past, current), future: [], state: updated, isDirty: true })
    saveDraft(updated)
  },

  removeNode: (id) => {
    const { state: current, past, imageUrls, selectedNodeIds } = get()
    const updated = { ...current, nodes: current.nodes.filter((n) => n.id !== id) }
    const { [id]: _, ...remainingUrls } = imageUrls
    set({
      past: pushHistory(past, current),
      future: [],
      state: updated,
      selectedNodeIds: selectedNodeIds.filter((i) => i !== id),
      imageUrls: remainingUrls,
      isDirty: true,
    })
    saveDraft(updated)
    saveImageUrls(remainingUrls)
  },

  removeNodes: (ids) => {
    const { state: current, past, imageUrls, selectedNodeIds } = get()
    const idSet = new Set(ids)
    const updated = { ...current, nodes: current.nodes.filter((n) => !idSet.has(n.id)) }
    const remainingUrls = { ...imageUrls }
    for (const id of ids) delete remainingUrls[id]
    set({
      past: pushHistory(past, current),
      future: [],
      state: updated,
      selectedNodeIds: selectedNodeIds.filter((i) => !idSet.has(i)),
      imageUrls: remainingUrls,
      isDirty: true,
    })
    saveDraft(updated)
    saveImageUrls(remainingUrls)
  },

  setSelectedNodeIds: (ids) => set({ selectedNodeIds: ids }),

  toggleNodeSelection: (id) => {
    const { selectedNodeIds } = get()
    if (selectedNodeIds.includes(id)) {
      set({ selectedNodeIds: selectedNodeIds.filter((i) => i !== id) })
    } else {
      set({ selectedNodeIds: [...selectedNodeIds, id] })
    }
  },

  duplicateNodes: (ids) => {
    const { state: current, past, imageUrls } = get()
    const newNodes: CanvasNode[] = []
    const newUrls = { ...imageUrls }
    const newIds: string[] = []

    for (const id of ids) {
      const node = current.nodes.find((n) => n.id === id)
      if (!node) continue
      const newId = `${node.type.slice(0, 2)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const clone = { ...node, id: newId, x: node.x + 30, y: node.y + 30, z_index: current.nodes.length + newNodes.length } as CanvasNode
      newNodes.push(clone)
      newIds.push(newId)
      if (imageUrls[id]) newUrls[newId] = imageUrls[id]
    }

    const updated = { ...current, nodes: [...current.nodes, ...newNodes] }
    set({
      past: pushHistory(past, current),
      future: [],
      state: updated,
      imageUrls: newUrls,
      selectedNodeIds: newIds,
      isDirty: true,
    })
    saveDraft(updated)
    saveImageUrls(newUrls)
  },

  copyNodes: (ids) => {
    const { state: current, imageUrls } = get()
    const nodes = current.nodes.filter((n) => ids.includes(n.id))
    if (nodes.length === 0) { _clipboard = null; return }
    const urls: Record<string, string> = {}
    for (const n of nodes) if (imageUrls[n.id]) urls[n.id] = imageUrls[n.id]
    // Detached deep copy so edits/deletes to the originals don't mutate the clipboard.
    _clipboard = { nodes: JSON.parse(JSON.stringify(nodes)), urls: { ...urls } }
  },

  pasteNodes: () => {
    if (!_clipboard || _clipboard.nodes.length === 0) return
    const { state: current, past, imageUrls } = get()
    const newNodes: CanvasNode[] = []
    const newUrls = { ...imageUrls }
    const newIds: string[] = []

    _clipboard.nodes.forEach((node, idx) => {
      const newId = `${node.type.slice(0, 2)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${idx}`
      const clone = {
        ...node,
        id: newId,
        x: node.x + 30,
        y: node.y + 30,
        z_index: current.nodes.length + newNodes.length,
      } as CanvasNode
      newNodes.push(clone)
      newIds.push(newId)
      if (_clipboard!.urls[node.id]) newUrls[newId] = _clipboard!.urls[node.id]
    })

    const updated = { ...current, nodes: [...current.nodes, ...newNodes] }
    set({
      past: pushHistory(past, current),
      future: [],
      state: updated,
      imageUrls: newUrls,
      selectedNodeIds: newIds,
      isDirty: true,
    })
    saveDraft(updated)
    saveImageUrls(newUrls)
  },

  moveLayer: (ids, direction) => {
    const { state: current, past } = get()
    const sorted = [...current.nodes].sort((a, b) => a.z_index - b.z_index)
    const idSet = new Set(ids)

    let ordered = sorted
    if (direction === 'top' || direction === 'bottom') {
      // To front / to back: move every selected node all the way, keeping their relative order.
      const sel = sorted.filter((n) => idSet.has(n.id))
      const rest = sorted.filter((n) => !idSet.has(n.id))
      ordered = direction === 'top' ? [...rest, ...sel] : [...sel, ...rest]
    } else if (direction === 'up') {
      for (let i = sorted.length - 2; i >= 0; i--) {
        if (idSet.has(sorted[i].id) && !idSet.has(sorted[i + 1].id)) {
          [sorted[i], sorted[i + 1]] = [sorted[i + 1], sorted[i]]
        }
      }
    } else {
      for (let i = 1; i < sorted.length; i++) {
        if (idSet.has(sorted[i].id) && !idSet.has(sorted[i - 1].id)) {
          [sorted[i], sorted[i - 1]] = [sorted[i - 1], sorted[i]]
        }
      }
    }

    const reindexed = ordered.map((n, i) => ({ ...n, z_index: i }) as CanvasNode)
    const updated = { ...current, nodes: reindexed }
    set({
      past: pushHistory(past, current),
      future: [],
      state: updated,
      isDirty: true,
    })
    saveDraft(updated)
  },

  alignNodes: (ids, edge) => {
    const { state: current, past } = get()
    const targets = current.nodes.filter((n) => ids.includes(n.id))
    if (targets.length < 2) return

    const xs = targets.map((n) => n.x)
    const ys = targets.map((n) => n.y)
    let updates: Record<string, Partial<CanvasNode>> = {}

    switch (edge) {
      case 'left': { const min = Math.min(...xs); targets.forEach((n) => { updates[n.id] = { x: min } }); break }
      case 'right': { const max = Math.max(...xs); targets.forEach((n) => { updates[n.id] = { x: max } }); break }
      case 'top': { const min = Math.min(...ys); targets.forEach((n) => { updates[n.id] = { y: min } }); break }
      case 'bottom': { const max = Math.max(...ys); targets.forEach((n) => { updates[n.id] = { y: max } }); break }
      case 'center-h': { const avg = xs.reduce((a, b) => a + b, 0) / xs.length; targets.forEach((n) => { updates[n.id] = { x: avg } }); break }
      case 'center-v': { const avg = ys.reduce((a, b) => a + b, 0) / ys.length; targets.forEach((n) => { updates[n.id] = { y: avg } }); break }
    }

    const updated: LookCanvasState = {
      ...current,
      nodes: current.nodes.map((n) => updates[n.id] ? { ...n, ...updates[n.id] } as CanvasNode : n),
    }
    set({ past: pushHistory(past, current), future: [], state: updated, isDirty: true })
    saveDraft(updated)
  },

  distributeNodes: (ids, axis) => {
    const { state: current, past } = get()
    const targets = current.nodes.filter((n) => ids.includes(n.id))
    if (targets.length < 3) return

    const sorted = [...targets].sort((a, b) => axis === 'horizontal' ? a.x - b.x : a.y - b.y)
    const first = axis === 'horizontal' ? sorted[0].x : sorted[0].y
    const last = axis === 'horizontal' ? sorted[sorted.length - 1].x : sorted[sorted.length - 1].y
    const step = (last - first) / (sorted.length - 1)

    const updates: Record<string, Partial<CanvasNode>> = {}
    sorted.forEach((n, i) => {
      updates[n.id] = axis === 'horizontal' ? { x: first + step * i } : { y: first + step * i }
    })

    const updated: LookCanvasState = {
      ...current,
      nodes: current.nodes.map((n) => updates[n.id] ? { ...n, ...updates[n.id] } as CanvasNode : n),
    }
    set({ past: pushHistory(past, current), future: [], state: updated, isDirty: true })
    saveDraft(updated)
  },

  undo: () => {
    const { past, state: current, future } = get()
    if (past.length === 0) return
    const previous = past[past.length - 1]
    set({
      past: past.slice(0, -1),
      state: previous,
      future: [current, ...future].slice(0, MAX_HISTORY),
      isDirty: true,
    })
    saveDraft(previous)
  },

  redo: () => {
    const { past, state: current, future } = get()
    if (future.length === 0) return
    const next = future[0]
    set({
      past: pushHistory(past, current),
      state: next,
      future: future.slice(1),
      isDirty: true,
    })
    saveDraft(next)
  },

  reset: () => {
    const fresh = createDefaultLookCanvas()
    set({
      state: fresh,
      selectedNodeIds: [],
      imageUrls: {},
      past: [],
      future: [],
      currentLookId: null,
      currentCapsuleId: null,
      isDirty: false,
    })
    saveDraft(fresh)
    saveImageUrls({})
  },

  loadLook: (id, lookState, lookImageUrls) => {
    set({
      state: lookState,
      selectedNodeIds: [],
      imageUrls: lookImageUrls,
      past: [],
      future: [],
      currentLookId: id,
      currentCapsuleId: null,
      isDirty: false,
    })
    saveDraft(lookState)
    saveImageUrls(lookImageUrls)
  },

  // Duplicate: load an existing look's canvas onto the board but as a brand-new, unsaved
  // look (no currentLookId → Save creates a fresh row; isDirty so it prompts before discard).
  loadLookAsNew: (lookState, lookImageUrls) => {
    set({
      state: lookState,
      selectedNodeIds: [],
      imageUrls: lookImageUrls,
      past: [],
      future: [],
      currentLookId: null,
      currentCapsuleId: null,
      isDirty: true,
    })
    saveDraft(lookState)
    saveImageUrls(lookImageUrls)
  },

  // Load a saved capsule (gp_boards row) back onto the board for editing. Mirrors loadLook,
  // but tracks currentCapsuleId instead so the save flow updates gp_boards, not gp_looks.
  loadCapsule: (id, capsuleState, capsuleImageUrls) => {
    set({
      state: capsuleState,
      selectedNodeIds: [],
      imageUrls: capsuleImageUrls,
      past: [],
      future: [],
      currentLookId: null,
      currentCapsuleId: id,
      isDirty: false,
    })
    saveDraft(capsuleState)
    saveImageUrls(capsuleImageUrls)
  },

  markClean: () => set({ isDirty: false }),

  setBackground: (color) => {
    const { state: current, past } = get()
    const updated = { ...current, canvas: { ...current.canvas, background: color } }
    set({
      past: pushHistory(past, current),
      future: [],
      state: updated,
      isDirty: true,
    })
    saveDraft(updated)
  },
}))
