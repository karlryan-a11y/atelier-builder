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

const CANVAS_W = 1200
const CANVAS_H = 1500

// Look Frame: the exportable region. Items should be arranged within this area.
// Everything outside is workspace. Export captures only the frame.
// SQUARE (1:1) look frame to match GoodPix look images (1080×1080 / 1600×1600).
// Must match the frame in compose.ts.
export const FRAME_X = 60
export const FRAME_Y = 210
export const FRAME_W = 1080
export const FRAME_H = 1080

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
}

function TextNodeElement({ node, isSelected, onSelect, onDragEnd, onDblClick }: TextNodeProps) {
  const textRef = useRef<Konva.Text>(null)
  const transformerRef = useRef<Konva.Transformer>(null)

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
        fill={node.fill}
        rotation={node.rotation}
        draggable
        onClick={onSelect}
        onTap={onSelect}
        onDblClick={onDblClick}
        onDblTap={onDblClick}
        onDragEnd={(e) => onDragEnd(e.target.x(), e.target.y())}
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

  // Register the Konva native export function so ChatPanel can call it.
  // Crops to content bounds WITHIN the frame — tight around items, never exceeds frame.
  useEffect(() => {
    registerCanvasExport((opts) => {
      const stage = stageRef.current
      if (!stage) return null
      if (store.state.nodes.length === 0) return null

      const pixelRatio = opts?.pixelRatio ?? 2

      // Hide UI elements during export
      const transformers = stage.find('Transformer')
      transformers.forEach((t: any) => t.hide())
      const allRects = stage.find('Rect')
      const hiddenRects: any[] = []
      allRects.forEach((rect: any) => {
        const attrs = rect.attrs
        if (attrs.dash && attrs.x === FRAME_X && attrs.y === FRAME_Y) { rect.hide(); hiddenRects.push(rect) }
        if (attrs.fill === 'rgba(0,0,0,0.03)') { rect.hide(); hiddenRects.push(rect) }
      })
      const lines = stage.find('Line')
      lines.forEach((l: any) => l.hide())

      // The on-screen stage is rendered at a reduced scale (Stage scaleX/Y below).
      // toDataURL applies that scale to the drawn content but interprets the crop
      // rect in post-scale pixels — so cropping the frame while scaled yields a
      // shrunken, corner-offset image. Reset the stage to 1:1 / full size for the
      // capture so the frame exports at full resolution, then restore.
      const prevScaleX = stage.scaleX()
      const prevScaleY = stage.scaleY()
      const prevWidth = stage.width()
      const prevHeight = stage.height()
      stage.scale({ x: 1, y: 1 })
      stage.size({ width: CANVAS_W, height: CANVAS_H })

      try {
        // Content-aware SQUARE crop: tightly frame the actual items + brand
        // labels, then expand to a 1:1 square (matching GoodPix's square look
        // images) with a uniform margin. This makes every saved look fill its
        // lookbook card cleanly, regardless of item count or how the Style
        // engine placed things. Falls back to the full frame if no content.
        const contentNodes = [...stage.find('Image'), ...stage.find('Text')]
          .filter((n: any) => n.visible())

        let cropX = FRAME_X
        let cropY = FRAME_Y
        let cropSide = FRAME_W

        if (contentNodes.length > 0) {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
          for (const n of contentNodes) {
            const r = (n as any).getClientRect({ relativeTo: stage })
            if (!r || r.width === 0 || r.height === 0) continue
            minX = Math.min(minX, r.x)
            minY = Math.min(minY, r.y)
            maxX = Math.max(maxX, r.x + r.width)
            maxY = Math.max(maxY, r.y + r.height)
          }
          if (isFinite(minX)) {
            const contentW = maxX - minX
            const contentH = maxY - minY
            const cx = (minX + maxX) / 2
            const cy = (minY + maxY) / 2
            // Square side = larger content dimension + ~8% margin each side,
            // clamped to the canvas.
            cropSide = Math.min(Math.max(contentW, contentH) * 1.16, CANVAS_W, CANVAS_H)
            cropX = Math.max(0, Math.min(cx - cropSide / 2, CANVAS_W - cropSide))
            cropY = Math.max(0, Math.min(cy - cropSide / 2, CANVAS_H - cropSide))
          }
        }

        return stage.toDataURL({
          x: cropX,
          y: cropY,
          width: cropSide,
          height: cropSide,
          pixelRatio,
          mimeType: 'image/png',
        })
      } finally {
        stage.scale({ x: prevScaleX, y: prevScaleY })
        stage.size({ width: prevWidth, height: prevHeight })
        stage.batchDraw()
        transformers.forEach((t: any) => t.show())
        hiddenRects.forEach((r: any) => r.show())
        lines.forEach((l: any) => l.show())
      }
    })

    return () => unregisterCanvasExport()
  }, [store.state.nodes])

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
    for (let i = step; i < CANVAS_W; i += step) {
      lines.push(
        <Line key={`gv${i}`} points={[i, 0, i, CANVAS_H]} stroke="#E8E4DF" strokeWidth={0.5} listening={false} />
      )
    }
    for (let i = step; i < CANVAS_H; i += step) {
      lines.push(
        <Line key={`gh${i}`} points={[0, i, CANVAS_W, i]} stroke="#E8E4DF" strokeWidth={0.5} listening={false} />
      )
    }
    return lines
  }, [showGrid])

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
          style={{ width: CANVAS_W * 0.45, height: CANVAS_H * 0.45 }}
        >
        <Stage
          ref={stageRef}
          width={CANVAS_W * 0.45}
          height={CANVAS_H * 0.45}
          scaleX={0.45}
          scaleY={0.45}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onTap={(e) => { if (e.target === e.target.getStage()) setSelectedNodeIds([]) }}
          style={{ background: state.canvas.background, borderRadius: '4px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
        >
          <Layer>
            <Rect
              x={0}
              y={0}
              width={CANVAS_W}
              height={CANVAS_H}
              fill={state.canvas.background}
              listening={false}
            />
            {/* Look Frame — subtle boundary showing the export area */}
            {/* Dim area outside the frame */}
            <Rect x={0} y={0} width={CANVAS_W} height={FRAME_Y} fill="rgba(0,0,0,0.03)" listening={false} />
            <Rect x={0} y={FRAME_Y + FRAME_H} width={CANVAS_W} height={CANVAS_H - FRAME_Y - FRAME_H} fill="rgba(0,0,0,0.03)" listening={false} />
            <Rect x={0} y={FRAME_Y} width={FRAME_X} height={FRAME_H} fill="rgba(0,0,0,0.03)" listening={false} />
            <Rect x={FRAME_X + FRAME_W} y={FRAME_Y} width={CANVAS_W - FRAME_X - FRAME_W} height={FRAME_H} fill="rgba(0,0,0,0.03)" listening={false} />
            {/* Frame border — subtle dashed line */}
            <Rect
              x={FRAME_X} y={FRAME_Y} width={FRAME_W} height={FRAME_H}
              stroke="#E8E4DF" strokeWidth={1.5} dash={[8, 6]}
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
