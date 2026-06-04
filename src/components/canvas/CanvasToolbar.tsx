import { useState } from 'react'
import {
  Trash2, FlipHorizontal, Lock, Unlock, RotateCcw,
  Copy, ChevronUp, ChevronDown, Type, Undo2, Redo2,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
  AlignStartVertical, AlignEndVertical, AlignStartHorizontal, AlignEndHorizontal,
  Sparkles, FilePlus,
} from 'lucide-react'
import { useCanvasStore } from '@/stores/canvasStore'
import { styleCanvas } from '@/lib/style'
import type { ClosetItemNode, TextNode } from '@/types/canvas'

const FONT_FAMILIES = [
  { value: 'Helvetica Neue, Helvetica, Arial, sans-serif', label: 'Sans Serif' },
  { value: 'Georgia, Times New Roman, serif', label: 'Serif' },
  { value: "'Great Vibes', cursive", label: 'Handwriting' },
  { value: 'Courier New, monospace', label: 'Mono' },
]

const FONT_SIZES = [12, 16, 20, 24, 32, 40, 48, 64, 80, 96]

const TEXT_COLORS = [
  '#1A1A1A', '#FFFFFF', '#F8E5E7', '#9B8B7E',
  '#C4A882', '#8B0000', '#000080', '#2F4F4F',
]

export function CanvasToolbar() {
  const {
    state, selectedNodeIds, updateNode, removeNodes, duplicateNodes,
    moveLayer, addNode, undo, redo, past, future, alignNodes, distributeNodes,
    isDirty, reset,
  } = useCanvasStore()
  const [styling, setStyling] = useState(false)

  const selectedNodes = selectedNodeIds
    .map((id) => state.nodes.find((n) => n.id === id))
    .filter(Boolean)

  const singleNode = selectedNodes.length === 1 ? selectedNodes[0] : null
  const hasSelection = selectedNodes.length > 0

  const hasClosetItems = state.nodes.some((n) => n.type === 'closet_item')

  const handleStyle = async () => {
    if (styling || !hasClosetItems) return
    setStyling(true)
    try {
      const store = useCanvasStore.getState()
      const result = await styleCanvas(store.state.nodes, store.imageUrls)

      // Clear canvas and re-add all nodes with their image URLs.
      // This ensures each new node ID gets the correct image URL mapping.
      store.setCanvasState({
        ...store.state,
        nodes: [],
      })
      for (const node of result.nodes) {
        const url = result.imageUrls[node.id] ?? undefined
        store.addNode(node, url)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      alert(`Style failed: ${message}`)
    } finally {
      setStyling(false)
    }
  }

  const handleAddText = () => {
    const node: TextNode = {
      id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'text',
      content: 'Text',
      font_family: FONT_FAMILIES[0].value,
      font_size: 32,
      fill: '#1A1A1A',
      x: 600,
      y: 750,
      rotation: 0,
      z_index: state.nodes.length,
    }
    addNode(node)
    useCanvasStore.getState().setSelectedNodeIds([node.id])
  }

  return (
    <div className="flex items-center gap-1 bg-white border border-border rounded-sm shadow-sm px-2 py-1">
      <button
        onClick={() => {
          if (isDirty && !confirm('You have unsaved changes. Start a new look?')) return
          reset()
        }}
        className="p-1.5 hover:bg-tile rounded-sm transition-colors"
        title="New Look"
      >
        <FilePlus className="h-3.5 w-3.5 text-text-muted" />
      </button>

      <div className="w-px h-4 bg-border mx-0.5" />

      <button
        onClick={() => undo()}
        disabled={past.length === 0}
        className="p-1.5 hover:bg-tile rounded-sm transition-colors disabled:opacity-30"
        title="Undo (⌘Z)"
      >
        <Undo2 className="h-3.5 w-3.5 text-text-muted" />
      </button>
      <button
        onClick={() => redo()}
        disabled={future.length === 0}
        className="p-1.5 hover:bg-tile rounded-sm transition-colors disabled:opacity-30"
        title="Redo (⇧⌘Z)"
      >
        <Redo2 className="h-3.5 w-3.5 text-text-muted" />
      </button>

      <div className="w-px h-4 bg-border mx-0.5" />

      <button
        onClick={handleAddText}
        className="p-1.5 hover:bg-tile rounded-sm transition-colors"
        title="Add text"
      >
        <Type className="h-3.5 w-3.5 text-text-muted" />
      </button>

      <button
        onClick={handleStyle}
        disabled={styling || !hasClosetItems}
        className="p-1.5 hover:bg-tile rounded-sm transition-colors disabled:opacity-30"
        title="Style — auto-arrange items with WSG proportions"
      >
        {styling ? (
          <Sparkles className="h-3.5 w-3.5 text-blush animate-pulse" />
        ) : (
          <Sparkles className="h-3.5 w-3.5 text-text-muted" />
        )}
      </button>

      {singleNode?.type === 'text' && (() => {
        const tn = singleNode as TextNode
        return (
          <>
            <div className="w-px h-4 bg-border mx-0.5" />
            <select
              value={tn.font_family}
              onChange={(e) => updateNode(tn.id, { font_family: e.target.value })}
              className="text-[10px] bg-tile rounded-sm px-1.5 py-1 border-none outline-none cursor-pointer max-w-[100px]"
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            <select
              value={tn.font_size}
              onChange={(e) => updateNode(tn.id, { font_size: Number(e.target.value) })}
              className="text-[10px] bg-tile rounded-sm px-1.5 py-1 border-none outline-none cursor-pointer w-12"
            >
              {FONT_SIZES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <div className="flex items-center gap-0.5 ml-1">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => updateNode(tn.id, { fill: c })}
                  className={`w-4 h-4 rounded-full border transition-transform ${
                    tn.fill === c ? 'border-blush scale-125' : 'border-border'
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </>
        )
      })()}

      {hasSelection && (
        <>
          <div className="w-px h-4 bg-border mx-0.5" />

          {singleNode?.type === 'closet_item' && (
            <button
              onClick={() => {
                const item = singleNode as ClosetItemNode
                updateNode(item.id, { flipped: !item.flipped })
              }}
              className="p-1.5 hover:bg-tile rounded-sm transition-colors"
              title="Flip horizontal"
            >
              <FlipHorizontal className="h-3.5 w-3.5 text-text-muted" />
            </button>
          )}

          {singleNode && 'rotation' in singleNode && (
            <button
              onClick={() => updateNode(singleNode.id, { rotation: (((singleNode as { rotation: number }).rotation) + 90) % 360 })}
              className="p-1.5 hover:bg-tile rounded-sm transition-colors"
              title="Rotate 90°"
            >
              <RotateCcw className="h-3.5 w-3.5 text-text-muted" />
            </button>
          )}

          <button
            onClick={() => moveLayer(selectedNodeIds, 'up')}
            className="p-1.5 hover:bg-tile rounded-sm transition-colors"
            title="Bring forward"
          >
            <ChevronUp className="h-3.5 w-3.5 text-text-muted" />
          </button>
          <button
            onClick={() => moveLayer(selectedNodeIds, 'down')}
            className="p-1.5 hover:bg-tile rounded-sm transition-colors"
            title="Send backward"
          >
            <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
          </button>

          <button
            onClick={() => duplicateNodes(selectedNodeIds)}
            className="p-1.5 hover:bg-tile rounded-sm transition-colors"
            title="Duplicate (⌘D)"
          >
            <Copy className="h-3.5 w-3.5 text-text-muted" />
          </button>

          {selectedNodes.length >= 2 && (
            <>
              <div className="w-px h-4 bg-border mx-0.5" />
              <button onClick={() => alignNodes(selectedNodeIds, 'left')} className="p-1.5 hover:bg-tile rounded-sm transition-colors" title="Align left">
                <AlignStartVertical className="h-3.5 w-3.5 text-text-muted" />
              </button>
              <button onClick={() => alignNodes(selectedNodeIds, 'right')} className="p-1.5 hover:bg-tile rounded-sm transition-colors" title="Align right">
                <AlignEndVertical className="h-3.5 w-3.5 text-text-muted" />
              </button>
              <button onClick={() => alignNodes(selectedNodeIds, 'top')} className="p-1.5 hover:bg-tile rounded-sm transition-colors" title="Align top">
                <AlignStartHorizontal className="h-3.5 w-3.5 text-text-muted" />
              </button>
              <button onClick={() => alignNodes(selectedNodeIds, 'bottom')} className="p-1.5 hover:bg-tile rounded-sm transition-colors" title="Align bottom">
                <AlignEndHorizontal className="h-3.5 w-3.5 text-text-muted" />
              </button>
              {selectedNodes.length >= 3 && (
                <>
                  <button onClick={() => distributeNodes(selectedNodeIds, 'horizontal')} className="p-1.5 hover:bg-tile rounded-sm transition-colors" title="Distribute horizontally">
                    <AlignHorizontalDistributeCenter className="h-3.5 w-3.5 text-text-muted" />
                  </button>
                  <button onClick={() => distributeNodes(selectedNodeIds, 'vertical')} className="p-1.5 hover:bg-tile rounded-sm transition-colors" title="Distribute vertically">
                    <AlignVerticalDistributeCenter className="h-3.5 w-3.5 text-text-muted" />
                  </button>
                </>
              )}
            </>
          )}

          {singleNode?.type === 'closet_item' && (
            <button
              onClick={() => {
                const item = singleNode as ClosetItemNode
                updateNode(item.id, { locked: !item.locked })
              }}
              className="p-1.5 hover:bg-tile rounded-sm transition-colors"
              title={(singleNode as ClosetItemNode).locked ? 'Unlock' : 'Lock'}
            >
              {(singleNode as ClosetItemNode).locked ? (
                <Lock className="h-3.5 w-3.5 text-blush" />
              ) : (
                <Unlock className="h-3.5 w-3.5 text-text-muted" />
              )}
            </button>
          )}

          <div className="w-px h-4 bg-border mx-0.5" />

          <button
            onClick={() => removeNodes(selectedNodeIds)}
            className="p-1.5 hover:bg-red-50 rounded-sm transition-colors"
            title="Delete (⌫)"
          >
            <Trash2 className="h-3.5 w-3.5 text-red-400" />
          </button>
        </>
      )}
    </div>
  )
}
