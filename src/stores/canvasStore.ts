import { create } from 'zustand'
import type { LookCanvasState, CanvasNode } from '@/types/canvas'
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
  past: LookCanvasState[]
  future: LookCanvasState[]
  currentLookId: string | null
  isDirty: boolean
}

// Export function registered by LookCanvas, called by ChatPanel
type ExportCanvasFn = (opts?: { pixelRatio?: number; padding?: number }) => string | null

let _registeredExportFn: ExportCanvasFn | null = null

/** Called by LookCanvas on mount to register its export function */
export function registerCanvasExport(fn: ExportCanvasFn) {
  _registeredExportFn = fn
}

/** Called by LookCanvas on unmount */
export function unregisterCanvasExport() {
  _registeredExportFn = null
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
  removeNode: (id: string) => void
  removeNodes: (ids: string[]) => void
  setSelectedNodeIds: (ids: string[]) => void
  toggleNodeSelection: (id: string) => void
  duplicateNodes: (ids: string[]) => void
  moveLayer: (ids: string[], direction: 'up' | 'down') => void
  alignNodes: (ids: string[], edge: 'left' | 'right' | 'top' | 'bottom' | 'center-h' | 'center-v') => void
  distributeNodes: (ids: string[], axis: 'horizontal' | 'vertical') => void
  undo: () => void
  redo: () => void
  reset: () => void
  loadLook: (id: string, state: LookCanvasState, imageUrls: Record<string, string>) => void
  markClean: () => void
  setBackground: (color: string) => void
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
  past: [],
  future: [],
  currentLookId: null,
  isDirty: false,

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

  moveLayer: (ids, direction) => {
    const { state: current, past } = get()
    const sorted = [...current.nodes].sort((a, b) => a.z_index - b.z_index)
    const idSet = new Set(ids)

    if (direction === 'up') {
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

    const reindexed = sorted.map((n, i) => ({ ...n, z_index: i }) as CanvasNode)
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
      isDirty: false,
    })
    saveDraft(lookState)
    saveImageUrls(lookImageUrls)
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
