import { useCallback, useMemo, useState } from 'react'
import { Plus, Tag, X, Send, Pencil, Check, Link2, Trash2, RotateCcw } from 'lucide-react'
import { useClientStore } from '@/stores/clientStore'
import { useLookCategories, type TaggableLook, type TaggableCapsule, type LookCategory } from '@/hooks/useLookCategories'
import { CATEGORY_LABELS, SIDEBAR_STRUCTURE } from '@/lib/categorize'
import { isFixedCategory, labelForCategory } from '@/lib/garmentCategory'
import { supabase } from '@/lib/supabase'
import { useCanvasStore } from '@/stores/canvasStore'
import { useViewStore } from '@/stores/viewStore'
import { resolveClosetImageUrls } from '@/lib/resolveClosetImageUrls'
import { buildCanvasFromClosetItems } from '@/lib/rebuildLookCanvas'
import type { LookCanvasState } from '@/types/canvas'
import { CollectionTab } from './CollectionTab'
import { LookArrangeGrid } from './LookArrangeGrid'
import { ResidencesTab } from './ResidencesTab'
import { ReviewTab } from './ReviewTab'
import { TransitionsTab } from './TransitionsTab'
import { useTransitions } from '@/hooks/useTransitions'
import type { TransitionedLook } from '@/hooks/useTransitions'
import { useResidenceReview } from '@/hooks/useResidenceReview'
import { useShareLinks, openedAgo } from '@/hooks/useShareLinks'
import { hasResidences } from '@/lib/residences'
import { ReconciliationPanel } from '@/components/reconciliation/ReconciliationPanel'
import { ReconcileFilterRail } from '@/components/reconciliation/ReconcileFilterRail'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'

type Mode = 'looks' | 'residences' | 'capsules' | 'collection' | 'audit' | 'review' | 'transitions'
type Status = 'draft' | 'published' | 'archived' | 'all'

export function CategorizePanel() {
  const { activeClient } = useClientStore()
  const {
    loading, categories, looks, capsules, createCategory, renameCategory, deleteCategory, restoreCategory,
    assignLook, assignCapsule,
    setLookPublished, setCapsulePublished,
    archiveLook, archiveCapsule,
    restoreLook, restoreCapsule,
    reorderLooks, reorderCapsules,
    renameLook, renameCapsule,
  } = useLookCategories(activeClient?.id ?? null)

  // Transitioned pieces + looks for this client. Instantiated at the panel so the pink tab badge
  // stays live regardless of which tab is open; the result is passed down to TransitionsTab.
  const transitions = useTransitions(activeClient?.id ?? null)
  const transitionCount = transitions.items.length + transitions.looks.length

  // Residence review queue — only meaningful for clients with homes configured, so the
  // tab itself is gated below on the taxonomy rather than shown empty to everyone.
  const residenceReview = useResidenceReview(activeClient?.id ?? null)
  const showResidences = hasResidences(categories)

  const [mode, setMode] = useState<Mode>('looks')
  const [brush, setBrush] = useState<string | null>(null)   // category ID
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<Status>('draft')
  const [newCat, setNewCat] = useState('')
  const [editing, setEditing] = useState<string | null>(null) // category ID being renamed
  const [editVal, setEditVal] = useState('')
  const [chatStatus, setChatStatus] = useState<string | null>(null)
  // Copy-link state for every look/capsule of this client, loaded in one request.
  const share = useShareLinks(activeClient?.id ?? null)
  // Collection mode uses garment categories (item-level), not the look-category brush.
  const [garmentCounts, setGarmentCounts] = useState<Map<string, number>>(new Map())
  const [activeGarmentCats, setActiveGarmentCats] = useState<Set<string>>(new Set())
  const onGarmentCounts = useCallback((c: Map<string, number>) => setGarmentCounts(c), [])
  const toggleGarment = (slug: string) =>
    setActiveGarmentCats((prev) => { const n = new Set(prev); n.has(slug) ? n.delete(slug) : n.add(slug); return n })

  // Share a look/capsule into the client's chat (lands as a card in their thread).
  async function shareToChat(itemId: string) {
    if (!activeClient) return
    setChatStatus('Sharing…')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('https://atelierbywatson.com/looks/api/chat/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ clientId: activeClient.id, type: mode === 'capsules' ? 'capsule' : 'look', itemId }),
      })
      const data = await res.json()
      setChatStatus(res.ok ? 'Shared to chat ✓' : `Share failed: ${data.error || res.status}`)
    } catch {
      setChatStatus('Share failed')
    }
  }

  // Edit a capsule: load its saved canvas_state back onto the board and switch to the Canvas
  // tab. Only capsules saved via the single-canvas "Save as Capsule" path have canvas_state
  // (see TaggableCapsule.canvasState) — capsules built via "Capsule from Looks" don't, and the
  // button is disabled for those rather than opening a broken/empty canvas.
  const setStyleTab = useViewStore((s) => s.setStyleTab)
  const [editingCapsuleId, setEditingCapsuleId] = useState<string | null>(null)
  async function handleEditCapsule(capsule: TaggableCapsule) {
    if (!capsule.canvasState) return
    if (useCanvasStore.getState().isDirty && !confirm('You have unsaved changes on the canvas. Discard them and load this capsule for editing?')) return
    setEditingCapsuleId(capsule.id)
    try {
      const imageUrls = await resolveClosetImageUrls(capsule.canvasState)
      useCanvasStore.getState().loadCapsule(capsule.id, capsule.canvasState, imageUrls)
      setStyleTab('canvas')
    } finally {
      setEditingCapsuleId(null)
    }
  }

  // ── Looks: open on canvas (Edit for builder looks, Rebuild for GoodPix looks) + rename ──
  const [openingLookId, setOpeningLookId] = useState<string | null>(null)

  // Builder look: fetch its canvas_state on demand (the list query stays light) and reopen it
  // for editing — Save then updates the same gp_looks row, exactly like opening it from the
  // canvas tab's look gallery.
  async function handleEditLook(look: TaggableLook) {
    if (useCanvasStore.getState().isDirty && !confirm('You have unsaved changes on the canvas. Discard them and load this look for editing?')) return
    setOpeningLookId(look.id)
    try {
      const { data } = await supabase.from('gp_looks').select('canvas_state').eq('id', look.id).single()
      const canvasState = (data?.canvas_state ?? null) as LookCanvasState | null
      if (!canvasState) { alert('This look has no saved canvas to edit.'); return }
      const imageUrls = await resolveClosetImageUrls(canvasState)
      useCanvasStore.getState().loadLook(look.id, canvasState, imageUrls)
      setStyleTab('canvas')
    } finally {
      setOpeningLookId(null)
    }
  }

  /**
   * Restyle a look that was PULLED from the lookbook because a piece it used was transitioned
   * out. Until now these were a dead thumbnail: gp_looks rows that useLooks and useLookCategories
   * both filter out, so there was no way to open one, and 17 of them had been sitting dark for
   * up to five weeks.
   *
   * Either way the transitioned pieces are stripped from the board before she sees it, so what
   * she opens is the look with the hole in it, ready to fill — and saving is enough to bring it
   * back. Leaving them on the canvas would let her save a look still containing a piece the
   * client no longer owns, which stays (correctly, but confusingly) dark.
   */
  async function handleRestyleTransitionedLook(look: TransitionedLook) {
    if (useCanvasStore.getState().isDirty && !confirm('You have unsaved changes on the canvas. Discard them and open this look to restyle?')) return
    const gone = new Set(look.causeItemIds)
    setOpeningLookId(look.id)
    try {
      if (look.source === 'builder') {
        // Restyle IN PLACE: same row, so saving clears its transition block and the look
        // returns to the lookbook in its old slot.
        const { data } = await supabase.from('gp_looks').select('canvas_state').eq('id', look.id).single()
        const canvasState = (data?.canvas_state ?? null) as LookCanvasState | null
        if (!canvasState) { alert('This look has no saved canvas to restyle.'); return }
        const stripped: LookCanvasState = {
          ...canvasState,
          nodes: canvasState.nodes.filter(
            (n: any) => n.type !== 'closet_item' || !gone.has(n.closet_item_id),
          ),
        }
        const imageUrls = await resolveClosetImageUrls(stripped)
        useCanvasStore.getState().loadLook(look.id, stripped, imageUrls)
      } else {
        // GoodPix look: never edited in place (ADR-0076 — a save would overwrite `raw` and lose
        // the original composed image). Rebuild from the pieces she still owns as a NEW look
        // that REPLACES this one: on save it inherits the published state, order and filing, and
        // the original retires. Without this branch a rebuild left the original dark forever and
        // put a duplicate beside it.
        const remaining = look.closetItemIds.filter((id) => !gone.has(id))
        if (remaining.length === 0) {
          alert('Every piece in this look was transitioned out — retire it instead of restyling.')
          return
        }
        const canvasState = buildCanvasFromClosetItems(remaining)
        const imageUrls = await resolveClosetImageUrls(canvasState)
        useCanvasStore.getState().loadLookAsReplacement(look.id, canvasState, imageUrls)
      }
      setStyleTab('canvas')
    } finally {
      setOpeningLookId(null)
    }
  }

  // GoodPix look: the scrape captured one flat image + the item list, never the collage layout,
  // so the original can't be reopened as-is. Instead, lay its pieces out on the canvas as a NEW
  // unsaved look — the stylist rearranges/swaps, saves under her own name, publishes, and
  // archives the GoodPix original when she's happy. The original is never touched by this.
  async function handleRebuildLook(look: TaggableLook) {
    if (look.closetItemIds.length === 0) { alert('This look has no linked collection pieces to rebuild from.'); return }
    if (useCanvasStore.getState().isDirty && !confirm('You have unsaved changes on the canvas. Discard them and rebuild this look?')) return
    setOpeningLookId(look.id)
    try {
      const canvasState = buildCanvasFromClosetItems(look.closetItemIds)
      const imageUrls = await resolveClosetImageUrls(canvasState)
      useCanvasStore.getState().loadLookAsNew(canvasState, imageUrls)
      setStyleTab('canvas')
    } finally {
      setOpeningLookId(null)
    }
  }

  function handleRenameLook(look: TaggableLook) {
    const name = prompt('Rename look', look.name)
    if (name !== null) renameLook(look.id, name)
  }
  function handleRenameCapsule(capsule: TaggableCapsule) {
    const name = prompt('Rename capsule', capsule.name)
    if (name !== null) renameCapsule(capsule.id, name)
  }

  const activeBrush = brush ?? categories[0]?.id ?? null
  const labelOf = useMemo(() => {
    const m = new Map(categories.map((c) => [c.id, c.label]))
    return (id: string) => m.get(id) ?? '—'
  }, [categories])
  const activeBrushLabel = activeBrush ? labelOf(activeBrush) : null

  const items: (TaggableLook | TaggableCapsule)[] = mode === 'looks' ? looks : capsules
  const assignItem = mode === 'looks' ? assignLook : assignCapsule
  const setItemPublished = mode === 'looks' ? setLookPublished : setCapsulePublished
  const archiveItem = mode === 'looks' ? archiveLook : archiveCapsule
  const restoreItem = mode === 'looks' ? restoreLook : restoreCapsule

  const queueCount = (arr: { published: boolean; archived: boolean }[]) =>
    arr.filter((i) => !i.published && !i.archived).length

  const visible = useMemo(
    () => items.filter((i) => {
      if (status === 'all') return true
      if (status === 'archived') return i.archived
      if (status === 'published') return i.published && !i.archived
      return !i.published && !i.archived // queue
    }),
    [items, status],
  )

  // Per-card Edit/Rebuild + Rename actions for looks — shared between the queue grid and the
  // "On lookbook" arrange grid so GoodPix looks are editable from wherever Paige finds them.
  const lookCardActions = (look: TaggableLook) => (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); if (look.source === 'builder') { handleEditLook(look) } else { handleRebuildLook(look) } }}
        disabled={openingLookId === look.id}
        title={look.source === 'builder'
          ? 'Open this look on the canvas to edit it'
          : 'GoodPix look: lays its pieces out on the canvas as a NEW look to rearrange, swap, and save. The original stays on the lookbook until you archive it.'}
        className="mt-1 w-full flex items-center justify-center gap-1 py-1.5 text-[10px] tracking-[0.08em] uppercase rounded border border-[#E8E4DF] text-[#1A1A1A] hover:bg-[#F8F7F5] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <Pencil className="w-3 h-3" />
        {openingLookId === look.id ? 'Opening…' : look.source === 'builder' ? 'Edit' : 'Rebuild in canvas'}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); handleRenameLook(look) }}
        className="mt-1 w-full py-1 text-[9px] tracking-[0.12em] uppercase text-[#888] hover:text-[#1A1A1A] transition-colors"
        title="Rename this look everywhere, including the client lookbook"
      >Rename</button>
    </>
  )

  // The capsule twin of lookCardActions. ONE definition used by BOTH grids (the queue and the
  // published "arrange" grid) — the capsule Edit button used to be written inline in the queue
  // grid only, which is why a published capsule had no Edit and no capsule anywhere had Rename.
  // A third grid gets these for free.
  const capsuleCardActions = (capsule: TaggableCapsule) => (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); handleEditCapsule(capsule) }}
        disabled={!capsule.canvasState || editingCapsuleId === capsule.id}
        title={
          capsule.canvasState
            ? 'Open this capsule on the canvas to edit it'
            : "This capsule was built with \"Capsule from Looks\" and can't be reopened in the canvas — edit the underlying looks instead"
        }
        className="mt-1 w-full flex items-center justify-center gap-1 py-1.5 text-[10px] tracking-[0.08em] uppercase rounded border border-[#E8E4DF] text-[#1A1A1A] hover:bg-[#F8F7F5] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
      >
        <Pencil className="w-3 h-3" />
        {editingCapsuleId === capsule.id ? 'Opening…' : 'Edit'}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); handleRenameCapsule(capsule) }}
        className="mt-1 w-full py-1 text-[9px] tracking-[0.12em] uppercase text-[#888] hover:text-[#1A1A1A] transition-colors"
        title="Rename this capsule everywhere, including the client lookbook"
      >Rename</button>
    </>
  )

  /**
   * Copy link — a private, public-by-token URL for one look or capsule, to paste
   * into a text or an email. Deliberately available on DRAFTS as well as
   * published items: sending a draft packing capsule for review is the reason
   * this exists. Shown for both looks and capsules, in the queue grid and the
   * published arrange grid, so there is no view where the button is missing.
   */
  const shareCardActions = (itemId: string, shareToChat?: (id: string) => void) => {
    const kind = mode === 'capsules' ? 'capsule' : 'look'
    const key = `${kind}:${itemId}`
    const st = share.stateFor(kind, itemId)
    const working = share.busy === key
    return (
      <>
        {/* Two ways to send the same thing, so they sit on one row rather than
            growing the card a fifth full-width button: chat for a client who
            lives in the app, a copyable link for a text or an email. */}
        <div className="mt-1 flex items-stretch gap-1">
          {shareToChat && (
            <button
              onClick={(e) => { e.stopPropagation(); shareToChat(itemId) }}
              title="Send this straight into the client's Atelier chat"
              className="flex-1 py-1.5 text-[9px] tracking-[0.12em] uppercase rounded border border-[#E8E4DF] text-[#888] hover:text-[#1A1A1A] hover:bg-[#F8F7F5] transition-colors"
            >Share to chat</button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); void share.copyLink(kind, itemId) }}
            disabled={working}
            title="Copy a private link to paste into a text or an email. It opens a card the client can see without logging in — drafts included."
            className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[9px] tracking-[0.12em] uppercase rounded border border-[#E8E4DF] text-[#1A1A1A] hover:bg-[#F8F7F5] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Link2 className="w-3 h-3" />
            {working ? 'Working…' : 'Copy link'}
          </button>
        </div>
        {st && (
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-[9px] text-[#888] truncate" title={st.url}>
              {st.openCount > 0 ? (openedAgo(st.lastOpenedAt) ?? 'opened') : 'link live · not opened'}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); void share.revokeLink(kind, itemId) }}
              disabled={working}
              title="Kill this link. Anyone holding it stops being able to open it."
              className="flex-none text-[9px] tracking-[0.12em] uppercase text-[#888] hover:text-[#C30319] transition-colors"
            >Revoke</button>
          </div>
        )}
      </>
    )
  }

  const has = (item: { categoryIds: string[] }, catId: string) => item.categoryIds.includes(catId)

  function toggleOnItem(item: { id: string; categoryIds: string[] }, catId: string) {
    assignItem(item.id, catId, !has(item, catId))
  }

  function onCardClick(item: { id: string; categoryIds: string[] }) {
    if (selected.size > 0) {
      setSelected((prev) => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n })
      return
    }
    if (activeBrush) toggleOnItem(item, activeBrush)
  }

  function applyBrushToSelected(remove = false) {
    if (!activeBrush || selected.size === 0) return
    for (const item of items) {
      if (!selected.has(item.id)) continue
      const on = !remove
      if (has(item, activeBrush) !== on) assignItem(item.id, activeBrush, on)
    }
    setSelected(new Set())
  }

  function publishSelected(publish: boolean) {
    if (selected.size === 0) return
    for (const item of items) if (selected.has(item.id)) setItemPublished(item.id, publish)
    setSelected(new Set())
  }

  async function handleCreate() {
    const n = newCat.trim()
    if (!n) return
    const cat = await createCategory(n)
    if (cat) setBrush(cat.id)
    setNewCat('')
  }

  function startRename(id: string, current: string) {
    setEditing(id); setEditVal(current)
  }
  function commitRename() {
    if (editing && editVal.trim()) renameCategory(editing, editVal)
    setEditing(null); setEditVal('')
  }
  async function handleDeleteCategory(cat: LookCategory) {
    // window.confirm both asks and, for a refused residence, is the only thing shown.
    const plan = await deleteCategory(cat.id, (message) => window.confirm(message), activeClient?.name)
    if (plan?.action !== 'refuse' && activeBrush === cat.id) setBrush(null)
  }

  if (!activeClient) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 bg-[#F8F7F5]">
        <p className="text-[#888] text-sm tracking-[0.1em] uppercase">Select a client to categorize</p>
        <p className="text-[#aaa] text-xs">Use the client bar at the top left.</p>
      </div>
    )
  }

  const statuses: { key: Status; label: string }[] = [
    { key: 'draft', label: `Queue (${queueCount(items)})` },
    { key: 'published', label: 'On lookbook' },
    { key: 'archived', label: `Archived (${items.filter((i) => i.archived).length})` },
    { key: 'all', label: 'All' },
  ]

  return (
    <div className="flex-1 flex overflow-hidden bg-[#F8F7F5]">
      {/* Left rail: category brush + rename + create */}
      <aside className="w-[260px] flex-none border-r border-[#E8E4DF] bg-white flex flex-col">
        <div className="px-5 py-4 border-b border-[#E8E4DF]">
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#888]">Categorize</p>
          {chatStatus && <p className="mt-1 text-[10px] text-[#888] leading-snug">{chatStatus}</p>}
          {share.status && <p className="mt-1 text-[10px] text-[#888] leading-snug break-all">{share.status}</p>}
        </div>
        <div className="px-5 py-3 border-b border-[#E8E4DF] flex-1 overflow-hidden flex flex-col">
          {mode === 'audit' ? (
            <ReconcileFilterRail />
          ) : mode === 'transitions' ? (
            <>
              <p className="text-[9px] tracking-[0.3em] uppercase text-[#888] mb-2">Transitions</p>
              <p className="text-[10px] text-[#888] leading-relaxed">
                Pieces the client (or you) marked as no longer owned, and the looks pulled from her
                lookbook as a result. Restore a piece to bring it — and any look it alone was holding
                back — straight back to the lookbook.
              </p>
            </>
          ) : mode === 'residences' ? (
            <>
              <p className="text-[9px] tracking-[0.3em] uppercase text-[#888] mb-2">Residences</p>
              <p className="text-[10px] text-[#888] leading-relaxed">
                Looks that don't yet belong to one of her homes. Each one comes with a suggested
                residence and the reason for it — accept it, pick a different home, or skip.
              </p>
              <p className="text-[10px] text-[#888] leading-relaxed mt-3">
                Filing a look also files its pieces: the client's Collection reads residences from
                the looks a piece appears in, so you never have to tag garments one by one.
              </p>
              {residenceReview.openCount > 0 && (
                <p className="text-[10px] text-[#1A1A1A] leading-relaxed mt-3">
                  {residenceReview.openCount} waiting · {residenceReview.byConfidence.high} confident
                </p>
              )}
            </>
          ) : mode === 'review' ? (
            <>
              <p className="text-[9px] tracking-[0.3em] uppercase text-[#888] mb-2">Review</p>
              <p className="text-[10px] text-[#888] leading-relaxed">
                Clean up her collection: recover pieces hidden by mistake, fill in missing designers or
                categories so search works, and fix color mismatches. Use the pills on the right.
              </p>
            </>
          ) : mode === 'collection' ? (
            <>
              <p className="text-[9px] tracking-[0.3em] uppercase text-[#888] mb-2">Filter by category</p>
              <p className="text-[10px] text-[#888] mb-3 leading-relaxed">
                Garment categories from digitization. Click to filter the collection; edit any item with its pencil.
              </p>
              <div className="flex flex-col gap-1 overflow-y-auto pr-1">
                <button
                  onClick={() => setActiveGarmentCats(new Set())}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded text-[12px] transition-colors ${activeGarmentCats.size === 0 ? 'bg-[#1A1A1A] text-white' : 'text-[#1A1A1A] hover:bg-[#F8F7F5]'}`}
                >
                  <span>All items</span>
                  <span className={activeGarmentCats.size === 0 ? 'text-white/60' : 'text-[#bbb]'}>{garmentCounts.get('__total__') ?? 0}</span>
                </button>
                {SIDEBAR_STRUCTURE.map((node) => {
                  const slugs = node.kind === 'group' ? node.children : [node.slug]
                  const present = slugs.filter((s) => (garmentCounts.get(s) ?? 0) > 0)
                  if (present.length === 0) return null
                  return (
                    <div key={node.kind === 'group' ? node.label : node.slug} className="mt-1">
                      {node.kind === 'group' && (
                        <p className="text-[8px] tracking-[0.3em] uppercase text-[#bbb] px-3 mb-0.5">{node.label}</p>
                      )}
                      {present.map((slug) => {
                        const on = activeGarmentCats.has(slug)
                        return (
                          <button
                            key={slug}
                            onClick={() => toggleGarment(slug)}
                            className={`w-full flex items-center justify-between px-3 py-2 rounded text-[12px] transition-colors ${on ? 'bg-[#1A1A1A] text-white' : 'text-[#1A1A1A] hover:bg-[#F8F7F5]'}`}
                          >
                            <span>{CATEGORY_LABELS[slug]}</span>
                            <span className={on ? 'text-white/60' : 'text-[#bbb]'}>{garmentCounts.get(slug) ?? 0}</span>
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
                {(() => {
                  const customSlugs = [...garmentCounts.keys()].filter((s) => s !== '__total__' && !isFixedCategory(s) && (garmentCounts.get(s) ?? 0) > 0).sort()
                  if (customSlugs.length === 0) return null
                  return (
                    <div className="mt-1">
                      <p className="text-[8px] tracking-[0.3em] uppercase text-[#bbb] px-3 mb-0.5">Custom</p>
                      {customSlugs.map((slug) => {
                        const on = activeGarmentCats.has(slug)
                        return (
                          <button key={slug} onClick={() => toggleGarment(slug)}
                            className={`w-full flex items-center justify-between px-3 py-2 rounded text-[12px] transition-colors ${on ? 'bg-[#1A1A1A] text-white' : 'text-[#1A1A1A] hover:bg-[#F8F7F5]'}`}>
                            <span>{labelForCategory(slug)}</span>
                            <span className={on ? 'text-white/60' : 'text-[#bbb]'}>{garmentCounts.get(slug) ?? 0}</span>
                          </button>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>
            </>
          ) : (
            <>
          <p className="text-[9px] tracking-[0.3em] uppercase text-[#888] mb-2">Active category</p>
          <p className="text-[10px] text-[#888] mb-3 leading-relaxed">
            Pick one, then click {mode} to tag them. Shift-click to multi-select. Pencil renames everywhere.
          </p>
          <div className="flex flex-col gap-1 overflow-y-auto pr-1">
            {categories.filter((c) => !c.is_hidden).length === 0 && (
              <span className="text-[11px] text-[#bbb]">No categories yet — create one below.</span>
            )}
            {categories.filter((c) => !c.is_hidden).map((cat) => {
              const isActive = activeBrush === cat.id
              if (editing === cat.id) {
                return (
                  <div key={cat.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-[#F8F7F5]">
                    <input
                      value={editVal}
                      onChange={(e) => setEditVal(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setEditing(null); setEditVal('') } }}
                      autoFocus
                      className="flex-1 min-w-0 bg-white border border-[#1A1A1A] rounded px-2 py-1 text-[12px] focus:outline-none"
                    />
                    <button onClick={commitRename} className="flex-none w-6 h-6 flex items-center justify-center rounded bg-[#1A1A1A] text-white hover:opacity-80" aria-label="Save name">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              }
              return (
                <div
                  key={cat.id}
                  className={`group flex items-center justify-between rounded text-[12px] transition-colors ${
                    isActive ? 'bg-[#1A1A1A] text-white' : 'text-[#1A1A1A] hover:bg-[#F8F7F5]'
                  }`}
                >
                  <button onClick={() => setBrush(cat.id)} className="flex-1 text-left px-3 py-2 capitalize truncate">
                    {cat.label}
                  </button>
                  {/* Rename + Delete. Kept at opacity-60 rather than 0 because a hover-only
                      control does not exist on a tablet, which is where these are used. */}
                  <button
                    onClick={() => startRename(cat.id, cat.label)}
                    className={`flex-none p-1 rounded opacity-60 group-hover:opacity-100 transition-opacity ${isActive ? 'hover:bg-white/20' : 'hover:bg-[#E8E4DF]'}`}
                    aria-label={`Rename ${cat.label}`}
                    title="Rename (updates every look in this category)"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleDeleteCategory(cat)}
                    className={`flex-none mr-1.5 p-1 rounded opacity-60 group-hover:opacity-100 transition-opacity ${isActive ? 'hover:bg-white/20' : 'hover:bg-[#E8E4DF]'}`}
                    aria-label={`Delete ${cat.label}`}
                    title="Delete (removes it from the client's site)"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )
            })}
            {/* Hidden: a deleted category that still had looks filed under it lands here rather
                than being destroyed, so a mis-click is recoverable. It is already gone from the
                client's site — the lookbook filters is_hidden. */}
            {categories.some((c) => c.is_hidden) && (
              <div className="mt-3 pt-3 border-t border-[#E8E4DF]">
                <p className="text-[9px] tracking-[0.3em] uppercase text-[#bbb] mb-1.5">
                  Hidden ({categories.filter((c) => c.is_hidden).length}) — off her site
                </p>
                {categories.filter((c) => c.is_hidden).map((cat) => (
                  <div key={cat.id} className="group flex items-center justify-between rounded text-[12px] text-[#bbb] hover:bg-[#F8F7F5]">
                    <span className="flex-1 px-3 py-1.5 capitalize truncate line-through">{cat.label}</span>
                    <button
                      onClick={() => restoreCategory(cat.id)}
                      className="flex-none mr-1.5 p-1 rounded opacity-60 group-hover:opacity-100 hover:bg-[#E8E4DF] transition-opacity"
                      aria-label={`Restore ${cat.label}`}
                      title="Put this category back on the client's site"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
            </>
          )}
        </div>
        {mode !== 'collection' && mode !== 'audit' && mode !== 'transitions' && mode !== 'review' && mode !== 'residences' && (
        <div className="px-5 py-3 border-t border-[#E8E4DF]">
          <div className="flex items-center gap-1.5">
            <input
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="New category"
              className="flex-1 min-w-0 bg-[#F8F7F5] border border-[#E8E4DF] rounded px-2.5 py-1.5 text-[12px] text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A]"
            />
            <button onClick={handleCreate} className="flex-none w-8 h-8 flex items-center justify-center rounded bg-[#1A1A1A] text-white hover:opacity-80" aria-label="Create category">
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
        )}
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-3 border-b border-[#E8E4DF] bg-white gap-4 flex-wrap">
          <div className="flex items-center gap-1">
            {(['looks', 'residences', 'capsules', 'collection', 'audit', 'review', 'transitions'] as const)
              .filter((m) => m !== 'residences' || showResidences)
              .map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setSelected(new Set()) }}
                className={`relative px-4 py-1.5 text-[12px] tracking-[0.18em] uppercase rounded transition-colors ${mode === m ? 'bg-[#1A1A1A] text-white' : 'text-[#888] hover:text-[#1A1A1A]'}`}
              >
                {m}
                {m === 'transitions' && transitionCount > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-[#F8E5E7] text-[#1A1A1A] text-[10px] tracking-normal align-middle">{transitionCount}</span>
                )}
                {m === 'residences' && residenceReview.openCount > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-[#F8E5E7] text-[#1A1A1A] text-[10px] tracking-normal align-middle">{residenceReview.openCount}</span>
                )}
              </button>
            ))}
          </div>

          {(mode === 'looks' || mode === 'capsules') && (
          <div className="flex items-center gap-1 bg-[#F8F7F5] rounded p-0.5">
            {statuses.map((s) => (
              <button
                key={s.key}
                onClick={() => { setStatus(s.key); setSelected(new Set()) }}
                className={`px-3 py-1.5 text-[11px] tracking-[0.1em] uppercase rounded transition-colors ${status === s.key ? 'bg-white text-[#1A1A1A] shadow-sm' : 'text-[#888] hover:text-[#1A1A1A]'}`}
              >{s.label}</button>
            ))}
          </div>
          )}

          {selected.size > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[11px] text-[#888]">{selected.size} selected</span>
              {activeBrushLabel && (
                <>
                  <button onClick={() => applyBrushToSelected(false)} className="px-2.5 py-1.5 text-[11px] tracking-[0.08em] uppercase rounded bg-[#F8E5E7] text-[#1A1A1A] hover:brightness-95">+ {activeBrushLabel}</button>
                  <button onClick={() => applyBrushToSelected(true)} className="px-2.5 py-1.5 text-[11px] tracking-[0.08em] uppercase rounded border border-[#E8E4DF] text-[#888] hover:text-[#1A1A1A]">− {activeBrushLabel}</button>
                </>
              )}
              <button onClick={() => publishSelected(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] tracking-[0.08em] uppercase rounded bg-[#1A1A1A] text-white hover:opacity-80">
                <Send className="w-3 h-3" /> Add to lookbook
              </button>
              <button onClick={() => setSelected(new Set())} className="text-[11px] text-[#888] hover:text-[#1A1A1A]">Clear</button>
            </div>
          )}
        </div>

        {mode === 'audit' ? (
          <ErrorBoundary label="Audit couldn't render this collection">
            <ReconciliationPanel />
          </ErrorBoundary>
        ) : mode === 'review' ? (
          <ErrorBoundary label="Review couldn't render">
            <div className="flex-1 overflow-y-auto p-6">
              <ReviewTab clientId={activeClient?.id ?? null} clientName={activeClient?.name} />
            </div>
          </ErrorBoundary>
        ) : mode === 'transitions' ? (
          <ErrorBoundary label="Transitions couldn't render">
            <div className="flex-1 overflow-y-auto p-6">
              <TransitionsTab {...transitions} onRestyle={handleRestyleTransitionedLook} restylingId={openingLookId} />
            </div>
          </ErrorBoundary>
        ) : mode === 'residences' ? (
          <ErrorBoundary label="Residences couldn't render">
            <div className="flex-1 overflow-y-auto p-6">
              <ResidencesTab
                looks={looks}
                categories={categories}
                review={residenceReview}
                assignLook={assignLook}
              />
            </div>
          </ErrorBoundary>
        ) : (
        <div className="flex-1 overflow-y-auto p-6">
          {mode === 'collection' ? (
            <CollectionTab
              clientId={activeClient?.id ?? null}
              filterCategories={activeGarmentCats}
              onCategoryCounts={onGarmentCounts}
              onTransitioned={transitions.refetch}
            />
          ) : loading ? (
            <p className="text-[#888] text-sm">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="text-[#888] text-sm">
              {status === 'draft' ? `No ${mode} waiting in the queue — all caught up.` : `No ${mode} here.`}
            </p>
          ) : (mode === 'looks' || mode === 'capsules') && status === 'published' ? (
            <LookArrangeGrid
              items={visible as (TaggableLook | TaggableCapsule)[]}
              labelOf={labelOf}
              onReorder={mode === 'looks' ? reorderLooks : reorderCapsules}
              onRemove={(id) => setItemPublished(id, false)}
              onArchive={archiveItem}
              galleryName={mode === 'looks' ? 'Looks gallery' : 'Capsules'}
              activeBrushId={activeBrush}
              selected={selected}
              renderActions={(item) => (
                <>
                  {mode === 'looks' && lookCardActions(item as TaggableLook)}
                  {mode === 'capsules' && capsuleCardActions(item as TaggableCapsule)}
                  {shareCardActions(item.id, shareToChat)}
                </>
              )}
              onCardClick={(item, shiftKey) => {
                if (shiftKey) {
                  setSelected((prev) => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n })
                } else { onCardClick(item) }
              }}
            />
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-5">
              {visible.map((item) => {
                const isSel = selected.has(item.id)
                const hasBrush = activeBrush ? has(item, activeBrush) : false
                return (
                  <div
                    key={item.id}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        setSelected((prev) => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n })
                      } else { onCardClick(item) }
                    }}
                    className={`group relative cursor-pointer bg-white rounded-sm border-2 transition-all ${
                      isSel ? 'border-[#1A1A1A]' : hasBrush ? 'border-[#F8E5E7]' : 'border-transparent hover:border-[#E8E4DF]'
                    }`}
                  >
                    {/* status pill */}
                    <span className={`absolute top-1.5 left-1.5 z-10 text-[8px] tracking-[0.12em] uppercase px-1.5 py-0.5 rounded ${
                      item.archived ? 'bg-[#E8E4DF] text-[#6b6b6b]' : item.published ? 'bg-[#1A1A1A] text-white' : 'bg-[#F8E5E7] text-[#1A1A1A]'
                    }`}>{item.archived ? 'Archived' : item.published ? 'Live' : 'Draft'}</span>

                    {/* archive (non-archived cards) */}
                    {!item.archived && (
                      <button
                        onClick={(e) => { e.stopPropagation(); archiveItem(item.id) }}
                        className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-full bg-white/90 border border-[#E8E4DF] flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[#1A1A1A] hover:text-white"
                        aria-label="Archive"
                        title="Archive (remove, keep recoverable)"
                      ><X className="w-3 h-3" /></button>
                    )}

                    <div className="aspect-square flex items-center justify-center p-2 overflow-hidden">
                      {item.image ? (
                        <img src={item.image} alt={item.name} className="max-w-full max-h-full object-contain" loading="lazy" />
                      ) : (
                        <Tag className="w-6 h-6 text-[#E8E4DF]" />
                      )}
                    </div>
                    <div className="px-2.5 pb-2.5">
                      <p className="text-[11px] text-[#1A1A1A] truncate">{item.name}</p>
                      <div className="flex flex-wrap gap-1 mt-1 min-h-[16px]">
                        {item.categoryIds.length === 0
                          ? <span className="text-[9px] text-[#bbb] tracking-[0.1em] uppercase">uncategorized</span>
                          : item.categoryIds.map((cid) => (
                              <span key={cid} className="text-[9px] px-1.5 py-0.5 rounded bg-[#F8E5E7]/60 text-[#1A1A1A] capitalize">{labelOf(cid)}</span>
                            ))}
                      </div>
                      {/* actions */}
                      {item.archived ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); restoreItem(item.id) }}
                          className="mt-2 w-full py-1.5 text-[10px] tracking-[0.08em] uppercase rounded bg-[#1A1A1A] text-white hover:opacity-80"
                        >Restore to queue</button>
                      ) : (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); setItemPublished(item.id, !item.published) }}
                            className={`mt-2 w-full flex items-center justify-center gap-1 py-1.5 text-[10px] tracking-[0.08em] uppercase rounded transition-colors ${
                              item.published
                                ? 'border border-[#E8E4DF] text-[#888] hover:text-[#1A1A1A]'
                                : 'bg-[#1A1A1A] text-white hover:opacity-80'
                            }`}
                          >
                            {item.published ? 'Remove from lookbook' : <><Send className="w-3 h-3" /> Add to lookbook</>}
                          </button>
                          {mode === 'looks' && lookCardActions(item as TaggableLook)}
                          {mode === 'capsules' && capsuleCardActions(item as TaggableCapsule)}
                          {shareCardActions(item.id, shareToChat)}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  )
}
