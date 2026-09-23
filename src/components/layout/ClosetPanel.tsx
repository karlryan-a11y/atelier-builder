import { useState, useMemo, useEffect, useCallback, useRef, memo } from 'react'
import { Search, Pencil, StickyNote, ZoomIn, X, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useClosetItems } from '@/hooks/useClosetItems'
import { categoriesOf, labelForCategory, customCategoriesFromItems } from '@/lib/garmentCategory'
import { useClientStore } from '@/stores/clientStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { resolveItemImage, displayName, type ClosetItem } from '@/lib/images'
import { supabase } from '@/lib/supabase'
import { useDraggable } from '@dnd-kit/core'
import type { ClosetItemNode } from '@/types/canvas'
import { EditItemDialog } from './EditItemDialog'
import { TileImage } from '@/components/common/TileImage'
import { PIECE_TILE_WIDTH } from '@/lib/derivedImage'
import { useItemLookUsage } from '@/hooks/useItemLookUsage'
import { styledCoverage, styledStateOf, STYLED_STATE_LABEL, type PieceStyledState } from '@/lib/styledCoverage'

/** Remembered per stylist: whoever wants the chips opened out wants it on every client. */
const CATS_EXPANDED_KEY = 'atelier.closetCategoriesExpanded'

/**
 * One closet tile. MEMOISED, and every prop is either the cached item object (same identity
 * until that piece changes), a primitive, or a callback that never changes identity. Up to
 * ~1,300 of these sit beside the canvas, and a tap on the board used to re-render every one of
 * them: App and this panel read the whole canvas store, so a selection re-rendered the panel and
 * the panel re-rendered the grid. scripts/perf/style-harness.mjs counts tile renders per board
 * tap; the answer must be 0.
 */
const DraggableItem = memo(function DraggableItem({
  item: piece,
  index,
  styled,
  onAdd,
  onEdit,
  onZoom,
}: {
  item: ClosetItem
  index: number
  /** Where this piece stands: styled / draft / none. A PRIMITIVE, see the note above. */
  styled: PieceStyledState
  onAdd: (item: ClosetItem) => void
  onEdit: (item: ClosetItem) => void
  onZoom: (index: number) => void
}) {
  const item = useMemo(() => ({
    id: piece.id,
    name: displayName(piece),
    brand: piece.brand,
    color: piece.color,
    imageUrl: resolveItemImage(piece),
  }), [piece])
  const hasNote = !!piece.style_note?.trim()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    data: { type: 'closet_item', closetItemId: item.id, imageUrl: item.imageUrl },
  })

  const style: React.CSSProperties = {
    touchAction: 'none',
    ...(transform
      ? { transform: `translate(${transform.x}px, ${transform.y}px)`, opacity: isDragging ? 0.5 : 1 }
      : {}),
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={style}
      className="group cursor-grab active:cursor-grabbing"
      onClick={(e) => {
        if (!transform) {
          e.stopPropagation()
          onAdd(piece)
        }
      }}
    >
      <div className="relative aspect-[3/4] bg-tile rounded-sm overflow-hidden mb-1.5 flex items-center justify-center">
        <button
          type="button"
          title="View larger"
          onClick={(e) => { e.stopPropagation(); onZoom(index) }}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-1 right-7 z-10 p-1 rounded-sm bg-white/90 text-text-muted opacity-0 group-hover:opacity-100 hover:text-text transition-opacity shadow-sm"
        >
          <ZoomIn className="h-3 w-3" />
        </button>
        <button
          type="button"
          title="Edit item"
          onClick={(e) => { e.stopPropagation(); onEdit(piece) }}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-1 right-1 z-10 p-1 rounded-sm bg-white/90 text-text-muted opacity-0 group-hover:opacity-100 hover:text-text transition-opacity shadow-sm"
        >
          <Pencil className="h-3 w-3" />
        </button>
        {hasNote && (
          <div
            title="Has a styling note"
            className="absolute top-1 left-1 z-10 h-4 w-4 rounded-full bg-blush/90 flex items-center justify-center shadow-sm"
          >
            <StickyNote className="h-2.5 w-2.5 text-text" />
          </div>
        )}
        {/*
          HAS THIS PIECE BEEN STYLED YET. Paige Berndt, 2026-09-21: "I have to pop back and fourth
          between her collection and the canvas to see what still needs to be styled, for a large
          project like Danielle's it would save me a lot of time." ADR-0134.

          Bottom-left, so it never sits under the note dot or the two hover buttons. A filled mark
          is a piece the client can see; a hollow one is in drafts only; nothing at all means it
          has never been in a look, which is the state she is hunting for, so it is the one that
          reads as empty.
        */}
        {styled !== 'none' && (
          <div
            title={STYLED_STATE_LABEL[styled]}
            aria-label={STYLED_STATE_LABEL[styled]}
            className={`absolute bottom-1 left-1 z-10 h-3 w-3 rounded-full shadow-sm ${
              styled === 'styled' ? 'bg-[#1A1A1A]' : 'bg-white border-2 border-[#1A1A1A]'
            }`}
          />
        )}
        {item.imageUrl ? (
          <TileImage
            src={item.imageUrl}
            width={PIECE_TILE_WIDTH}
            alt={item.name}
            className="max-w-full max-h-full object-contain group-hover:scale-[1.02] transition-transform duration-200"
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-[10px] tracking-[0.2em] uppercase text-text-muted/40">No image</span>
          </div>
        )}
      </div>
      <p className="text-[11px] font-medium text-text truncate">{item.name}</p>
      <p className="text-[10px] text-text-muted truncate">
        {item.brand}
        {item.color ? <span className="text-text-muted/60">{item.brand ? ' · ' : ''}{item.color}</span> : null}
      </p>
    </div>
  )
})

// Click the magnifier on a tile → an enlarged view of the garment with its details, and
// prev/next stepping through the CURRENT filtered list (Cynthia: telling apart "so many
// similar tops"). Backdrop / ✕ / Esc closes; ← → (buttons or arrow keys) step.
function ClosetLightbox({
  items,
  index,
  onIndexChange,
  onClose,
  onAdd,
}: {
  items: ClosetItem[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
  onAdd: (item: ClosetItem) => void
}) {
  const item = items[index]
  const atStart = index <= 0
  const atEnd = index >= items.length - 1

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
      else if (e.key === 'ArrowRight' && index < items.length - 1) onIndexChange(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items.length, onClose, onIndexChange])

  if (!item) return null
  const imageUrl = resolveItemImage(item)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-sm shadow-xl max-w-lg w-full max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          title="Close"
          onClick={onClose}
          className="absolute top-2 right-2 z-10 p-1.5 rounded-sm bg-white/90 text-text-muted hover:text-text shadow-sm transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Image */}
        <div className="flex-1 min-h-0 bg-tile flex items-center justify-center p-6">
          {imageUrl ? ( // full-size: the one-piece zoom preview, not a grid tile
            <img src={imageUrl} alt={displayName(item)} className="max-w-full max-h-[62vh] object-contain" />
          ) : (
            <span className="text-[10px] tracking-[0.2em] uppercase text-text-muted/40">No image</span>
          )}
        </div>

        {/* Prev / next */}
        {items.length > 1 && (
          <>
            <button
              type="button"
              title="Previous"
              onClick={() => !atStart && onIndexChange(index - 1)}
              disabled={atStart}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-white/90 shadow-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-default transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              title="Next"
              onClick={() => !atEnd && onIndexChange(index + 1)}
              disabled={atEnd}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-white/90 shadow-sm text-text-muted hover:text-text disabled:opacity-30 disabled:cursor-default transition-colors"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}

        {/* Details */}
        <div className="border-t border-border px-4 py-3">
          <p className="text-[13px] font-medium text-text">{displayName(item)}</p>
          <p className="text-[11px] text-text-muted mt-0.5">
            {item.brand}
            {item.color ? <span className="text-text-muted/60">{item.brand ? ' · ' : ''}{item.color}</span> : null}
          </p>
          {item.style_note?.trim() && (
            <p className="text-[11px] text-text-muted/80 italic mt-1.5 leading-snug">{item.style_note}</p>
          )}
          <div className="flex items-center justify-between mt-3">
            <span className="text-[9px] tracking-[0.2em] uppercase text-text-muted/40">{index + 1} / {items.length}</span>
            <button
              type="button"
              onClick={() => { onAdd(item); onClose() }}
              className="flex items-center gap-1 text-[9px] tracking-[0.2em] uppercase px-3 py-1 rounded-full border border-border text-text-muted hover:border-blush hover:text-text transition-colors"
            >
              <Plus className="h-3 w-3" /> Add to look
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ClosetPanel() {
  // NARROW subscriptions only. Reading the whole canvas store here re-rendered this panel, and
  // with it the whole closet grid, on every tap, drag and nudge on the board.
  const activeClient = useClientStore((s) => s.activeClient)
  const { items, tagNameById, loading, error, refetch, patchItems } = useClosetItems(activeClient?.id ?? null)
  const addNode = useCanvasStore((s) => s.addNode)
  const [search, setSearch] = useState('')
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set())
  // Which looks each piece is in, published and draft alike. The SAME hook the Collection tab
  // uses, so the mark on a tile here and the number over there cannot disagree (ADR-0134). It is
  // one read per client, shared through the Style cache, and it is read-only.
  const { byItem: lookUsage, error: usageError } = useItemLookUsage(activeClient?.id ?? null)
  const [unstyledOnly, setUnstyledOnly] = useState(false)
  /**
   * WHETHER THE CATEGORY CHIPS ARE OPENED OUT. ADR-0139.
   *
   * ADR-0136 took the height cap off so every category would be visible, and on a client with a
   * lot of them the chips ate the rail: Paige Berndt on Danielle York, 2026-09-23, "I am unable
   * to see pieces as I am on the canvas to style except for a tiny sliver of them in the corner".
   * Measured across the 134 clients who have categories: the median is 14 and 121 of them are
   * under 20, which is four rows and fine, but **Danielle York has 50 and Barbie 53** — around
   * 400 and 530 pixels of chips in a 288px rail. The heavy clients are the ones being styled.
   *
   * So the cap comes back at the height it was before ADR-0136, where it had never been reported
   * as a problem, and Cynthia Dada's own answer in that thread is what sits on top of it: "Maybe
   * you could make it collapsable Karl? So that way we can have the categories all at the top
   * when we need them but if they're in the way, we can collapse?"
   *
   * Collapsed still SCROLLS, so no category is unreachable either way; the toggle is about how
   * much room the chips take, never about what exists. It is remembered per stylist, because
   * whoever wants it open wants it open on every client.
   */
  const [catsExpanded, setCatsExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem(CATS_EXPANDED_KEY) === '1' } catch { return false }
  })
  const catsRef = useRef<HTMLDivElement>(null)
  // Whether the chips actually overflow the collapsed height. Measured rather than guessed from a
  // category count: the chips wrap, so "Denim" and "High-Top-Sneakers" are not the same width.
  const [catsOverflow, setCatsOverflow] = useState(false)
  const [editingItem, setEditingItem] = useState<ClosetItem | null>(null)
  const [savingItem, setSavingItem] = useState(false)
  const [zoomIndex, setZoomIndex] = useState<number | null>(null)

  async function handleSaveItem(data: { name_override: string | null; brand: string | null; color: string | null; style_note: string | null; category: string | null; custom_categories?: string[] | null; color_family?: string | null; color_families?: string[] | null }) {
    if (!editingItem) return
    setSavingItem(true)
    // This panel already FILTERS by categoriesOf (primary + "Also in"), so the chips it shows are
    // built from custom_categories — it has to be able to write the field it filters on. The key is
    // only present when the dialog manages it, so spreading it can never blank the column.
    const { error } = await supabase
      .from('gp_closet_items')
      .update({
        name_override: data.name_override, brand: data.brand, color: data.color,
        style_note: data.style_note, category: data.category,
        ...('custom_categories' in data ? { custom_categories: data.custom_categories } : {}),
        // Same guard for the colour set (ADR-0115): the key is only present when the dialog
        // manages it, so spreading it can never blank the columns.
        ...('color_family' in data ? { color_family: data.color_family, color_families: data.color_families } : {}),
      })
      .eq('id', editingItem.id)
    setSavingItem(false)
    if (error) {
      console.error('Failed to save item edits:', error)
      return
    }
    // Show the edit at once in every screen that shows this piece, then re-read in the background.
    patchItems([editingItem.id], {
      name_override: data.name_override, brand: data.brand as string, color: data.color,
      style_note: data.style_note, category: data.category,
      ...('custom_categories' in data ? { custom_categories: data.custom_categories } : {}),
      ...('color_family' in data ? { color_family: data.color_family, color_families: data.color_families } : {}),
    })
    setEditingItem(null)
    refetch()
  }

  // EVERY category an item belongs to — its primary garment category AND any "Also in"
  // groupings in custom_categories[] — resolved with the same helper and tag source the
  // Collection tab and the client lookbook use.
  //
  // This used to keep only the PRIMARY category (categoryOf), which silently disagreed with
  // the Collection tab: the category chips are built from custom_categories too, so a chip
  // could exist here and match almost nothing. Margaux's "New-York-City" read 50 pieces in
  // Collection and 4 on the canvas, because 46 of them carry it as an "Also in".
  const categoriesByItem = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const i of items) {
      const tagNames = (i.content_tag_ids ?? []).map((id) => tagNameById.get(id) ?? '').filter(Boolean)
      m.set(i.id, categoriesOf(i, tagNames))
    }
    return m
  }, [items, tagNameById])

  const customCats = useMemo(() => customCategoriesFromItems(items), [items])

  // How many of this client's items fall in each category — shown on the chip. An item in
  // several categories counts toward each, so these can sum above the item total (same as the
  // Collection tab and the lookbook's sidebar).
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const cats of categoriesByItem.values()) {
      for (const cat of cats) counts.set(cat, (counts.get(cat) ?? 0) + 1)
    }
    return counts
  }, [categoriesByItem])

  /**
   * The chips, in the order she reads them: every category with at least one piece, A to Z by
   * the label on screen. No rollup, no group headings, no "Custom" section — one list, like
   * GoodPix. ADR-0136. Sorted by LABEL, not slug, because the slug `jeans` is shown as "Denim"
   * and would otherwise sit between Hats and Jewelry.
   */
  const chipCategories = useMemo(() => {
    const out: { slug: string; label: string; count: number }[] = []
    for (const [slug, count] of categoryCounts) {
      if (count <= 0) continue
      out.push({ slug, label: labelForCategory(slug), count })
    }
    return out.sort((a, b) => a.label.localeCompare(b.label))
  }, [categoryCounts])

  // Does the collapsed block hide anything? Re-measured when her categories change or the panel
  // is opened out, so the toggle only appears on the clients that need it.
  useEffect(() => {
    const el = catsRef.current
    if (!el) { setCatsOverflow(false); return }
    setCatsOverflow(el.scrollHeight > el.clientHeight + 1)
  }, [chipCategories, catsExpanded])

  function toggleCatsExpanded() {
    setCatsExpanded((v) => {
      const next = !v
      try { localStorage.setItem(CATS_EXPANDED_KEY, next ? '1' : '0') } catch { /* private window */ }
      return next
    })
  }

  function toggleCategory(slug: string) {
    setActiveCategories((prev) => {
      const next = new Set(prev)
      next.has(slug) ? next.delete(slug) : next.add(slug)
      return next
    })
  }

  const filtered = useMemo(() => {
    let result = items
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (i) =>
          displayName(i).toLowerCase().includes(q) ||
          i.name?.toLowerCase().includes(q) ||
          i.brand?.toLowerCase().includes(q) ||
          i.color?.toLowerCase().includes(q)
      )
    }
    if (activeCategories.size > 0) {
      // Multi-select unions: show an item if ANY of its categories is selected.
      result = result.filter((i) => (categoriesByItem.get(i.id) ?? []).some((c) => activeCategories.has(c)))
    }
    // "Still to style" is the whole point of the marks: it narrows the rail to the pieces that
    // have never been in a look. A piece in a draft look is NOT still to style — it is styled and
    // unpublished, which is a different job, so it stays out of this list (ADR-0134).
    if (unstyledOnly) result = result.filter((i) => styledStateOf(lookUsage.get(i.id)) === 'none')
    return result
  }, [items, search, activeCategories, categoriesByItem, unstyledOnly, lookUsage])

  // The line under the grid, over whatever she has filtered to.
  const coverage = useMemo(() => styledCoverage(filtered.map((i) => i.id), lookUsage), [filtered, lookUsage])
  const unstyledInScope = useMemo(
    () => (unstyledOnly ? filtered.length : filtered.filter((i) => styledStateOf(lookUsage.get(i.id)) === 'none').length),
    [filtered, lookUsage, unstyledOnly],
  )

  // Stable identity (reads the board with getState at the moment of the add), so the memoised
  // tiles never re-render because this function was re-created.
  const addItemToCanvas = useCallback((itemId: string, imageUrl: string | null) => {
    // Drop near the board center at a readable height (target_height) so it's easy to grab and
    // resize — not full source resolution. Cascade a little so repeated adds don't stack exactly.
    const { state } = useCanvasStore.getState()
    const off = (state.nodes.length % 6) * 30
    const node: ClosetItemNode = {
      id: `ci_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'closet_item',
      closet_item_id: itemId,
      x: Math.round(state.canvas.width / 2 - 140 + off),
      y: Math.round(state.canvas.height / 2 - 190 + off),
      scale: 1,
      target_height: 340,
      rotation: 0,
      flipped: false,
      z_index: state.nodes.length,
      locked: false,
    }
    addNode(node, imageUrl ?? undefined)
  }, [addNode])
  const addPiece = useCallback((item: ClosetItem) => addItemToCanvas(item.id, resolveItemImage(item)), [addItemToCanvas])

  return (
    <div className="w-72 border-r border-border bg-white flex flex-col overflow-hidden">
      {activeClient && (
        <>
          {/* Search */}
          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-text-muted/50" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search pieces..."
                className="w-full bg-tile rounded-sm pl-8 pr-3 py-1.5 text-[11px] tracking-[0.1em] placeholder:text-text-muted/40 placeholder:uppercase focus:outline-none focus:ring-1 focus:ring-blush"
              />
            </div>
          </div>

          {/*
            STILL TO STYLE. The marks answer "has this one been styled"; this answers "show me the
            ones that have not", which is what Paige was tabbing between two screens to find. It
            sits above the garment chips because it narrows across all of them. ADR-0134.
          */}
          {!usageError && (
            <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
              <button
                onClick={() => setUnstyledOnly((v) => !v)}
                aria-pressed={unstyledOnly}
                className={`text-[9px] tracking-[0.2em] uppercase px-2 py-0.5 rounded-full border transition-colors ${
                  unstyledOnly
                    ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                    : 'border-border text-text-muted hover:border-blush'
                }`}
              >
                Still to style
                <span className={`ml-1 ${unstyledOnly ? 'text-white/60' : 'text-text-muted/50'}`}>{unstyledInScope}</span>
              </button>
              <span className="flex items-center gap-2 text-[8px] tracking-[0.2em] uppercase text-text-muted/40">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#1A1A1A]" />Styled</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-white border border-[#1A1A1A]" />Draft</span>
              </span>
            </div>
          )}

          {/*
            EVERY CATEGORY SHE HAS, ALL VISIBLE, THE WAY GOODPIX SHOWS THEM. ADR-0136.

            Cynthia Dada, 2026-09-22: "When creating a look in Atelier, can you please make it
            possible for the categories to all be visible at the top? It makes a difference with
            how long it takes to find items. The way goodpix has it is great" — and, twenty
            minutes later, "I had garments categorized correctly in Goodpix and now they are in
            different categories in Atelier".

            Those are the same complaint. The sync has never written `category` or
            `custom_categories` (see gp-sync itemRow: they are stylist-owned), and Atelier does
            hold her own fine labels — Janet Foutty carries 20 distinct ones, Peyton Wheeler 26,
            including blazers, cardigans, sweaters and tights. The rail was PRESENTING them
            through a Bergdorf-style rollup: nine fixed buckets with group headings first and
            everything else pushed under a "Custom" heading, inside a 192px box with its own
            scrollbar. So her blazers were filed correctly and simply were not where she looked.

            Now it is one flat, alphabetical row of chips with no headings and no inner scroll,
            which is both closer to GoodPix and SHORTER than the block it replaces: the three
            group headings and the Custom heading cost four rows on their own.

            The rollup itself is untouched — SIDEBAR_STRUCTURE still orders the Collection rail in
            Categorize and the client's own lookbook sidebar. This is the stylist's canvas only.
          */}
          {categoryCounts.size > 0 && (
            <div className="px-3 py-2 border-b border-border">
              {/*
                Collapsed it scrolls, so every chip is still reachable; expanded it takes the room
                it needs. `max-h-48` is the height this block had before ADR-0136, where it had
                never been reported as a problem. ADR-0139.
              */}
              <div ref={catsRef} className={`flex flex-wrap gap-1 ${catsExpanded ? '' : 'max-h-48 overflow-y-auto'}`}>
                <button
                  onClick={() => setActiveCategories(new Set())}
                  className={`text-[9px] tracking-[0.2em] uppercase px-2 py-0.5 rounded-full border transition-colors ${
                    activeCategories.size === 0
                      ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                      : 'border-border text-text-muted hover:border-blush'
                  }`}
                >
                  All
                </button>
                {chipCategories.map(({ slug, label, count }) => {
                  const on = activeCategories.has(slug)
                  return (
                    <button
                      key={slug}
                      onClick={() => toggleCategory(slug)}
                      title={label}
                      className={`text-[9px] tracking-[0.2em] uppercase px-2 py-0.5 rounded-full border transition-colors ${
                        on
                          ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                          : 'border-border text-text-muted hover:border-blush'
                      }`}
                    >
                      {label}
                      <span className={`ml-1 ${on ? 'text-white/60' : 'text-text-muted/50'}`}>{count}</span>
                    </button>
                  )
                })}
              </div>
              {/* Only on the clients where it changes anything: 121 of 134 never overflow. */}
              {(catsOverflow || catsExpanded) && (
                <button
                  onClick={toggleCatsExpanded}
                  aria-expanded={catsExpanded}
                  className="mt-1.5 text-[9px] tracking-[0.2em] uppercase text-text-muted/60 hover:text-text transition-colors"
                >
                  {catsExpanded ? 'Collapse categories' : `Show all ${chipCategories.length} categories`}
                </button>
              )}
            </div>
          )}

          {/* Item grid */}
          <div className="flex-1 overflow-y-auto p-3">
            {loading ? (
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i}>
                    <div className="aspect-[3/4] shimmer rounded-sm" />
                    <div className="h-3 shimmer rounded mt-1.5 w-3/4" />
                    <div className="h-2.5 shimmer rounded mt-1 w-1/2" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="text-center py-8 px-3">
                <p className="text-[10px] tracking-[0.3em] uppercase text-red-400/80">Couldn't load collection</p>
                <p className="text-[10px] text-text-muted/50 mt-2 normal-case tracking-normal break-words">{error}</p>
                <button
                  onClick={() => refetch()}
                  className="mt-3 text-[9px] tracking-[0.2em] uppercase px-3 py-1 rounded-full border border-border text-text-muted hover:border-blush transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-[10px] tracking-[0.3em] uppercase text-text-muted/40">
                  {items.length === 0 ? 'No pieces found' : 'No matches'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filtered.map((item, idx) => (
                  <DraggableItem
                    key={item.id}
                    item={item}
                    index={idx}
                    styled={styledStateOf(lookUsage.get(item.id))}
                    onAdd={addPiece}
                    onEdit={setEditingItem}
                    onZoom={setZoomIndex}
                  />
                ))}
              </div>
            )}
            {!loading && filtered.length > 0 && (
              <p className="text-[10px] tracking-[0.2em] uppercase text-text-muted/30 text-center mt-4 pb-2">
                {filtered.length} piece{filtered.length !== 1 ? 's' : ''}
                {/* A failed usage read would make every piece look unstyled, so say so instead. */}
                {usageError ? ' · styling unknown' : ` · ${coverage.styled} styled`}
              </p>
            )}
          </div>
        </>
      )}

      {!activeClient && (
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-[10px] tracking-[0.3em] uppercase text-text-muted/40 text-center">
            Select a client to browse their collection
          </p>
        </div>
      )}

      {editingItem && (
        <EditItemDialog
          item={editingItem}
          saving={savingItem}
          customCategories={customCats}
          enableMultiCategory
          onSave={handleSaveItem}
          onClose={() => setEditingItem(null)}
        />
      )}

      {zoomIndex !== null && filtered[zoomIndex] && (
        <ClosetLightbox
          items={filtered}
          index={zoomIndex}
          onIndexChange={setZoomIndex}
          onClose={() => setZoomIndex(null)}
          onAdd={addPiece}
        />
      )}
    </div>
  )
}
