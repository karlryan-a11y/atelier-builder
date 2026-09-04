import { useRef, useMemo, useCallback, useEffect, useState } from 'react'
import { Stage, Layer, Image as KonvaImage, Rect, Transformer, Text as KonvaText, Line } from 'react-konva'
import type Konva from 'konva'
import { useCanvasStore, registerCanvasExport, unregisterCanvasExport, registerCanvasSettle, unregisterCanvasSettle } from '@/stores/canvasStore'
import { useCanvasImages } from '@/hooks/useCanvasImages'
import { useDroppable } from '@dnd-kit/core'
import { toKonvaConfig, fromKonvaTransform } from './CanvasAdapter'
import { CanvasToolbar } from './CanvasToolbar'
import { Grid3X3, ZoomIn, ZoomOut } from 'lucide-react'
import { selectionOnPress, shouldClearSelection, ringOffsets } from '@/lib/canvasSelection'
import { nextZoom, zoomLabel, MIN_ZOOM, MAX_ZOOM } from '@/lib/canvasView'
import type { CanvasNode, ClosetItemNode, TextNode } from '@/types/canvas'

// The board IS the canvas (state.canvas.{width,height}). It's scaled to fit this
// on-screen budget, preserving aspect, so Portrait / Square / Landscape all fit.
const FIT_W = 620
const FIT_H = 680

interface ClosetItemImageProps {
  node: ClosetItemNode
  image: HTMLImageElement | undefined
  isSelected: boolean
  /** True only when this is the ONLY selected node — then it shows its own resize box.
   *  When several are selected, a single group box (in the parent) resizes them together. */
  solo: boolean
  /** Fires on the PRESS, not the click. See lib/canvasSelection for why. */
  onSelect: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void
  onDragStart?: () => void
  onDragMove?: (x: number, y: number) => void
  onDragEnd: (x: number, y: number) => void
  onTransformEnd: (attrs: { x: number; y: number; scaleX: number; scaleY: number; rotation: number }) => void
}

function ClosetItemImage({ node, image, isSelected, solo, onSelect, onDragStart, onDragMove, onDragEnd, onTransformEnd }: ClosetItemImageProps) {
  const imageRef = useRef<Konva.Image>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  // For sparse/thin cut-outs (earrings, jewelry, belts) the clickable area is a generous
  // rectangle over the item's CONTENT (see the hit effect) — null means pixel-perfect.
  const [hitBox, setHitBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)

  // Report this item's natural dimensions once its image loads, so flip-in-place can
  // compensate the position by the rendered width (see store.flipNodes).
  useEffect(() => {
    if (image && image.naturalWidth) useCanvasStore.getState().setNodeDims(node.id, image.naturalWidth, image.naturalHeight)
  }, [image, node.id])

  // Clickable hit area. A cut-out photo's see-through margins shouldn't steal clicks from
  // neighbouring items — so a SOLID garment uses a pixel-accurate hit (its opaque pixels only).
  // But a SPARSE item (earrings = two thin shapes with a big transparent gap) is nearly
  // unclickable that way (Cynthia: "I can't click on earrings like the others"). So we measure
  // the opaque coverage: if the content is sparse/thin, give it a forgiving rectangle over just
  // the content box (earrings + the gap between them) instead of the pixel-perfect shape.
  useEffect(() => {
    const n = imageRef.current
    if (!n || !image) return
    let sparse = false
    let bbox: { x: number; y: number; width: number; height: number } | null = null
    try {
      const NW = image.naturalWidth, NH = image.naturalHeight
      const s = Math.min(1, 96 / Math.max(NW, NH)) // scan a downscaled copy (≤96px) — cheap
      const w = Math.max(1, Math.round(NW * s)), h = Math.max(1, Math.round(NH * s))
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(image, 0, 0, w, h)
      const data = ctx.getImageData(0, 0, w, h).data
      let minX = w, minY = h, maxX = -1, maxY = -1, opaque = 0
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 10) { opaque++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
      }
      if (maxX >= minX && maxY >= minY) {
        const bw = maxX - minX + 1, bh = maxY - minY + 1
        // Fraction of the CONTENT box that's actually opaque. Solid garments/bags/shoes ≈ 0.8+;
        // earrings, necklaces and thin jewelry sit well under 0.6 (mostly gaps) → give them the
        // forgiving rectangle. Erring generous: a mis-flagged solid item only risks minor
        // neighbour-steal, whereas a missed earring is the actual complaint.
        sparse = opaque / (bw * bh) < 0.6
        bbox = { x: minX / s, y: minY / s, width: bw / s, height: bh / s }
      }
    } catch { /* tainted/unreadable image → fall through to the default (full-rect) hit */ }

    if (sparse && bbox) {
      n.clearCache()
      setHitBox(bbox)
      n.getLayer()?.batchDraw()
    } else {
      setHitBox(null)
      try { n.cache(); n.drawHitFromCache(); n.getLayer()?.batchDraw() } catch { /* not laid out yet; harmless */ }
    }
  }, [image])

  // If compose set a target_height AND the image is loaded, compute the exact scale
  // so the item renders at the correct pixel height on the canvas.
  // Otherwise fall back to the stored scale (for old looks or manual edits).
  let effectiveScale = node.scale
  if (node.target_height && image && image.naturalHeight > 0) {
    effectiveScale = Math.min(Math.max(node.target_height / image.naturalHeight, 0.03), 3.0)
  }

  const config = toKonvaConfig({ ...node, scale: effectiveScale })

  const handleTransformEnd = useCallback(() => {
    const n = imageRef.current
    if (!n) return
    onTransformEnd({
      x: n.x(),
      y: n.y(),
      scaleX: n.scaleX(),
      scaleY: n.scaleY(),
      rotation: n.rotation(),
    })
  }, [onTransformEnd])

  return (
    <>
      {image && (
        <KonvaImage
          ref={imageRef}
          id={config.id}
          image={image}
          x={config.x}
          y={config.y}
          scaleX={config.scaleX}
          scaleY={config.scaleY}
          rotation={config.rotation}
          draggable={config.draggable}
          onMouseDown={onSelect}
          onTouchStart={onSelect}
          onDragStart={() => onDragStart?.()}
          onDragMove={(e) => onDragMove?.(e.target.x(), e.target.y())}
          onDragEnd={(e) => onDragEnd(e.target.x(), e.target.y())}
          onTransformEnd={handleTransformEnd}
          hitFunc={hitBox ? (ctx: Konva.Context, shape: Konva.Shape) => {
            // Generous rectangle over the item's content (sparse cut-outs like earrings).
            ctx.beginPath()
            ctx.rect(hitBox.x, hitBox.y, hitBox.width, hitBox.height)
            ctx.closePath()
            ctx.fillStrokeShape(shape)
          } : undefined}
        />
      )}
      {isSelected && solo && image && (
        <Transformer
          ref={(ref) => {
            if (ref && imageRef.current) {
              ref.nodes([imageRef.current])
              ref.getLayer()?.batchDraw()
            }
            ;(transformerRef as React.MutableRefObject<Konva.Transformer | null>).current = ref
          }}
          rotateEnabled
          keepRatio={false}
          enabledAnchors={['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']}
          boundBoxFunc={(oldBox, newBox) => {
            if (Math.abs(newBox.width) < 20 || Math.abs(newBox.height) < 20) return oldBox
            return newBox
          }}
        />
      )}
    </>
  )
}

interface TextNodeProps {
  node: TextNode
  isSelected: boolean
  solo: boolean
  editing: boolean
  /** Fires on the PRESS, not the click. See lib/canvasSelection for why. */
  onSelect: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void
  onDragStart?: () => void
  onDragMove?: (x: number, y: number) => void
  onDragEnd: (x: number, y: number) => void
  onDblClick: () => void
  onTransformCommit: (patch: { width: number; x: number; y: number; rotation: number }) => void
}

function TextNodeElement({ node, isSelected, solo, editing, onSelect, onDragStart, onDragMove, onDragEnd, onDblClick, onTransformCommit }: TextNodeProps) {
  const textRef = useRef<Konva.Text>(null)
  const transformerRef = useRef<Konva.Transformer>(null)

  // The Transformer's side handles resize the text BOX width (not font scale) and its rotate
  // handle turns the label. Konva carries BOTH as live attrs on the node; nothing is saved until
  // we write them back. So: convert any scaleX the Transformer applied into a concrete width (so
  // the text wraps to stacked lines), then commit width, position AND angle together.
  //
  // Committing only the width is exactly what silently flattened every rotated label: the angle
  // stayed on the Konva node, the export photographs the node so the picture came out right, and
  // the saved state said rotation 0. Nobody found out until the look was reopened. Keep all four.
  const commitTransform = (persist: boolean) => {
    const n = textRef.current
    if (!n) return
    const width = Math.max(20, n.width() * n.scaleX())
    n.setAttrs({ width, scaleX: 1 })
    if (persist) onTransformCommit({ width, x: n.x(), y: n.y(), rotation: n.rotation() })
  }

  return (
    <>
      <KonvaText
        ref={textRef}
        id={node.id}
        text={node.content}
        visible={!editing}
        x={node.x}
        y={node.y}
        fontFamily={node.font_family}
        fontSize={node.font_size}
        fontStyle={node.bold ? 'bold' : 'normal'}
        textDecoration={node.underline ? 'underline' : ''}
        align={node.align ?? 'left'}
        {...(node.width ? { width: node.width } : {})}
        fill={node.fill}
        rotation={node.rotation}
        draggable
        onMouseDown={onSelect}
        onTouchStart={onSelect}
        onDblClick={onDblClick}
        onDblTap={onDblClick}
        onDragStart={() => onDragStart?.()}
        onDragMove={(e) => onDragMove?.(e.target.x(), e.target.y())}
        onDragEnd={(e) => onDragEnd(e.target.x(), e.target.y())}
        onTransform={() => commitTransform(false)}
        onTransformEnd={() => commitTransform(true)}
      />
      {isSelected && solo && !editing && (
        <Transformer
          ref={(ref) => {
            if (ref && textRef.current) {
              ref.nodes([textRef.current])
              ref.getLayer()?.batchDraw()
            }
            ;(transformerRef as React.MutableRefObject<Konva.Transformer | null>).current = ref
          }}
          rotateEnabled
          enabledAnchors={['middle-left', 'middle-right']}
          boundBoxFunc={(oldBox, newBox) => {
            if (Math.abs(newBox.width) < 20) return oldBox
            return newBox
          }}
        />
      )}
    </>
  )
}

export function LookCanvas() {
  const store = useCanvasStore()
  const { state, selectedNodeIds, updateNode, setSelectedNodeIds, toggleNodeSelection } = store
  const stageRef = useRef<Konva.Stage>(null)

  // Group move: when you drag a node that's part of a multi-selection, all selected nodes
  // travel together. We snapshot every selected node's start position, move the others'
  // Konva nodes live by the same delta during the drag, then commit them in ONE history step.
  const dragGroup = useRef<{ id: string; ox: number; oy: number; others: { id: string; sx: number; sy: number }[] } | null>(null)
  const handleGroupDragStart = useCallback((id: string) => {
    const { selectedNodeIds: ids, state: s } = useCanvasStore.getState()
    const dragged = s.nodes.find((n) => n.id === id)
    if (!dragged || !ids.includes(id) || ids.length < 2) { dragGroup.current = null; return }
    const others = ids
      .filter((i) => i !== id)
      .map((i) => { const n = s.nodes.find((x) => x.id === i); return n ? { id: i, sx: n.x, sy: n.y } : null })
      .filter((o): o is { id: string; sx: number; sy: number } => !!o)
    dragGroup.current = { id, ox: dragged.x, oy: dragged.y, others }
  }, [])
  const handleGroupDragMove = useCallback((id: string, x: number, y: number) => {
    const g = dragGroup.current
    if (!g || g.id !== id) return
    const dx = x - g.ox, dy = y - g.oy
    const stage = stageRef.current
    if (!stage) return
    for (const o of g.others) { const kn = stage.findOne('#' + o.id); if (kn) kn.position({ x: o.sx + dx, y: o.sy + dy }) }
    stage.batchDraw()
  }, [])
  const handleGroupDragEnd = useCallback((id: string, x: number, y: number) => {
    const g = dragGroup.current
    const s = useCanvasStore.getState()
    if (g && g.id === id) {
      const dx = x - g.ox, dy = y - g.oy
      s.updateNodes([{ id, updates: { x, y } }, ...g.others.map((o) => ({ id: o.id, updates: { x: o.sx + dx, y: o.sy + dy } }))])
      dragGroup.current = null
    } else {
      s.updateNode(id, { x, y })
    }
  }, [])

  // Board dimensions come from the canvas state (Portrait / Square / Landscape).
  const CW = state.canvas.width
  const CH = state.canvas.height
  // Scale the board to fit the ACTUAL available area (measured), so it's never
  // clipped at the bottom and adapts to any window height / board aspect.
  const fitRef = useRef<HTMLDivElement>(null)
  const [avail, setAvail] = useState({ w: FIT_W, h: FIT_H })
  useEffect(() => {
    const el = fitRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setAvail({ w: el.clientWidth, h: el.clientHeight })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])
  // FIT is the whole board on screen. Zoom multiplies it, and the board then scrolls inside
  // its container. Everything downstream reads the LIVE stage scale, so nothing has to know
  // this is two numbers rather than one.
  const FIT = Math.max(0.05, Math.min((avail.w - 24) / CW, (avail.h - 24) / CH))
  const [zoom, setZoom] = useState<number>(MIN_ZOOM)
  const SCALE = FIT * zoom

  // Trackpad pinch arrives as ctrl+wheel. React attaches wheel at the root as passive, so
  // preventDefault there is ignored and the browser zooms the whole page instead of the board.
  useEffect(() => {
    const el = fitRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom((z) => nextZoom(z, e.deltaY < 0 ? 1 : -1))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Read every node's LIVE transform off the stage and write back anything the state does not
  // already say. This is the backstop for the whole class of "it looked right when I saved it"
  // bugs — see settleCanvasTransforms in canvasStore for why the two can drift apart at all.
  //
  // Deliberately NOT reconciled: closet_item scale. When a node carries `target_height` the
  // render layer DERIVES its scale from the image's natural height, so the live scaleX
  // legitimately differs from `node.scale`. Reading it back would look like drift, and writing
  // it would clobber target_height. That path already persists correctly via fromKonvaTransform.
  const settleTransforms = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    const s = useCanvasStore.getState()
    const patches: { id: string; updates: Partial<CanvasNode> }[] = []
    const EPS = 0.01

    for (const node of s.state.nodes) {
      const kn = stage.findOne('#' + node.id)
      if (!kn) continue
      const updates: Record<string, unknown> = {}

      if (Math.abs(kn.x() - node.x) > EPS) updates.x = kn.x()
      if (Math.abs(kn.y() - node.y) > EPS) updates.y = kn.y()

      // ShapeNode is the one type with no angle of its own (the adapter pins it to 0).
      if (node.type !== 'shape' && Math.abs(kn.rotation() - node.rotation) > EPS) {
        updates.rotation = kn.rotation()
      }

      // A Transformer leaves its scale sitting on the node. Text carries scale as box width and
      // font size, never as a raw scale, so fold any residual back into those two.
      if (node.type === 'text') {
        const t = kn as Konva.Text
        const sx = Math.abs(t.scaleX()) || 1
        const sy = Math.abs(t.scaleY()) || 1
        if (Math.abs(sx - 1) > EPS) {
          updates.width = Math.max(20, t.width() * sx)
          t.scaleX(1)
        } else if (node.width !== undefined && Math.abs(t.width() - node.width) > EPS) {
          updates.width = Math.max(20, t.width())
        }
        if (Math.abs(sy - 1) > EPS) {
          updates.font_size = Math.max(6, Math.round(node.font_size * sy))
          t.scaleY(1)
        }
      }

      if (Object.keys(updates).length) patches.push({ id: node.id, updates: updates as Partial<CanvasNode> })
    }

    if (patches.length) {
      // Loud on purpose: reaching here means some handler is still dropping a transform. The save
      // is correct either way, but the leak is worth finding.
      console.warn(`[canvas] settled ${patches.length} node(s) whose on-screen transform was never saved`, patches)
      s.updateNodes(patches)
    }
  }, [])

  useEffect(() => {
    registerCanvasSettle(settleTransforms)
    return () => unregisterCanvasSettle()
  }, [settleTransforms])

  // Register the Konva native export function so ChatPanel can call it.
  // Crops to content bounds WITHIN the frame — tight around items, never exceeds frame.
  useEffect(() => {
    registerCanvasExport((opts) => {
      const stage = stageRef.current
      if (!stage) return null

      // Belt and braces: the save paths call settleCanvasTransforms() themselves, but the picture
      // must never be able to show something the saved state does not. Idempotent.
      settleTransforms()
      if (store.state.nodes.length === 0) return null

      const pixelRatio = opts?.pixelRatio ?? 2

      const BW = store.state.canvas.width
      const BH = store.state.canvas.height

      // Hide UI-only elements during export (selection transformers + the grid).
      const transformers = stage.find('Transformer')
      transformers.forEach((t: any) => t.hide())
      const lines = stage.find('Line')
      lines.forEach((l: any) => l.hide())

      // The on-screen stage is rendered at a reduced scale. Reset to 1:1 / full
      // board size for the capture so the board exports at native resolution.
      const prevScaleX = stage.scaleX()
      const prevScaleY = stage.scaleY()
      const prevWidth = stage.width()
      const prevHeight = stage.height()
      stage.scale({ x: 1, y: 1 })
      stage.size({ width: BW, height: BH })

      try {
        // Export the full board — the board IS the composition.
        return stage.toDataURL({
          x: 0,
          y: 0,
          width: BW,
          height: BH,
          pixelRatio,
          mimeType: 'image/png',
        })
      } finally {
        stage.scale({ x: prevScaleX, y: prevScaleY })
        stage.size({ width: prevWidth, height: prevHeight })
        stage.batchDraw()
        transformers.forEach((t: any) => t.show())
        lines.forEach((l: any) => l.show())
      }
    })

    return () => unregisterCanvasExport()
  }, [store.state.nodes, settleTransforms])

  // Web fonts (Amalfi Coast + the others) must be loaded before Konva measures/draws text,
  // or it renders with a fallback until the next redraw (the "flash then swaps to our font"
  // bug). Kick off the loads, redraw once they're ready, AND redraw whenever the browser
  // finishes loading a font later ('loadingdone') or a look with text is opened — so any
  // residual race resolves in a single clean repaint instead of a lingering fallback.
  const textNodeCount = state.nodes.filter((n) => n.type === 'text').length
  useEffect(() => {
    let cancelled = false
    const families = ["'Amalfi Coast'", "'Playfair Display SC'", "'Playfair Display'", "'Great Vibes'", "'Neue Haas'", "'Schnyder'"]
    const docFonts = (document as Document & { fonts?: FontFaceSet }).fonts
    if (!docFonts) return
    const redraw = () => { if (!cancelled) stageRef.current?.batchDraw() }
    Promise.all(families.map((f) => docFonts.load(`32px ${f}`).catch(() => undefined)))
      .then(() => docFonts.ready)
      .then(redraw)
    docFonts.addEventListener('loadingdone', redraw)
    return () => { cancelled = true; docFonts.removeEventListener('loadingdone', redraw) }
  }, [textNodeCount])

  const [showGrid, setShowGrid] = useState(false)
  // Which text node is currently being edited — its on-canvas copy is hidden DECLARATIVELY
  // (visible={!editing}) so a re-render can't un-hide it and produce the "double text box".
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const selectionStart = useRef<{ x: number; y: number } | null>(null)
  const isDraggingSelection = useRef(false)
  // Where the press began. A release on empty board only clears the selection when the press
  // began there too - a press that started on a piece and drifted off it is the bug, not an
  // intent to deselect. See lib/canvasSelection.
  const pressedEmpty = useRef(false)

  const { setNodeRef } = useDroppable({ id: 'canvas-drop-target' })

  const storeImageUrls = store.imageUrls

  const imageUrlMap = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const node of state.nodes) {
      if (node.type === 'closet_item') {
        m.set(node.id, storeImageUrls[node.id] ?? null)
      }
    }
    return m
  }, [state.nodes, storeImageUrls])

  const images = useCanvasImages(imageUrlMap)

  const sortedNodes = useMemo(
    () => [...state.nodes].sort((a, b) => a.z_index - b.z_index),
    [state.nodes]
  )

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return
      if (target.isContentEditable) return

      const mod = e.metaKey || e.ctrlKey
      // Normalise single-char keys so Caps Lock (or Shift) doesn't break the shortcuts —
      // with Caps Lock on, e.key for Cmd+A is 'A', not 'a', and select-all would silently fail.
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      const { selectedNodeIds: ids, state: s } = useCanvasStore.getState()

      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault()
        useCanvasStore.getState().undo()
        return
      }
      if (mod && key === 'z' && e.shiftKey) {
        e.preventDefault()
        useCanvasStore.getState().redo()
        return
      }
      if (mod && (key === '=' || key === '+')) {
        e.preventDefault()
        setZoom((z) => nextZoom(z, 1))
        return
      }
      if (mod && key === '-') {
        e.preventDefault()
        setZoom((z) => nextZoom(z, -1))
        return
      }
      if (mod && key === '0') {
        e.preventDefault()
        setZoom(MIN_ZOOM)
        return
      }
      if (mod && key === 'a') {
        e.preventDefault()
        useCanvasStore.getState().setSelectedNodeIds(s.nodes.map((n) => n.id))
        return
      }
      if (mod && key === 'd' && ids.length > 0) {
        e.preventDefault()
        useCanvasStore.getState().duplicateNodes(ids)
        return
      }
      if (mod && key === 'c' && ids.length > 0) {
        e.preventDefault()
        useCanvasStore.getState().copyNodes(ids)
        return
      }
      if (mod && key === 'v') {
        e.preventDefault()
        useCanvasStore.getState().pasteNodes()
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && ids.length > 0) {
        e.preventDefault()
        useCanvasStore.getState().removeNodes(ids)
        return
      }
      // F — flip the selected closet item(s) horizontally (mirror; e.g. shoes).
      if ((e.key === 'f' || e.key === 'F') && !mod && ids.length > 0) {
        const items = s.nodes.filter((n) => n.type === 'closet_item' && ids.includes(n.id))
        if (items.length) {
          e.preventDefault()
          useCanvasStore.getState().flipNodes(items.map((it) => it.id))
        }
        return
      }

      const nudge = e.shiftKey ? 10 : 1
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && ids.length > 0) {
        e.preventDefault()
        for (const id of ids) {
          const node = s.nodes.find((n) => n.id === id)
          if (!node) continue
          const dx = e.key === 'ArrowLeft' ? -nudge : e.key === 'ArrowRight' ? nudge : 0
          const dy = e.key === 'ArrowUp' ? -nudge : e.key === 'ArrowDown' ? nudge : 0
          useCanvasStore.getState().updateNode(id, { x: node.x + dx, y: node.y + dy })
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Fires on the PRESS. Konva only fires `click` when the shape under the pointer at press is
  // the same shape at release, and with a pixel-perfect hit mask on a dense capsule a two-pixel
  // drift makes those disagree, so no click arrives at all. The press always arrives.
  const handleNodeSelect = useCallback(
    (nodeId: string, e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const evt = e.evt as MouseEvent
      const outcome = selectionOnPress(useCanvasStore.getState().selectedNodeIds, nodeId, {
        shiftKey: evt.shiftKey,
        metaKey: evt.metaKey,
        button: 'button' in evt ? evt.button : undefined,
      })
      switch (outcome.action) {
        case 'ignore':
        case 'keep-group':
          return
        case 'toggle':
          toggleNodeSelection(outcome.nodeId)
          return
        case 'replace':
          setSelectedNodeIds([outcome.nodeId])
      }
    },
    [setSelectedNodeIds, toggleNodeSelection]
  )

  // A press that lands on nothing looks a few pixels around the pointer before giving up.
  // A garment's hit area is an alpha mask rasterised at on-screen scale, so thin detail (a
  // chain strap, a heel, a spaghetti strap) comes out with no coverage: visible, unclickable.
  // Measured over every visible garment pixel of the Melbourne + Sydney capsule, pressing the
  // garment resolved to nothing 16.6% of the time; this ring takes that to 0.5%.
  const TOLERANCE_PX = 4
  const pickNodeNearPointer = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return null
    const pos = stage.getPointerPosition()
    if (!pos) return null
    const known = new Set(useCanvasStore.getState().state.nodes.map((n) => n.id))
    for (const { dx, dy } of ringOffsets(TOLERANCE_PX)) {
      const id = stage.getIntersection({ x: pos.x + dx, y: pos.y + dy })?.id()
      if (id && known.has(id)) return id
    }
    return null
  }, [])

  // Records where the press began, and answers "was this really empty board?". False when the
  // press was on a piece, and false when it was near enough to one that we selected it instead.
  const pressBeganOnEmptyBoard = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (e.target !== e.target.getStage()) { pressedEmpty.current = false; return false }
      const nearby = pickNodeNearPointer()
      if (nearby) { pressedEmpty.current = false; handleNodeSelect(nearby, e); return false }
      pressedEmpty.current = true
      return true
    },
    [pickNodeNearPointer, handleNodeSelect]
  )

  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!pressBeganOnEmptyBoard(e)) return
      const stage = e.target.getStage()
      if (!stage) return
      const pos = stage.getPointerPosition()
      if (!pos) return
      const scale = stage.scaleX()
      const stagePos = { x: pos.x / scale, y: pos.y / scale }
      selectionStart.current = stagePos
      isDraggingSelection.current = false
      setSelectionRect(null)
    },
    [pressBeganOnEmptyBoard]
  )

  const handleStageMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!selectionStart.current) return
      const stage = e.target.getStage()
      if (!stage) return
      const pos = stage.getPointerPosition()
      if (!pos) return
      const scale = stage.scaleX()
      const current = { x: pos.x / scale, y: pos.y / scale }
      const start = selectionStart.current
      const dx = current.x - start.x
      const dy = current.y - start.y
      if (!isDraggingSelection.current && Math.abs(dx) < 5 && Math.abs(dy) < 5) return
      isDraggingSelection.current = true
      setSelectionRect({
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        width: Math.abs(dx),
        height: Math.abs(dy),
      })
    },
    []
  )

  const handleStageMouseUp = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (isDraggingSelection.current && selectionRect) {
        const r = selectionRect
        const stage = e.target.getStage()
        // Select any node whose RENDERED bounding box overlaps the marquee — the intuitive
        // "drag a box over these items" behaviour. The old test only checked whether a node's
        // top-left anchor point sat inside the box, so items the box clearly covered were missed
        // whenever their anchor fell outside it (the flaky "sometimes works" bug). getClientRect
        // ({relativeTo: stage}) gives the box in board coords (accounts for scale/rotation/size);
        // fall back to the anchor point only if the Konva node isn't found (e.g. image not loaded).
        const overlaps = (b: { x: number; y: number; width: number; height: number }) =>
          !(b.x > r.x + r.width || b.x + b.width < r.x || b.y > r.y + r.height || b.y + b.height < r.y)
        const hits = state.nodes.filter((n) => {
          const kn = stage?.findOne('#' + n.id)
          const box = kn ? kn.getClientRect({ relativeTo: stage as Konva.Stage }) : { x: n.x, y: n.y, width: 0, height: 0 }
          return overlaps(box)
        })
        setSelectedNodeIds(hits.map((n) => n.id))
      } else if (shouldClearSelection({
        pressedEmpty: pressedEmpty.current,
        releasedEmpty: e.target === e.target.getStage(),
        marquee: false,
      })) {
        setSelectedNodeIds([])
      }
      selectionStart.current = null
      isDraggingSelection.current = false
      setSelectionRect(null)
    },
    [state.nodes, selectionRect, setSelectedNodeIds]
  )

  // Group resize: when 2+ nodes are selected, ONE box wraps them all and scales/rotates them
  // together (uniform). Single selection keeps the per-node box (free resize + rotate).
  const groupTrRef = useRef<Konva.Transformer>(null)
  useEffect(() => {
    const tr = groupTrRef.current
    const stage = stageRef.current
    if (!tr || !stage) return
    if (selectedNodeIds.length > 1) {
      const nodes = selectedNodeIds.map((id) => stage.findOne('#' + id)).filter((n): n is Konva.Node => !!n)
      tr.nodes(nodes)
    } else {
      tr.nodes([])
    }
    tr.getLayer()?.batchDraw()
  }, [selectedNodeIds, state.nodes, images])

  const handleGroupTransformEnd = useCallback(() => {
    const tr = groupTrRef.current
    if (!tr) return
    const s = useCanvasStore.getState()
    const patches: { id: string; updates: Partial<CanvasNode> }[] = []
    for (const kn of tr.nodes()) {
      const id = kn.id()
      const n = s.state.nodes.find((x) => x.id === id)
      if (!n) continue
      if (n.type === 'text') {
        const tn = n as TextNode
        const sc = Math.abs(kn.scaleY()) || 1
        patches.push({ id, updates: {
          x: kn.x(), y: kn.y(), rotation: kn.rotation(),
          font_size: Math.max(6, Math.round(tn.font_size * sc)),
          ...(tn.width ? { width: Math.max(20, tn.width * (Math.abs(kn.scaleX()) || 1)) } : {}),
        } as Partial<CanvasNode> })
        kn.scaleX(1); kn.scaleY(1)
      } else {
        patches.push({ id, updates: { ...fromKonvaTransform(n as ClosetItemNode, { x: kn.x(), y: kn.y(), scaleX: kn.scaleX(), scaleY: kn.scaleY(), rotation: kn.rotation() }), target_height: undefined } as Partial<CanvasNode> })
      }
    }
    if (patches.length) s.updateNodes(patches)
  }, [])

  const handleTextDblClick = useCallback((node: TextNode, opts?: { isNew?: boolean }) => {
    const stage = stageRef.current
    if (!stage) return

    const textKonva = stage.findOne(`#${node.id}`) as Konva.Text | null
    if (!textKonva) return

    const textPosition = textKonva.absolutePosition()
    const stageBox = stage.container().getBoundingClientRect()
    const scale = stage.scaleX()

    // Hide the on-canvas text while editing so the stylist never sees two copies / an "extra
    // box" — the textarea sits exactly on top and looks like the text itself. This MUST be
    // declarative (state → visible={!editing}); an imperative .hide() gets undone by the very
    // next re-render, which was the "double text box" bug.
    setEditingTextId(node.id)

    const textarea = document.createElement('textarea')
    textarea.value = node.content
    // Seamless, box-free overlay: transparent, borderless, matches the text's font,
    // weight, decoration, alignment and colour so editing looks in-place.
    textarea.style.position = 'absolute'
    // absolutePosition() already includes the stage scale, so it is screen offset from the
    // stage origin. Multiplying by `scale` again put the box at a fraction of the right place;
    // the sizes below DO need it, because width/height/fontSize are node-local.
    textarea.style.top = `${stageBox.top + textPosition.y}px`
    textarea.style.left = `${stageBox.left + textPosition.x}px`
    textarea.style.width = `${(textKonva.width() * scale) + 4}px`
    textarea.style.height = `${(textKonva.height() * scale) + 2}px`
    textarea.style.fontSize = `${node.font_size * scale}px`
    textarea.style.fontFamily = node.font_family
    textarea.style.fontWeight = node.bold ? 'bold' : 'normal'
    textarea.style.textDecoration = node.underline ? 'underline' : 'none'
    textarea.style.textAlign = node.align ?? 'left'
    textarea.style.color = node.fill
    textarea.style.border = 'none'
    textarea.style.padding = '0'
    textarea.style.margin = '0'
    textarea.style.overflow = 'hidden'
    textarea.style.background = 'transparent'
    textarea.style.outline = 'none'
    textarea.style.resize = 'none'
    textarea.style.lineHeight = '1'
    textarea.style.zIndex = '100'
    if (node.rotation) {
      textarea.style.transform = `rotate(${node.rotation}deg)`
      textarea.style.transformOrigin = 'top left'
    }

    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()

    let done = false
    const finish = () => {
      if (done) return
      done = true
      const value = textarea.value
      textarea.remove()
      setEditingTextId(null) // reveal the on-canvas text again (or it's about to be removed)
      // Drop empty text, and drop a freshly-added placeholder the stylist never typed into —
      // no stray "Text" box left on the board. Otherwise persist the edit.
      const isUntouchedPlaceholder = opts?.isNew && value === node.content
      if (value.trim() === '' || isUntouchedPlaceholder) {
        useCanvasStore.getState().removeNode(node.id)
        return
      }
      updateNode(node.id, { content: value })
    }

    textarea.addEventListener('blur', finish)
    textarea.addEventListener('keydown', (ke) => {
      if (ke.key === 'Escape') textarea.blur()
      if (ke.key === 'Enter' && !ke.shiftKey) { ke.preventDefault(); textarea.blur() }
    })
  }, [updateNode])

  // When a text node is added via the toolbar, open its inline editor immediately (GoodPix-style)
  // so the stylist can just start typing over the selected placeholder — no extra click.
  const pendingEditTextId = store.pendingEditTextId
  useEffect(() => {
    if (!pendingEditTextId) return
    const node = state.nodes.find((n) => n.id === pendingEditTextId && n.type === 'text') as TextNode | undefined
    const clear = () => useCanvasStore.getState().requestTextEdit(null)
    if (!node) { clear(); return }
    const raf = requestAnimationFrame(() => { handleTextDblClick(node, { isNew: true }); clear() })
    return () => cancelAnimationFrame(raf)
  }, [pendingEditTextId, state.nodes, handleTextDblClick])

  // Grid lines
  const gridLines = useMemo(() => {
    if (!showGrid) return null
    const lines: React.ReactElement[] = []
    const step = 100
    for (let i = step; i < CW; i += step) {
      lines.push(
        <Line key={`gv${i}`} points={[i, 0, i, CH]} stroke="#B7AC9B" strokeWidth={1} listening={false} />
      )
    }
    for (let i = step; i < CH; i += step) {
      lines.push(
        <Line key={`gh${i}`} points={[0, i, CW, i]} stroke="#B7AC9B" strokeWidth={1} listening={false} />
      )
    }
    return lines
  }, [showGrid, CW, CH])

  return (
    <main
      ref={setNodeRef}
      className="flex-1 flex flex-col items-center relative overflow-hidden"
      style={{ backgroundColor: 'rgba(245, 241, 234, 0.3)' }}
    >
      {/* Toolbar area — sits in the gray zone above the canvas */}
      <div className="w-full flex items-center justify-center py-3 shrink-0 relative">
        <div className="absolute left-3 flex items-center gap-1">
          <button
            onClick={() => setZoom((z) => nextZoom(z, -1))}
            disabled={zoom <= MIN_ZOOM}
            className="p-1.5 rounded-sm border bg-white border-border text-text-muted hover:bg-tile disabled:opacity-30 transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setZoom(MIN_ZOOM)}
            className="px-2 py-1 rounded-sm border bg-white border-border text-text-muted hover:bg-tile text-[10px] tabular-nums tracking-wider transition-colors"
            title="Fit the whole board"
          >
            {zoomLabel(zoom)}
          </button>
          <button
            onClick={() => setZoom((z) => nextZoom(z, 1))}
            disabled={zoom >= MAX_ZOOM}
            className="p-1.5 rounded-sm border bg-white border-border text-text-muted hover:bg-tile disabled:opacity-30 transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
        <CanvasToolbar />
        <button
          onClick={() => setShowGrid(!showGrid)}
          className={`absolute right-3 p-1.5 rounded-sm border transition-colors ${
            showGrid ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-white border-border text-text-muted hover:bg-tile'
          }`}
          title="Toggle grid"
        >
          <Grid3X3 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Canvas — the white look area. min-h-0 lets the flex child shrink so the
          board scales to fit instead of overflowing/clipping at the bottom. */}
      <div ref={fitRef} className="flex-1 flex pb-4 min-h-0 w-full overflow-auto">
        <div
          className="relative m-auto shrink-0 border border-border rounded bg-white shadow-sm"
          style={{ width: CW * SCALE, height: CH * SCALE }}
        >
        <Stage
          ref={stageRef}
          width={CW * SCALE}
          height={CH * SCALE}
          scaleX={SCALE}
          scaleY={SCALE}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onTouchStart={(e) => { pressBeganOnEmptyBoard(e) }}
          onTap={(e) => {
            if (shouldClearSelection({
              pressedEmpty: pressedEmpty.current,
              releasedEmpty: e.target === e.target.getStage(),
              marquee: false,
            })) setSelectedNodeIds([])
          }}
          style={{ background: state.canvas.background, borderRadius: '4px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
        >
          <Layer>
            {/* The board itself is the export area — fill it with the background. */}
            <Rect
              x={0}
              y={0}
              width={CW}
              height={CH}
              fill={state.canvas.background}
              listening={false}
            />
            {gridLines}
            {sortedNodes.map((node) => {
              if (node.type === 'closet_item') {
                const cNode = node as ClosetItemNode
                return (
                  <ClosetItemImage
                    key={node.id}
                    node={cNode}
                    image={images.get(node.id)}
                    isSelected={selectedNodeIds.includes(node.id)}
                    solo={selectedNodeIds.length === 1}
                    onSelect={(e) => handleNodeSelect(node.id, e)}
                    onDragStart={() => handleGroupDragStart(node.id)}
                    onDragMove={(x, y) => handleGroupDragMove(node.id, x, y)}
                    onDragEnd={(x, y) => handleGroupDragEnd(node.id, x, y)}
                    onTransformEnd={(attrs) => {
                      const updates = fromKonvaTransform(cNode, attrs)
                      // Clear target_height so user's manual resize sticks
                      updateNode(node.id, { ...updates, target_height: undefined })
                    }}
                  />
                )
              }
              if (node.type === 'text') {
                const tNode = node as TextNode
                return (
                  <TextNodeElement
                    key={node.id}
                    node={tNode}
                    isSelected={selectedNodeIds.includes(node.id)}
                    solo={selectedNodeIds.length === 1}
                    editing={editingTextId === node.id}
                    onSelect={(e) => handleNodeSelect(node.id, e)}
                    onDragStart={() => handleGroupDragStart(node.id)}
                    onDragMove={(x, y) => handleGroupDragMove(node.id, x, y)}
                    onDragEnd={(x, y) => handleGroupDragEnd(node.id, x, y)}
                    onDblClick={() => handleTextDblClick(tNode)}
                    onTransformCommit={(patch) => updateNode(node.id, patch)}
                  />
                )
              }
              return null
            })}
            {/* One box that resizes/rotates the whole selection together (2+ nodes). */}
            <Transformer
              ref={groupTrRef}
              rotateEnabled
              keepRatio
              enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
              boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < 20 || Math.abs(newBox.height) < 20 ? oldBox : newBox)}
              onTransformEnd={handleGroupTransformEnd}
            />
            {selectionRect && (
              <Rect
                x={selectionRect.x}
                y={selectionRect.y}
                width={selectionRect.width}
                height={selectionRect.height}
                fill="rgba(248, 229, 231, 0.2)"
                stroke="#F8E5E7"
                strokeWidth={1}
                listening={false}
              />
            )}
          </Layer>
        </Stage>
        </div>
        {state.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-[10px] tracking-[0.3em] uppercase text-text-muted/30">
              Drag pieces here to build a look
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
