import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Send, Save, FilePlus, Loader2, Check, ChevronRight } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useCanvasStore, exportCanvasImage, settleCanvasTransforms } from '@/stores/canvasStore'
import { useClientStore } from '@/stores/clientStore'
import { useAuth } from '@/hooks/useAuth'
import { useLooks } from '@/hooks/useLooks'
import { useCapsules } from '@/hooks/useCapsules'
import { supabase } from '@/lib/supabase'
import { resolveClosetImageUrls } from '@/lib/resolveClosetImageUrls'
import { readLookFiling, applyLookFiling } from '@/lib/lookFiling'
import { LookGallery } from '@/components/canvas/LookGallery'
import { SaveLookDialog } from '@/components/canvas/SaveLookDialog'
import { CreateCapsuleDialog } from '@/components/canvas/CreateCapsuleDialog'
import { SaveAsCapsuleDialog } from '@/components/canvas/SaveAsCapsuleDialog'
import { AddLooksDialog } from '@/components/canvas/AddLooksDialog'
import { addLooksToCapsuleBoard, isCapsuleBoard } from '@/lib/capsuleLooks'
import { lookIdsOnBoard } from '@/lib/capsuleLayout'
import {
  runComposePipeline,
  resolveDisambiguation,
  allResolved,
  pickLayout,
  composeNodes,
  type ComposeMessage,
  type ResolvedItem,
  type CompositionPlan,
} from '@/lib/compose'
import type { ClosetItem } from '@/lib/images'
import type { LookCanvasState, ClosetItemNode } from '@/types/canvas'
import type { LookRow } from '@/hooks/useLooks'

type Tab = 'looks' | 'compose'

export function ChatPanel() {
  const [tab, setTab] = useState<Tab>('looks')
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saving, setSaving] = useState(false)
  const { user } = useAuth()
  const { activeClient } = useClientStore()
  // Narrow, shallow-compared subscription: a tap or drag on the board changes neither of these,
  // so it no longer re-renders this panel and its looks gallery. `nodes` changes only when a
  // piece is added, removed or moved.
  const { currentLookId, replacesLookId, replacesSiblingLookIds, restyleReference, currentCapsuleId, replacesCapsuleId, buildingCapsule, isDirty, loadLook, loadLookAsNew, reset, markClean, noteSavedAs, noteSavedCapsuleAs, addNode } = useCanvasStore(useShallow((s) => ({
    currentLookId: s.currentLookId, replacesLookId: s.replacesLookId, replacesSiblingLookIds: s.replacesSiblingLookIds, restyleReference: s.restyleReference,
    currentCapsuleId: s.currentCapsuleId, replacesCapsuleId: s.replacesCapsuleId, buildingCapsule: s.buildingCapsule, isDirty: s.isDirty,
    loadLook: s.loadLook, loadLookAsNew: s.loadLookAsNew, reset: s.reset, markClean: s.markClean,
    noteSavedAs: s.noteSavedAs, noteSavedCapsuleAs: s.noteSavedCapsuleAs, addNode: s.addNode,
  })))
  const nodes = useCanvasStore((s) => s.state.nodes)
  const { looks, loading, error: looksError, fetchLooks, saveLook, deleteLook } = useLooks(activeClient?.id ?? null)
  const { capsules, saveCapsule } = useCapsules(activeClient?.id ?? null)
  const [showCapsuleDialog, setShowCapsuleDialog] = useState(false)
  const [showSaveAsCapsuleDialog, setShowSaveAsCapsuleDialog] = useState(false)
  const [savingCapsule, setSavingCapsule] = useState(false)
  // ADR-0152: looks go ONTO a capsule. The board is a capsule when one is being edited, rebuilt
  // or put together; a click on a look then adds it instead of replacing the board.
  const onCapsule = isCapsuleBoard({ currentCapsuleId, replacesCapsuleId, buildingCapsule })
  const looksOnBoard = useMemo(() => (onCapsule ? lookIdsOnBoard({ nodes }) : []), [onCapsule, nodes])
  const [showAddLooks, setShowAddLooks] = useState(false)
  const [addingLooks, setAddingLooks] = useState(false)
  const [addLooksError, setAddLooksError] = useState<string | null>(null)
  // A look she clicked while the board held unsaved work that is not a capsule: ask what she
  // means rather than offering only "discard", which is what Cynthia was stuck with.
  const [pendingLook, setPendingLook] = useState<LookRow | null>(null)

  // Compose state
  const [messages, setMessages] = useState<ComposeMessage[]>([])
  const [input, setInput] = useState('')
  const [composing, setComposing] = useState(false)
  const [pendingItems, setPendingItems] = useState<ResolvedItem[] | null>(null)
  const [pendingPlan, setPendingPlan] = useState<CompositionPlan | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const currentLook = looks.find((l) => l.id === currentLookId) ?? null
  const currentCapsule = capsules.find((c) => c.id === currentCapsuleId) ?? null
  // The GoodPix capsule this board is a rebuild OF (not a capsule being edited) — used for the
  // header, the button label and the name the Save dialog opens with.
  const replacedCapsule = capsules.find((c) => c.id === replacesCapsuleId) ?? null
  // The look this board is a RESTYLE of. A GoodPix look is never edited in place (ADR-0076), so
  // the save inserts a new row and `currentLookId` is null — which left the name box empty and
  // made Paige Berndt retype the name from a second tab: "I have to go back and fourth between
  // tabs to see what the original name was" (2026-09-21). Capsules already did this two blocks
  // below; looks never got it. ADR-0132.
  // `looks` is builder-only and excludes pulled looks, so the original cannot be found there.
  // The canvas store already carries its name for the panel beside the board; that is the name.
  const restyledLookName = replacesLookId ? restyleReference?.lookName ?? '' : ''

  /**
   * WHERE THIS BOARD'S LOOK IS ALREADY FILED, read from `look_category_assignments` — the table
   * Categorize and the client's Looks page actually file by. ADR-0149.
   *
   * Read for the look being EDITED and for the one being REPLACED alike. A replacement has no
   * `currentLookId` (ADR-0076 inserts a new row), which is why the box used to open with every
   * pill blank on a look that was already in three categories. Cynthia Dada, 2026-09-24: "This
   * look was already in a category but I'm not sure what."
   *
   * Loaded here rather than inside the dialog so the same value is both what she is SHOWN and the
   * baseline the save diffs against — one read, so the screen and the write cannot disagree.
   * `lookFilingOk` is false only when the read failed; the save then adds and never removes.
   */
  const filedLookId = currentLookId ?? replacesLookId
  const [lookFiling, setLookFiling] = useState<string[]>([])
  const [lookFilingOk, setLookFilingOk] = useState(true)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const f = await readLookFiling(filedLookId, activeClient?.id ?? null)
      if (cancelled) return
      // A look filed in nothing falls back to its old `tags`, so the 72 looks that were ticked
      // into a column nothing files by still open with their pills on — and the next save files
      // them for real. Without this, ADR-0149 would blank the very looks it exists to explain.
      const legacy = looks.find((l) => l.id === filedLookId)?.tags ?? []
      setLookFiling(f.labels.length ? f.labels : legacy)
      setLookFilingOk(f.ok)
    })()
    return () => { cancelled = true }
  }, [filedLookId, activeClient?.id, looks])

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSave = useCallback(async (data: { name: string; notes: string; clientNote: string; tags: string[] }) => {
    if (!activeClient) return
    setSaving(true)

    // No thumbnailUrl any more: Save used to also write a 2160px base64 JPEG into
    // gp_looks.thumbnail_url (641 rows, 199 MB) that no screen reads. The look's picture is the
    // R2 PNG below; its small copy is made on Save (useLooks -> api/derive-image).
    let imageBase64: string | undefined
    // Settle FIRST, then read. This copies what is actually on the board (angles, positions,
    // text box widths) into the state, so the state we save and the picture we export cannot
    // disagree. Reading `state` before this is what shipped flat labels for months.
    settleCanvasTransforms()
    // Save the canvas exactly as it is. Styling is an explicit action (the ✨
    // button in the toolbar) — saving must NEVER re-arrange or rescale the look.
    const styledState = useCanvasStore.getState().state

    try {
      // Export the current canvas via Konva native API
      const pngDataUrl = exportCanvasImage({ pixelRatio: 2 })
      if (pngDataUrl) {
        imageBase64 = pngDataUrl.replace(/^data:image\/png;base64,/, '')
      }
    } catch (err) {
      console.error('Canvas export failed:', err)
    }

    const { data: sessionData } = await supabase.auth.getSession()
    const authUserId = sessionData?.session?.user?.id ?? null

    const saved = await saveLook({
      id: currentLookId ?? undefined,
      // Set only when this board is a rebuild of a transitioned GoodPix look: the new row takes
      // that look's place in the lookbook and the original retires (ADR-0076 + migration 014).
      replacesLookId: replacesLookId ?? undefined,
      replacesSiblingLookIds,
      clientId: activeClient.id,
      name: data.name,
      canvasState: styledState,
      tags: data.tags,
      notesInternal: data.notes,
      notesClient: data.clientNote,
      imageBase64,
      createdBy: authUserId ?? undefined,
    })

    // Adopt the row we just created, so pressing Save again edits it instead of forking a third
    // look and retiring an original that is already retired.
    if (replacesLookId && saved?.data?.id) noteSavedAs(saved.data.id)

    // FILE IT WHERE SHE SAID. The pills used to write `gp_looks.tags` only, which nothing files
    // by — 72 live looks were tagged and in no category at all on 2026-09-24 (ADR-0149). Last,
    // and deliberately: saveLook has already run replaceTransitionedLook, which copies the
    // original's filing onto the new row, so this is the stylist's word over the inherited one.
    // Never fatal — the look IS saved, and a filing that did not stick must not read as a lost
    // restyle.
    const savedId = saved?.data?.id
    if (savedId) {
      try {
        await applyLookFiling(savedId, activeClient.id, lookFilingOk ? lookFiling : [], data.tags)
        const f = await readLookFiling(savedId, activeClient.id)
        setLookFiling(f.labels)
        setLookFilingOk(f.ok)
      } catch (e) {
        console.error('Filing the look failed (look saved):', e)
      }
    }

    markClean()
    setSaving(false)
    setShowSaveDialog(false)
  }, [activeClient, currentLookId, replacesLookId, replacesSiblingLookIds, saveLook, markClean, noteSavedAs, user, lookFiling, lookFilingOk])

  const handleCreateCapsule = useCallback(async (data: { name: string; description: string; lookIds: string[]; compositeBase64: string }) => {
    if (!activeClient) return
    setSavingCapsule(true)

    // Collect all closet_item_ids from the selected looks
    const selectedLooks = looks.filter(l => data.lookIds.includes(l.id))
    const allItemIds = [...new Set(
      selectedLooks.flatMap(l =>
        l.canvas_state?.nodes
          ?.filter((n: any) => n.type === 'closet_item')
          ?.map((n: any) => n.closet_item_id) ?? []
      )
    )]

    await saveCapsule({
      clientId: activeClient.id,
      name: data.name,
      description: data.description,
      lookIds: data.lookIds,
      closetItemIds: allItemIds,
      imageBase64: data.compositeBase64 || undefined,
    })

    setSavingCapsule(false)
    setShowCapsuleDialog(false)
  }, [activeClient, looks, saveCapsule])

  // Save the CURRENT board (the canvas as arranged — e.g. a Landscape packing
  // capsule) directly as a capsule, without first saving it as looks. The board
  // export becomes the capsule image; its closet items become the packing list.
  //
  // If currentCapsuleId is set (the stylist opened this board via Categorize → Capsules →
  // Edit), this UPDATES that same gp_boards row instead of inserting a new one — mirrors how
  // handleSave above passes currentLookId through to saveLook so re-saving a Look doesn't
  // duplicate it.
  const handleSaveAsCapsule = useCallback(async (data: { name: string; description: string }) => {
    if (!activeClient) return
    setSavingCapsule(true)

    // Settle FIRST, then read — same reason as handleSave above.
    settleCanvasTransforms()
    const canvasState = useCanvasStore.getState().state

    let imageBase64: string | undefined
    try {
      const pngDataUrl = exportCanvasImage({ pixelRatio: 2 })
      if (pngDataUrl) imageBase64 = pngDataUrl.replace(/^data:image\/png;base64,/, '')
    } catch (err) {
      console.error('Canvas export failed:', err)
    }

    const closetItemIds = [...new Set(
      canvasState.nodes
        .filter((n: any) => n.type === 'closet_item')
        .map((n: any) => n.closet_item_id as string)
    )]

    // A REBUILD passes no id (so a fresh row is inserted, never overwriting the GoodPix
    // original's raw.image_url, which is live on her site) plus replacesCapsuleId, so the save
    // hands the original's filing, published state and slot over and retires it.
    const saved = await saveCapsule({
      id: currentCapsuleId ?? undefined,
      replacesCapsuleId: replacesCapsuleId ?? undefined,
      clientId: activeClient.id,
      name: data.name,
      description: data.description,
      lookIds: [],
      boardLookIds: lookIdsOnBoard(canvasState),
      closetItemIds,
      imageBase64,
      canvasState,
      existingRaw: currentCapsule?.raw,
    })

    // The board now IS the saved capsule, so the next Save updates it. This used to happen only
    // after a replacement, so every fresh "Save as Capsule" pressed twice made a second capsule:
    // Janet Foutty had five Denvers and five Cape Cods on 2026-09-24 (ADR-0152).
    if (saved?.data?.id) {
      noteSavedCapsuleAs(saved.data.id)
      markClean()
    }

    setSavingCapsule(false)
    setShowSaveAsCapsuleDialog(false)
  }, [activeClient, saveCapsule, currentCapsuleId, currentCapsule, replacesCapsuleId, noteSavedCapsuleAs, markClean])

  const handleAddLooks = useCallback(async (picked: LookRow[]) => {
    if (picked.length === 0) return
    setAddingLooks(true)
    setAddLooksError(null)
    try {
      await addLooksToCapsuleBoard(picked)
      setShowAddLooks(false)
    } catch (e) {
      setAddLooksError(e instanceof Error ? e.message : 'Could not add those looks.')
    } finally {
      setAddingLooks(false)
    }
  }, [])

  const openLook = useCallback(async (look: LookRow) => {
    const canvasState = look.canvas_state as LookCanvasState | null
    if (!canvasState) return
    const newImageUrls = await resolveClosetImageUrls(canvasState)
    loadLook(look.id, canvasState, newImageUrls)
  }, [loadLook])

  // A click on a look. On a capsule it ADDS the look (ADR-0152). Anywhere else it opens the look,
  // and if that would throw away unsaved work she is asked which she meant, with adding offered
  // first, instead of a browser box whose only choices were discard or cancel.
  const handleSelectLook = useCallback(async (look: LookRow) => {
    if (onCapsule) {
      if (looksOnBoard.includes(look.id)) return
      await handleAddLooks([look])
      return
    }
    if (isDirty && nodes.length > 0) { setPendingLook(look); return }
    await openLook(look)
  }, [onCapsule, looksOnBoard, handleAddLooks, isDirty, nodes.length, openLook])

  // Duplicate: load this look's items/layout onto the board as a NEW unsaved look so the stylist
  // can swap a few pieces and Save without touching the original.
  const handleDuplicateLook = useCallback(async (look: LookRow) => {
    if (isDirty && !confirm('You have unsaved changes. Discard and duplicate this look?')) return
    const canvasState = look.canvas_state as LookCanvasState | null
    if (!canvasState) return
    const newImageUrls = await resolveClosetImageUrls(canvasState)
    loadLookAsNew(canvasState, newImageUrls)
  }, [isDirty, loadLookAsNew])

  const handleNewLook = useCallback(() => {
    if (isDirty && !confirm('You have unsaved changes. Start a new look?')) return
    reset()
  }, [isDirty, reset])

  // ── Compose handlers ──────────────────────────────────────────────

  const handleCompose = useCallback(async () => {
    if (!input.trim() || !activeClient || composing) return

    const userMsg: ComposeMessage = { role: 'user', content: input.trim() }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setComposing(true)

    try {
      // First pass: extract entities and search (no compose yet)
      const result = await runComposePipeline(
        userMsg.content,
        activeClient.id,
        messages
      )

      if (result.needsDisambiguation) {
        setPendingItems(result.resolvedItems)
        setPendingPlan(result.plan)
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: result.summary,
            resolvedItems: result.resolvedItems,
            awaitingDisambiguation: true,
          },
        ])
      } else if (result.composed) {
        // Place items on canvas
        await placeOnCanvas(result.composed.nodes, result.resolvedItems)
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: result.summary },
        ])
        setPendingItems(null)
        setPendingPlan(null)
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'No matching items found. Try a different description.' },
        ])
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${err.message}` },
      ])
    } finally {
      setComposing(false)
    }
  }, [input, activeClient, composing, messages])

  const handleDisambiguate = useCallback(
    async (itemIndex: number, candidateIndex: number) => {
      if (!pendingItems || !pendingPlan) return

      const updated = resolveDisambiguation(pendingItems, itemIndex, candidateIndex)
      setPendingItems(updated)

      // Update the last message with the selection
      const selectedName = updated[itemIndex].selected?.name ?? ''
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: `Pick #${candidateIndex + 1} for "${updated[itemIndex].extraction.description}" → ${selectedName}` },
      ])

      if (allResolved(updated)) {
        setComposing(true)
        try {
          const layoutName = pickLayout(pendingPlan.items, pendingPlan.layout)
          const composed = composeNodes(updated, layoutName)
          await placeOnCanvas(composed.nodes, updated)

          const placed = updated.filter((r) => r.selected).length
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `All items resolved! Placed ${placed} items on canvas.` },
          ])
          setPendingItems(null)
          setPendingPlan(null)
        } catch (err: any) {
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `Error composing: ${err.message}` },
          ])
        } finally {
          setComposing(false)
        }
      }
    },
    [pendingItems, pendingPlan]
  )

  async function placeOnCanvas(
    nodes: import('@/types/canvas').CanvasNode[],
    _resolvedItems: ResolvedItem[]
  ) {
    // Fetch image URLs for placed closet items
    const closetItemIds = nodes
      .filter((n): n is ClosetItemNode => n.type === 'closet_item')
      .map((n) => n.closet_item_id)

    let imageUrlMap = new Map<string, string>()
    if (closetItemIds.length > 0) {
      const { data: items } = await supabase
        .from('closet_items')
        .select('id, raw')
        .in('id', closetItemIds)

      if (items) {
        for (const item of items as Pick<ClosetItem, 'id' | 'raw'>[]) {
          const url = item.raw?.processed_image ?? item.raw?.image ?? item.raw?.images?.[0] ?? null
          if (url) imageUrlMap.set(item.id, url)
        }
      }
    }

    // Add each node to canvas
    for (const node of nodes) {
      if (node.type === 'closet_item') {
        const url = imageUrlMap.get((node as ClosetItemNode).closet_item_id)
        addNode(node, url)
      } else {
        addNode(node)
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleCompose()
    }
  }

  return (
    <>
      <aside className="w-72 border-l border-border bg-white flex flex-col h-full">
        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setTab('looks')}
            className={`flex-1 py-2.5 text-[10px] tracking-[0.35em] uppercase text-center transition-colors ${
              tab === 'looks' ? 'text-text border-b-2 border-[#1A1A1A]' : 'text-text-muted/60 hover:text-text-muted'
            }`}
          >
            Looks
          </button>
          <button
            onClick={() => setTab('compose')}
            className={`flex-1 py-2.5 text-[10px] tracking-[0.35em] uppercase text-center transition-colors ${
              tab === 'compose' ? 'text-text border-b-2 border-[#1A1A1A]' : 'text-text-muted/60 hover:text-text-muted'
            }`}
          >
            Compose
          </button>
        </div>

        {/* Save bar */}
        {activeClient && (
          <div className="px-3 py-2 border-b border-border flex items-center gap-2">
            <button
              onClick={() => setShowSaveDialog(true)}
              // Several looks saved as ONE look is never what she means (ADR-0152).
              disabled={nodes.length === 0 || buildingCapsule}
              title={buildingCapsule ? 'This board is a capsule. Use Save as Capsule.' : undefined}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-[#1A1A1A] text-white text-[10px] tracking-[0.2em] uppercase rounded-sm hover:bg-[#333] transition-colors disabled:opacity-30"
            >
              <Save className="h-3 w-3" />
              {/* A rebuild REPLACES the look it opened, so it updates from her point of view
                  even though the row underneath is a new one (ADR-0148). Saying "Save" there is
                  what made Cynthia think she was about to end up with two. */}
              {currentLookId || replacesLookId ? 'Update Look' : 'Save Look'}
            </button>
            <button
              onClick={handleNewLook}
              className="p-1.5 border border-border rounded-sm hover:bg-tile transition-colors"
              title="New look"
            >
              <FilePlus className="h-3.5 w-3.5 text-text-muted" />
            </button>
          </div>
        )}

        {/* Save the current board directly as a capsule (e.g. a Landscape packing capsule) */}
        {activeClient && nodes.length > 0 && (
          <div className="px-3 py-1.5 border-b border-border">
            <button
              onClick={() => setShowSaveAsCapsuleDialog(true)}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-[#1A1A1A] text-[10px] tracking-[0.2em] uppercase rounded-sm hover:bg-tile transition-colors text-text"
            >
              {currentCapsuleId ? 'Update Capsule' : replacesCapsuleId ? 'Replace Capsule' : 'Save as Capsule'}
            </button>
          </div>
        )}

        {/* Put any number of saved looks on this capsule, or start one (ADR-0152). */}
        {activeClient && looks.length > 0 && (
          <div className="px-3 py-1.5 border-b border-border">
            <button
              onClick={() => { setAddLooksError(null); setShowAddLooks(true) }}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-[#1A1A1A] text-[10px] tracking-[0.2em] uppercase rounded-sm hover:bg-tile transition-colors text-text"
            >
              + {onCapsule ? 'Add Looks to Capsule' : 'Start Capsule from Looks'}
            </button>
            {addingLooks && <p className="text-[9px] text-text-muted mt-1 text-center">Adding looks</p>}
            {!showAddLooks && addLooksError && <p className="text-[9px] text-red-500 mt-1 text-center">{addLooksError}</p>}
          </div>
        )}

        {/* Bundle several already-saved looks into a fixed picture grid (not editable later) */}
        {activeClient && looks.length > 0 && !onCapsule && (
          <div className="px-3 py-1.5 border-b border-border">
            <button
              onClick={() => setShowCapsuleDialog(true)}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-border text-[10px] tracking-[0.2em] uppercase rounded-sm hover:bg-tile transition-colors text-text-muted"
            >
              <span>🧩</span>
              Capsule from Looks ({looks.length} available)
            </button>
          </div>
        )}

        {/* Rebuild info — set when a GoodPix capsule was opened via Categorize → Capsules →
            Rebuild. Says plainly that this replaces the live one, because it does, and that the
            original is kept. Without this the board looks like an ordinary new capsule and the
            stylist has no way to know a Save will take one off the client's site. */}
        {replacesCapsuleId && (
          <div className="px-3 py-2 border-b border-border bg-tile/50">
            <p className="text-[10px] tracking-[0.2em] uppercase text-text-muted/60">Rebuilding Capsule</p>
            <p className="text-[11px] font-medium text-text truncate">{replacedCapsule?.name ?? 'Untitled Capsule'}</p>
            <p className="text-[9px] text-text-muted mt-0.5 leading-relaxed">
              These are its pieces on a fresh board. "Replace Capsule" puts this on her site in
              its place and keeps the original in Archived.
            </p>
          </div>
        )}

        {/* A capsule she is putting together from looks and has not saved yet (ADR-0152). */}
        {buildingCapsule && (
          <div className="px-3 py-2 border-b border-border bg-tile/50">
            <p className="text-[10px] tracking-[0.2em] uppercase text-text-muted/60">New Capsule</p>
            <p className="text-[11px] font-medium text-text">{looksOnBoard.length} {looksOnBoard.length === 1 ? 'look' : 'looks'} on the board</p>
            <p className="text-[9px] text-text-muted mt-0.5 leading-relaxed">
              Click a look to add it. "Save as Capsule" saves it, and saving again updates the same capsule.
            </p>
          </div>
        )}

        {/* Current capsule info — set when a capsule was loaded via Categorize → Capsules → Edit */}
        {currentCapsuleId && (
          <div className="px-3 py-2 border-b border-border bg-tile/50">
            <p className="text-[10px] tracking-[0.2em] uppercase text-text-muted/60">Editing Capsule</p>
            <p className="text-[11px] font-medium text-text truncate">{currentCapsule?.name ?? 'Untitled Capsule'}</p>
            {isDirty && (
              <p className="text-[9px] text-blush mt-0.5">Unsaved changes — use "Update Capsule" above to save back to this capsule.</p>
            )}
          </div>
        )}

        {/* Current look info */}
        {currentLook && (
          <div className="px-3 py-2 border-b border-border bg-tile/50">
            <p className="text-[10px] tracking-[0.2em] uppercase text-text-muted/60">Editing</p>
            <p className="text-[11px] font-medium text-text truncate">{currentLook.name}</p>
            {isDirty && (
              <p className="text-[9px] text-blush mt-0.5">Unsaved changes</p>
            )}
          </div>
        )}

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'looks' && activeClient && (
            <LookGallery
              looks={looks}
              loading={loading}
              error={looksError}
              onRetry={() => { void fetchLooks() }}
              currentLookId={currentLookId}
              onBoardIds={looksOnBoard}
              addMode={onCapsule}
              onSelect={handleSelectLook}
              onDuplicate={handleDuplicateLook}
              onDelete={(id) => deleteLook(id)}
              onNew={handleNewLook}
            />
          )}
          {tab === 'looks' && !activeClient && (
            <div className="flex items-center justify-center h-full p-4">
              <p className="text-[10px] tracking-[0.3em] uppercase text-text-muted/30 text-center">
                Select a client to view looks
              </p>
            </div>
          )}

          {/* Compose conversation */}
          {tab === 'compose' && (
            <div className="p-3 space-y-3">
              {messages.length === 0 && (
                <p className="text-[11px] leading-relaxed text-text-muted/50">
                  Describe a look and I'll compose it on canvas. Try something like:
                </p>
              )}
              {messages.length === 0 && (
                <div className="space-y-1.5">
                  {[
                    'White silk Dior blouse with dark wash jeans and black Louboutin pumps',
                    'Casual brunch: linen top, wide leg pants, espadrilles',
                    'Date night look with a Khaite bodycon dress and gold accessories',
                  ].map((example) => (
                    <button
                      key={example}
                      onClick={() => { setInput(example); }}
                      className="block w-full text-left px-2.5 py-2 bg-tile/50 rounded-sm text-[10px] leading-relaxed text-text-muted hover:bg-tile transition-colors"
                    >
                      "{example}"
                    </button>
                  ))}
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`${msg.role === 'user' ? 'text-right' : ''}`}>
                  <div
                    className={`inline-block max-w-[95%] px-3 py-2 rounded-lg text-[11px] leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-[#1A1A1A] text-white'
                        : 'bg-tile text-text'
                    }`}
                  >
                    {msg.content.split('\n').map((line, j) => (
                      <p key={j} className={j > 0 ? 'mt-1' : ''}>
                        {line.replace(/\*\*(.*?)\*\*/g, '$1')}
                      </p>
                    ))}
                  </div>

                  {/* Disambiguation cards */}
                  {msg.awaitingDisambiguation && pendingItems && (
                    <div className="mt-2 space-y-2">
                      {pendingItems.map((item, itemIdx) =>
                        item.needsDisambiguation ? (
                          <div key={itemIdx} className="bg-white border border-border rounded-sm p-2">
                            <p className="text-[10px] font-medium text-text mb-1.5">
                              {item.extraction.description}
                            </p>
                            {item.candidates.slice(0, 3).map((c, cIdx) => (
                              <button
                                key={c.id}
                                onClick={() => handleDisambiguate(itemIdx, cIdx)}
                                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-tile/80 transition-colors text-left"
                              >
                                <span className="w-5 h-5 rounded-full bg-tile flex items-center justify-center text-[9px] font-medium text-text-muted flex-shrink-0">
                                  {cIdx + 1}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[10px] text-text truncate">{c.name}</p>
                                  <p className="text-[9px] text-text-muted">{c.brand || 'no brand'} · {(c.similarity * 100).toFixed(0)}%</p>
                                </div>
                                <ChevronRight className="h-3 w-3 text-text-muted/40 flex-shrink-0" />
                              </button>
                            ))}
                          </div>
                        ) : item.selected ? (
                          <div key={itemIdx} className="flex items-center gap-2 px-2 py-1.5 bg-tile/30 rounded-sm">
                            <Check className="h-3 w-3 text-green-600 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] text-text truncate">{item.selected.name}</p>
                              <p className="text-[9px] text-text-muted">{item.extraction.description}</p>
                            </div>
                          </div>
                        ) : null
                      )}
                    </div>
                  )}
                </div>
              ))}

              {composing && (
                <div className="flex items-center gap-2 text-text-muted/60">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="text-[10px] tracking-[0.15em]">Composing...</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Compose input — always visible when on compose tab */}
        {tab === 'compose' && (
          <div className="p-3 border-t border-border">
            {!activeClient ? (
              <p className="text-[10px] tracking-[0.2em] uppercase text-text-muted/40 text-center py-2">
                Select a client first
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Describe a look..."
                  rows={3}
                  className="w-full bg-tile rounded-sm px-3 py-2 text-[11px] tracking-[0.05em] placeholder:text-text-muted/40 focus:outline-none focus:ring-1 focus:ring-blush resize-none"
                />
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={handleCompose}
                  className="self-end flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[#1A1A1A] text-white text-[10px] tracking-[0.15em] uppercase hover:bg-[#333] transition-colors cursor-pointer"
                >
                  <Send className="h-3 w-3" />
                  Compose
                </button>
              </div>
            )}
          </div>
        )}
      </aside>

      {showSaveDialog && (
        <SaveLookDialog
          initialName={currentLook?.name || restyledLookName}
          initialClientNote={currentLook?.notes_client ?? ''}
          initialNotes={currentLook?.notes_internal ?? ''}
          initialTags={lookFiling}
          saving={saving}
          onSave={handleSave}
          onClose={() => setShowSaveDialog(false)}
        />
      )}

      {showAddLooks && (
        <AddLooksDialog
          looks={looks}
          onBoard={looksOnBoard}
          startsCapsule={!onCapsule}
          adding={addingLooks}
          error={addLooksError}
          onAdd={(picked) => { void handleAddLooks(picked) }}
          onClose={() => setShowAddLooks(false)}
        />
      )}

      {pendingLook && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-sm shadow-xl w-[400px] mx-4 p-5 space-y-3">
            <p className="text-sm font-medium text-[#1A1A1A]">{pendingLook.name}</p>
            <p className="text-[12px] leading-relaxed text-[#666]">
              The board has changes that are not saved. Do you want to put this look on the board with
              them, as a capsule, or open it on its own?
            </p>
            {currentLook && (
              <p className="text-[11px] leading-relaxed text-[#888]">
                Adding makes a new capsule. The changes go into the capsule, not into {currentLook.name}.
              </p>
            )}
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => { const l = pendingLook; setPendingLook(null); void handleAddLooks([l]) }}
                className="w-full py-2.5 bg-[#1A1A1A] text-white text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#333]"
              >
                Add to the board as a capsule
              </button>
              <button
                onClick={() => { const l = pendingLook; setPendingLook(null); void openLook(l) }}
                className="w-full py-2.5 border border-[#E8E4DF] text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#F8F7F5]"
              >
                Open it instead and lose the changes
              </button>
              <button
                onClick={() => setPendingLook(null)}
                className="w-full py-2 text-[11px] tracking-[0.15em] uppercase text-[#888] hover:text-[#1A1A1A]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showCapsuleDialog && (
        <CreateCapsuleDialog
          looks={looks}
          saving={savingCapsule}
          onSave={handleCreateCapsule}
          onClose={() => setShowCapsuleDialog(false)}
        />
      )}

      {showSaveAsCapsuleDialog && (
        <SaveAsCapsuleDialog
          itemCount={nodes.filter((n: any) => n.type === 'closet_item').length}
          saving={savingCapsule}
          isEditing={!!currentCapsuleId}
          initialName={currentCapsule?.name ?? replacedCapsule?.name ?? ''}
          initialDescription={currentCapsule?.description ?? replacedCapsule?.description ?? ''}
          onSave={handleSaveAsCapsule}
          onClose={() => setShowSaveAsCapsuleDialog(false)}
        />
      )}
    </>
  )
}
