import { useRef, useMemo, useCallback, useEffect, useState } from 'react'
import { Stage, Layer, Image as KonvaImage, Rect, Transformer, Text as KonvaText, Line } from 'react-konva'
import type Konva from 'konva'
import { useCanvasStore, registerCanvasExport, unregisterCanvasExport } from '@/stores/canvasStore'
import { useCanvasImages } from '@/hooks/useCanvasImages'
import { useDroppable } from '@dnd-kit/core'
import { toKonvaConfig, fromKonvaDrag, fromKonvaTransform } from './CanvasAdapter'
import { CanvasToolbar } from './CanvasToolbar'
import { Grid3X3 } from 'lucide-react'
import type { ClosetItemNode, TextNode } from '@/types/canvas'

// The board IS the canvas (state.canvas.{width,height}). It's scaled to fit this
// on-screen budget, preserving aspect, so Portrait / Square / Landscape all fit.
const FIT_W = 620
const FIT_H = 680

interface ClosetItemImageProps {
  node: ClosetItemNode
  image: HTMLImageElement | undefined
  isSelected: boolean
  onSelect: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void
  onDragEnd: (x: number, y: number) => void
  onTransformEnd: (attrs: { x: number; y: number; scaleX: number; scaleY: number; rotation: number }) => void
}

function ClosetItemImage({ node, image, isSelected, onSelect, onDragEnd, onTransformEnd }: ClosetItemImageProps) {
  const imageRef = useRef<Konva.Image>(null)
  const transformerRef = useRef<Konva.Transformer>(null)

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
          onClick={onSelect}
          onTap={onSelect}
          onDragEnd={(e) => onDragEnd(e.target.x(), e.target.y())}
          onTransformEnd={handleTransformEnd}
        />
      )}
      {isSelected && image && (
        <Transformer
          ref={(ref) => {
            if (ref && imageRef.current) {
              ref.nodes([imageRef.current])
              ref.getLayer()?.batchDraw()
            }
            ;(transformerRef as React.MutableRefObject<Konva.Transformer | null>).current = ref
          }}
          rotateEnabled
          enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
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
  onSelect: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void
  onDragEnd: (x: number, y: number) => void
  onDblClick: () => void
  onResize: (width: number) => void
}

function TextNodeElement({ node, isSelected, onSelect, onDragEnd, onDblClick, onResize }: TextNodeProps) {
  const textRef = useRef<Konva.Text>(null)
  const transformerRef = useRef<Konva.Transformer>(null)

  // Side handles resize the text BOX width (not font scale): convert any scaleX
  // the Transformer applied into a concrete width so the text wraps to stacked
  // lines. Live during drag (no store churn), then persist on release.
  const applyWidth = (persist: boolean) => {
    const n = textRef.current
    if (!n) return
    const w = Math.max(20, n.width() * n.scaleX())
    n.setAttrs({ width: w, scaleX: 1 })
    if (persist) onResize(w)
  }

  return (
    <>
      <KonvaText
        ref={textRef}
        id={node.id}
        text={node.content}
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
        onClick={onSelect}
        onTap={onSelect}
        onDblClick={onDblClick}
        onDblTap={onDblClick}
        onDragEnd={(e) => onDragEnd(e.target.x(), e.target.y())}
        onTransform={() => applyWidth(false)}
        onTransformEnd={() => applyWidth(true)}
      />
      {isSelected && (
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

  // Board dimensions come from the canvas state (Portrait / Square / Landscape).
  const CW = state.canvas.width
  const CH = state.canvas.height
  const SCALE = Math.min(FIT_W / CW, FIT_H / CH)

  // Register the Konva native export function so ChatPanel can call it.
  // Crops to content bounds WITHIN the frame — tight around items, never exceeds frame.
  useEffect(() => {
    registerCanvasExport((opts) => {
      const stage = stageRef.current
      if (!stage) return null
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
  }, [store.state.nodes])

  // Web fonts (Playfair Display SC, Playfair, Great Vibes) must be loaded before
  // Konva measures/draws text, or it renders with a fallback until the next redraw.
  useEffect(() => {
    let cancelled = false
    const families = ["'Playfair Display SC'", "'Playfair Display'", "'Great Vibes'"]
    const docFonts = (document as Document & { fonts?: FontFaceSet }).fonts
    if (!docFonts) return
    Promise.all(families.map((f) => docFonts.load(`16px ${f}`).catch(() => undefined)))
      .then(() => docFonts.ready)
      .then(() => { if (!cancelled) stageRef.current?.batchDraw() })
    return () => { cancelled = true }
  }, [])

  const [showGrid, setShowGrid] = useState(false)
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const selectionStart = useRef<{ x: number; y: number } | null>(null)
  const isDraggingSelection = useRef(false)

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
      const { selectedNodeIds: ids, state: s } = useCanvasStore.getState()

      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        useCanvasStore.getState().undo()
        return
      }
      if (mod && e.key === 'z' && e.shiftKey) {
        e.preventDefault()
        useCanvasStore.getState().redo()
        return
      }
      if (mod && e.key === 'd' && ids.length > 0) {
        e.preventDefault()
        useCanvasStore.getState().duplicateNodes(ids)
        return
      }
      if (mod && e.key === 'c' && ids.length > 0) {
        e.preventDefault()
        useCanvasStore.getState().copyNodes(ids)
        return
      }
      if (mod && e.key === 'v') {
        e.preventDefault()
        useCanvasStore.getState().pasteNodes()
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && ids.length > 0) {
        e.preventDefault()
        useCanvasStore.getState().removeNodes(ids)
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

  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.target !== e.target.getStage()) return
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
    []
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
        const hits = state.nodes.filter((n) => {
          return n.x >= r.x && n.y >= r.y && n.x <= r.x + r.width && n.y <= r.y + r.height
        })
        setSelectedNodeIds(hits.map((n) => n.id))
      } else if (e.target === e.target.getStage()) {
        setSelectedNodeIds([])
      }
      selectionStart.current = null
      isDraggingSelection.current = false
      setSelectionRect(null)
    },
    [state.nodes, selectionRect, setSelectedNodeIds]
  )

  const handleNodeSelect = useCallback(
    (nodeId: string, e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const evt = e.evt as MouseEvent
      if (evt.shiftKey || evt.metaKey) {
        toggleNodeSelection(nodeId)
      } else {
        setSelectedNodeIds([nodeId])
      }
    },
    [setSelectedNodeIds, toggleNodeSelection]
  )

  const handleTextDblClick = useCallback((node: TextNode) => {
    const stage = stageRef.current
    if (!stage) return

    const textKonva = stage.findOne(`#${node.id}`)
    if (!textKonva) return

    const textPosition = textKonva.absolutePosition()
    const stageBox = stage.container().getBoundingClientRect()
    const scale = stage.scaleX()

    const textarea = document.createElement('textarea')
    textarea.value = node.content
    textarea.style.position = 'absolute'
    textarea.style.top = `${stageBox.top + textPosition.y * scale}px`
    textarea.style.left = `${stageBox.left + textPosition.x * scale}px`
    textarea.style.width = `${(textKonva.width() * scale) + 20}px`
    textarea.style.fontSize = `${node.font_size * scale}px`
    textarea.style.fontFamily = node.font_family
    textarea.style.color = node.fill
    textarea.style.border = '2px solid #F8E5E7'
    textarea.style.borderRadius = '2px'
    textarea.style.padding = '2px 4px'
    textarea.style.margin = '0'
    textarea.style.overflow = 'hidden'
    textarea.style.background = 'white'
    textarea.style.outline = 'none'
    textarea.style.resize = 'none'
    textarea.style.lineHeight = '1.2'
    textarea.style.zIndex = '100'

    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()

    const finish = () => {
      const newContent = textarea.value || 'Text'
      updateNode(node.id, { content: newContent })
      textarea.remove()
    }

    textarea.addEventListener('blur', finish)
    textarea.addEventListener('keydown', (ke) => {
      if (ke.key === 'Escape') textarea.blur()
      if (ke.key === 'Enter' && !ke.shiftKey) { ke.preventDefault(); textarea.blur() }
    })
  }, [updateNode])

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

      {/* Canvas — the white look area */}
      <div className="flex-1 flex items-center justify-center pb-4">
        <div
          className="relative border border-border rounded bg-white shadow-sm"
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
          onTap={(e) => { if (e.target === e.target.getStage()) setSelectedNodeIds([]) }}
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
                    onSelect={(e) => handleNodeSelect(node.id, e)}
                    onDragEnd={(x, y) => {
                      const updates = fromKonvaDrag(cNode, x, y)
                      updateNode(node.id, updates)
                    }}
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
                    onSelect={(e) => handleNodeSelect(node.id, e)}
                    onDragEnd={(x, y) => updateNode(node.id, { x, y })}
                    onDblClick={() => handleTextDblClick(tNode)}
                    onResize={(width) => updateNode(node.id, { width })}
                  />
                )
              }
              return null
            })}
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
