import { useEffect, useRef, useState } from 'react'
import {
  Trash2, FlipHorizontal, Lock, Unlock, RotateCcw,
  Copy, ChevronUp, ChevronDown, Type, Undo2, Redo2,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
  AlignStartVertical, AlignEndVertical, AlignStartHorizontal, AlignEndHorizontal,
  Sparkles, FilePlus, Bold, Underline, AlignCenter,
  Eraser, BringToFront, SendToBack, Loader2, EyeOff, ImagePlus,
} from 'lucide-react'
import { useCanvasStore } from '@/stores/canvasStore'
import { supabase } from '@/lib/supabase'
import { styleFromPastLooks } from '@/lib/style'
import { useClientStore } from '@/stores/clientStore'
import type { CanvasNode, ClosetItemNode, PictureNode, TextNode } from '@/types/canvas'
import { addPictureFilesToBoard, removePictureBackground } from '@/lib/addPicture'
import { r2KeyOf } from '@/lib/imageUrls'
import { BOARD_PRESETS } from '@/types/canvas'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

// Amalfi Coast (the WSG brand script) is the default for every new label — first in the list
// and used by handleAddText below, so manual labels match the AI-composed brand labels.
const DEFAULT_FONT = "'Amalfi Coast', cursive"
const FONT_FAMILIES = [
  { value: DEFAULT_FONT, label: 'Amalfi Coast' },
  { value: "'Neue Haas', 'Helvetica Neue', Arial, sans-serif", label: 'Neue Haas' },
  { value: "'Schnyder', Georgia, serif", label: 'Schnyder' },
  { value: 'Helvetica Neue, Helvetica, Arial, sans-serif', label: 'Sans Serif' },
  { value: "'Playfair Display SC', serif", label: 'Playfair SC' },
  { value: "'Playfair Display', serif", label: 'Playfair' },
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
    state, selectedNodeIds, setNodeImageUrl, addNode, undo, redo, past, future,
    isDirty, reset, setCanvasSize, lastTextStyle, requestTextEdit,
  } = useCanvasStore()
  const [styling, setStyling] = useState(false)
  // ✨ steps through real looks with the same mix: the same pieces pressed again = the next look.
  const [styleRun, setStyleRun] = useState<{ key: string; attempt: number; note: string; short: string } | null>(null)
  const activeClientId = useClientStore((st) => st.activeClient?.id ?? null)
  const [removingBg, setRemovingBg] = useState(false)
  // ADD AN IMAGE (ADR-0171). Cynthia's tied-scarf photo: her own picture on the board, never a piece.
  const fileRef = useRef<HTMLInputElement>(null)
  const [addingPicture, setAddingPicture] = useState(false)
  async function handlePictureFiles(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (fileRef.current) fileRef.current.value = ''
    if (!files.length || addingPicture) return
    setAddingPicture(true)
    try { await addPictureFilesToBoard(files, activeClientId) } finally { setAddingPicture(false) }
  }
  // Remove background on an ADDED picture: a new transparent copy, the node points at it. Nothing
  // else changes, and Undo puts the original back.
  async function handleRemovePictureBg(node: PictureNode) {
    if (removingBg) return
    const key = r2KeyOf(node.src)
    if (!key || !key.startsWith('looks/pictures/')) { alert('Remove background works on pictures you added with Add image.'); return }
    setRemovingBg(true)
    try {
      const url = await removePictureBackground(key)
      useCanvasStore.getState().updateNode(node.id, { src: url } as Partial<PictureNode>)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not remove the background.')
    } finally {
      setRemovingBg(false)
    }
  }
  // HIDING SAYS WHERE IT WENT (ADR-0171). Cynthia, 9/23: "when I click the hide button, it doesn't
  // unhide it." A hidden piece is not drawn, so it cannot be selected to un-hide; it comes back from
  // the In this look panel. Say so the moment she hides it, with an Undo.
  const [hiddenNote, setHiddenNote] = useState<string | null>(null)
  useEffect(() => {
    if (!hiddenNote) return
    const t = setTimeout(() => setHiddenNote(null), 12000)
    return () => clearTimeout(t)
  }, [hiddenNote])

  // Remove a canvas item's background → transparent (Photoroom via intake-remove-bg-item),
  // so an opaque white-background piece stops blocking the rest of the look. Persists to the
  // closet item (fixes it everywhere) and swaps the image on the board in place.
  async function handleRemoveBg(node: ClosetItemNode) {
    if (removingBg) return
    setRemovingBg(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const currentUrl = useCanvasStore.getState().imageUrls[node.id]
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-remove-bg-item`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: node.closet_item_id, image_url: currentUrl }),
      })
      const d = await resp.json().catch(() => ({}))
      if (!resp.ok || !d?.ok || !d?.url) { alert(d?.reason || d?.error || 'Could not remove the background.'); return }
      setNodeImageUrl(node.id, d.url)
    } catch {
      alert('Failed to remove background — try again.')
    } finally {
      setRemovingBg(false)
    }
  }

  const selectedNodes = selectedNodeIds
    .map((id) => state.nodes.find((n) => n.id === id))
    .filter((n): n is CanvasNode => !!n)

  const hasSelection = selectedNodes.length > 0

  const hasClosetItems = state.nodes.some((n) => n.type === 'closet_item')

  // ✨ (ADR-0128). Arranges the pieces like a real look the team styled with the same mix of
  // pieces, her own looks first, and labels only brands saved on the pieces. It never deletes:
  // text and pictures stay, notes travel with their piece, and the whole change is ONE undo step.
  const handleStyle = async () => {
    if (styling || !hasClosetItems) return
    setStyling(true)
    try {
      const store = useCanvasStore.getState()
      const pieceKey = store.state.nodes.filter((n) => n.type === 'closet_item')
        .map((n) => (n as ClosetItemNode).closet_item_id).sort().join(',')
      const attempt = styleRun && styleRun.key === pieceKey ? styleRun.attempt + 1 : 0
      const displayOf = (id: string) => {
        const n = store.state.nodes.find((x) => x.id === id) as ClosetItemNode | undefined
        const d = store.nodeDims[id]
        if (!n || !d || !d.h) return null
        const h = n.target_height ?? d.h * Math.abs(n.scale_y ?? n.scale)
        return { w: (d.w / d.h) * h, h }
      }
      const r = await styleFromPastLooks({
        nodes: store.state.nodes, board: store.state.canvas, clientId: activeClientId,
        attempt, displayOf, imageUrls: store.imageUrls,
      })
      store.setCanvasState({ ...store.state, nodes: r.nodes })
      const note = r.template
        ? `Arranged like ${r.template.look_name ?? 'a past look'}${r.sameClient ? ' (hers)' : ''}, option ${r.option + 1} of ${r.of}. Press again for another.`
        : 'No past look has these pieces, so the standard arrangement was used.'
      const short = r.template ? `${r.option + 1}/${r.of}` : 'standard'
      setStyleRun({ key: pieceKey, attempt, note, short })
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
      // Font ALWAYS starts as Amalfi Coast (the brand script) — a stylist can still change a
      // specific label from the dropdown. Size still reuses the last one the stylist chose.
      font_family: DEFAULT_FONT,
      font_size: lastTextStyle?.font_size ?? 32,
      fill: '#1A1A1A',
      x: 600,
      y: 750,
      rotation: 0,
      z_index: state.nodes.length,
    }
    addNode(node)
    useCanvasStore.getState().setSelectedNodeIds([node.id])
    // Open the inline editor immediately with the placeholder selected → just start typing.
    requestTextEdit(node.id)
  }

  return (
    <div data-canvas-toolbar className="w-full flex flex-col gap-1 bg-white border border-border rounded-sm shadow-sm px-2 py-1">
    <div data-toolbar-base className="flex flex-wrap items-center justify-center gap-1">
      {/* Board size — Portrait (look) / Square / Landscape */}
      {(Object.keys(BOARD_PRESETS) as Array<keyof typeof BOARD_PRESETS>).map((key) => {
        const p = BOARD_PRESETS[key]
        const active = state.canvas.width === p.width && state.canvas.height === p.height
        return (
          <button
            key={key}
            onClick={() => setCanvasSize(p.width, p.height)}
            title={`${p.label} board (${p.width}×${p.height})`}
            className={`px-2 py-1 text-[9px] tracking-[0.12em] uppercase rounded-sm transition-colors ${active ? 'bg-[#1A1A1A] text-white' : 'text-text-muted hover:bg-tile'}`}
          >{p.label}</button>
        )
      })}
      <div className="w-px h-4 bg-border mx-0.5" />

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
        onClick={() => fileRef.current?.click()}
        disabled={addingPicture}
        className="p-1.5 hover:bg-tile rounded-sm transition-colors disabled:opacity-40"
        title="Add image: put your own photo on the board (for example a scarf tied the way it is worn). You can also drop a photo on the board."
        aria-label="Add image"
      >
        {addingPicture ? <Loader2 className="h-3.5 w-3.5 text-text-muted animate-spin" /> : <ImagePlus className="h-3.5 w-3.5 text-text-muted" />}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="hidden"
        data-add-image-input
        onChange={(e) => void handlePictureFiles(e.target.files)}
      />

      <button
        onClick={handleStyle}
        disabled={styling || !hasClosetItems}
        className="p-1.5 hover:bg-tile rounded-sm transition-colors disabled:opacity-30"
        title={styleRun?.note ?? 'Style: arrange the pieces and brand labels like a past look. Nothing is deleted.'}
      >
        {styling ? (
          <Sparkles className="h-3.5 w-3.5 text-blush animate-pulse" />
        ) : (
          <Sparkles className="h-3.5 w-3.5 text-text-muted" />
        )}
      </button>
      {/* A fixed slot, so pressing Style never re-wraps this row and moves the board. */}
      <span className="w-12 truncate text-center text-[10px] tabular-nums text-text-muted whitespace-nowrap" title={styleRun?.note}>{styleRun?.short ?? ''}</span>
    </div>

      {/*
        THE BOARD HOLDS STILL. Cynthia Dada, 2026-09-25: "Can you please fix this auto zoom that's
        happening? It messes up when I'm trying to move text." The board is fitted to the space
        under this toolbar, so a toolbar that grows when she selects something shrinks the board
        under her cursor, on the press. This strip is therefore always as tall as the TALLEST set
        of controls any selection can show at this width: each of those sets is drawn here,
        invisible and inert, in the same grid cell as the real one. Its height depends on the
        width alone. The controls are one component, so a new button reserves its own room.
        Measured by `node scripts/perf/style-harness.mjs --steady-board` (WebKit, three sizes).
      */}
      <div data-toolbar-context className="grid border-t border-border pt-1">
        {SIZERS.map((nodes, i) => (
          <div key={i} aria-hidden="true" inert className="invisible [grid-area:1/1] flex flex-wrap items-center justify-center gap-1">
            <SelectionControls nodes={nodes} removingBg={false} onRemoveBg={() => {}} onRemovePictureBg={() => {}} onHid={() => {}} />
          </div>
        ))}
        <div className="[grid-area:1/1] flex flex-wrap items-center justify-center gap-1">
          {hasSelection ? (
            <SelectionControls nodes={selectedNodes} removingBg={removingBg} onRemoveBg={handleRemoveBg} onRemovePictureBg={handleRemovePictureBg} onHid={setHiddenNote} />
          ) : hiddenNote ? (
            <span data-hidden-note className="text-[10px] tracking-wide text-text-muted">
              {hiddenNote} hidden. It is still in the look. Bring it back with the eye in In this look on the right.
              <button onClick={() => { undo(); setHiddenNote(null) }} className="ml-2 underline text-[#1A1A1A]">Undo</button>
            </span>
          ) : (
            <span className="text-[10px] tracking-wide text-text-muted">Select a piece or a label to edit it</span>
          )}
        </div>
      </div>
    </div>
  )
}

// The largest control sets a selection can bring up, used only to reserve the context strip's
// height (see data-toolbar-context). Stand-in nodes: never drawn, never on the board.
const SIZER_TEXT: TextNode = { id: 'sizer_text', type: 'text', content: '', font_family: DEFAULT_FONT, font_size: 32, fill: '#1A1A1A', x: 0, y: 0, rotation: 0, z_index: 0 }
const SIZER_PIECE: ClosetItemNode = { id: 'sizer_piece', type: 'closet_item', closet_item_id: '', x: 0, y: 0, scale: 1, rotation: 0, flipped: false, z_index: 0, locked: false }
const SIZER_PICTURE: PictureNode = { id: 'sizer_picture', type: 'picture', src: '', x: 0, y: 0, width: 1, height: 1, rotation: 0, flipped: false, z_index: 0, locked: false }
const SIZERS: CanvasNode[][] = [
  [SIZER_TEXT],
  [SIZER_PIECE],
  [SIZER_PIECE, { ...SIZER_PIECE, id: 'sizer_piece_2' }, { ...SIZER_PIECE, id: 'sizer_piece_3' }],
  [SIZER_PICTURE],
]

/** Everything that acts on the current selection. Drawn for real, and as the strip's sizers. */
function SelectionControls({ nodes, removingBg, onRemoveBg, onRemovePictureBg, onHid }: {
  nodes: CanvasNode[]
  removingBg: boolean
  onRemoveBg: (node: ClosetItemNode) => void
  onRemovePictureBg: (node: PictureNode) => void
  onHid: (pieceName: string) => void
}) {
  const { updateNode, removeNodes, duplicateNodes, moveLayer, flipNodes, alignNodes, distributeNodes, rememberTextStyle } = useCanvasStore()
  const selectedNodes = nodes
  const selectedNodeIds = nodes.map((n) => n.id)
  const singleNode = nodes.length === 1 ? nodes[0] : null
  const hasSelection = nodes.length > 0
  const selectedClosetItems = nodes.filter((n): n is ClosetItemNode => n.type === 'closet_item')
  const handleRemoveBg = onRemoveBg

  return (
    <>
      {singleNode?.type === 'text' && (() => {
        const tn = singleNode as TextNode
        return (
          <>
            <select
              value={tn.font_family}
              onChange={(e) => { updateNode(tn.id, { font_family: e.target.value }); rememberTextStyle({ font_family: e.target.value, font_size: tn.font_size }) }}
              className="text-[10px] bg-tile rounded-sm px-1.5 py-1 border-none outline-none cursor-pointer max-w-[100px]"
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            <select
              value={tn.font_size}
              onChange={(e) => { updateNode(tn.id, { font_size: Number(e.target.value) }); rememberTextStyle({ font_family: tn.font_family, font_size: Number(e.target.value) }) }}
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

            <div className="w-px h-4 bg-border mx-0.5" />
            <button
              onClick={() => updateNode(tn.id, { bold: !tn.bold })}
              className={`p-1.5 rounded-sm transition-colors ${tn.bold ? 'bg-[#1A1A1A] text-white' : 'hover:bg-tile text-text-muted'}`}
              title="Bold"
            >
              <Bold className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => updateNode(tn.id, { underline: !tn.underline })}
              className={`p-1.5 rounded-sm transition-colors ${tn.underline ? 'bg-[#1A1A1A] text-white' : 'hover:bg-tile text-text-muted'}`}
              title="Underline"
            >
              <Underline className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => updateNode(tn.id, { align: tn.align === 'center' ? 'left' : 'center' })}
              className={`p-1.5 rounded-sm transition-colors ${tn.align === 'center' ? 'bg-[#1A1A1A] text-white' : 'hover:bg-tile text-text-muted'}`}
              title="Center"
            >
              <AlignCenter className="h-3.5 w-3.5" />
            </button>
          </>
        )
      })()}

      {hasSelection && (
        <>
          {singleNode?.type === 'text' && <div className="w-px h-4 bg-border mx-0.5" />}

          {selectedClosetItems.length > 0 && (
            <button
              onClick={() => flipNodes(selectedClosetItems.map((it) => it.id))}
              className="p-1.5 hover:bg-tile rounded-sm transition-colors"
              title={selectedClosetItems.length > 1 ? `Flip ${selectedClosetItems.length} items horizontally (F)` : 'Flip horizontal (F)'}
            >
              <FlipHorizontal className="h-3.5 w-3.5 text-text-muted" />
            </button>
          )}

          {/*
            OFF THE BOARD, STILL IN THE LOOK. ADR-0146. Cynthia Dada, 2026-09-23: "I need to add
            an image of this scarf tied around the waist but need to keep the item on the board
            invisible so it's still linked to this look." Hiding is not deleting: the piece stays
            in the look, so the client still sees it under Pieces in this look and can still shop
            it. It comes back from the In this look panel, which is the only place a thing you
            cannot see can be found again.
          */}
          {singleNode?.type === 'closet_item' && (
            <button
              onClick={() => { updateNode(singleNode.id, { hidden: true } as Partial<ClosetItemNode>); useCanvasStore.getState().setSelectedNodeIds([]); onHid('Piece') }}
              className="p-1.5 hover:bg-tile rounded-sm transition-colors"
              title="Hide on the board — the piece stays in the look and she can still shop it"
            >
              <EyeOff className="h-3.5 w-3.5 text-text-muted" />
            </button>
          )}

          {singleNode?.type === 'closet_item' && (
            <button
              onClick={() => handleRemoveBg(singleNode as ClosetItemNode)}
              disabled={removingBg}
              className="p-1.5 hover:bg-tile rounded-sm transition-colors disabled:opacity-40"
              title="Remove background — make this piece transparent so it stops blocking the look"
            >
              {removingBg ? <Loader2 className="h-3.5 w-3.5 text-text-muted animate-spin" /> : <Eraser className="h-3.5 w-3.5 text-text-muted" />}
            </button>
          )}

          {singleNode?.type === 'picture' && (
            <button
              onClick={() => onRemovePictureBg(singleNode as PictureNode)}
              disabled={removingBg}
              className="p-1.5 hover:bg-tile rounded-sm transition-colors disabled:opacity-40"
              title="Remove background from this picture (pictures you added with Add image)"
              aria-label="Remove background from this picture"
            >
              {removingBg ? <Loader2 className="h-3.5 w-3.5 text-text-muted animate-spin" /> : <Eraser className="h-3.5 w-3.5 text-text-muted" />}
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
            onClick={() => moveLayer(selectedNodeIds, 'top')}
            className="p-1.5 hover:bg-tile rounded-sm transition-colors"
            title="Bring to front"
          >
            <BringToFront className="h-3.5 w-3.5 text-text-muted" />
          </button>
          <button
            onClick={() => moveLayer(selectedNodeIds, 'bottom')}
            className="p-1.5 hover:bg-tile rounded-sm transition-colors"
            title="Send to back"
          >
            <SendToBack className="h-3.5 w-3.5 text-text-muted" />
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
    </>
  )
}
