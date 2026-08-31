import { useState, useMemo, useEffect } from 'react'
import { Search, Pencil, StickyNote, ZoomIn, X, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useClosetItems } from '@/hooks/useClosetItems'
import { CATEGORY_LABELS, SIDEBAR_STRUCTURE } from '@/lib/categorize'
import { categoriesOf, labelForCategory, isFixedCategory, customCategoriesFromItems } from '@/lib/garmentCategory'
import { useClientStore } from '@/stores/clientStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { resolveItemImage, displayName, type ClosetItem } from '@/lib/images'
import { supabase } from '@/lib/supabase'
import { useDraggable } from '@dnd-kit/core'
import type { ClosetItemNode } from '@/types/canvas'
import { EditItemDialog } from './EditItemDialog'

function DraggableItem({
  item,
  onAdd,
  onEdit,
  onZoom,
  hasNote,
}: {
  item: { id: string; name: string; brand: string; color: string | null; imageUrl: string | null }
  onAdd: () => void
  onEdit: () => void
  onZoom: () => void
  hasNote: boolean
}) {
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
          onAdd()
        }
      }}
    >
      <div className="relative aspect-[3/4] bg-tile rounded-sm overflow-hidden mb-1.5 flex items-center justify-center">
        <button
          type="button"
          title="View larger"
          onClick={(e) => { e.stopPropagation(); onZoom() }}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-1 right-7 z-10 p-1 rounded-sm bg-white/90 text-text-muted opacity-0 group-hover:opacity-100 hover:text-text transition-opacity shadow-sm"
        >
          <ZoomIn className="h-3 w-3" />
        </button>
        <button
          type="button"
          title="Edit item"
          onClick={(e) => { e.stopPropagation(); onEdit() }}
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
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
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
}

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
          {imageUrl ? (
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
  const { activeClient } = useClientStore()
  const { items, tagNameById, loading, error, refetch } = useClosetItems(activeClient?.id ?? null)
  const { addNode, state } = useCanvasStore()
  const [search, setSearch] = useState('')
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set())
  const [editingItem, setEditingItem] = useState<ClosetItem | null>(null)
  const [savingItem, setSavingItem] = useState(false)
  const [zoomIndex, setZoomIndex] = useState<number | null>(null)

  async function handleSaveItem(data: { name_override: string | null; brand: string | null; color: string | null; style_note: string | null; category: string | null; custom_categories?: string[] | null }) {
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
      })
      .eq('id', editingItem.id)
    setSavingItem(false)
    if (error) {
      console.error('Failed to save item edits:', error)
      return
    }
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
    return result
  }, [items, search, activeCategories, categoriesByItem])

  function addItemToCanvas(itemId: string, imageUrl: string | null) {
    // Drop near the board center at a readable height (target_height) so it's easy to grab and
    // resize — not full source resolution. Cascade a little so repeated adds don't stack exactly.
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
  }

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

          {/* Garment-category filters (Clothing / Shoes / Handbags / Jewelry / Accessories) */}
          {categoryCounts.size > 0 && (
            <div className="px-3 py-2 border-b border-border max-h-48 overflow-y-auto space-y-1.5">
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
              {SIDEBAR_STRUCTURE.map((node) => {
                const slugs = node.kind === 'group' ? node.children : [node.slug]
                const present = slugs.filter((s) => (categoryCounts.get(s) ?? 0) > 0)
                if (present.length === 0) return null
                return (
                  <div key={node.kind === 'group' ? node.label : node.slug}>
                    {node.kind === 'group' && (
                      <p className="text-[8px] tracking-[0.3em] uppercase text-text-muted/40 mb-0.5">{node.label}</p>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {present.map((slug) => {
                        const on = activeCategories.has(slug)
                        return (
                          <button
                            key={slug}
                            onClick={() => toggleCategory(slug)}
                            className={`text-[9px] tracking-[0.2em] uppercase px-2 py-0.5 rounded-full border transition-colors ${
                              on
                                ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                                : 'border-border text-text-muted hover:border-blush'
                            }`}
                          >
                            {CATEGORY_LABELS[slug]}
                            <span className={`ml-1 ${on ? 'text-white/60' : 'text-text-muted/50'}`}>{categoryCounts.get(slug) ?? 0}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              {(() => {
                const customSlugs = [...categoryCounts.keys()].filter((s) => !isFixedCategory(s) && (categoryCounts.get(s) ?? 0) > 0).sort()
                if (customSlugs.length === 0) return null
                return (
                  <div>
                    <p className="text-[8px] tracking-[0.3em] uppercase text-text-muted/40 mb-0.5">Custom</p>
                    <div className="flex flex-wrap gap-1">
                      {customSlugs.map((slug) => {
                        const on = activeCategories.has(slug)
                        return (
                          <button
                            key={slug}
                            onClick={() => toggleCategory(slug)}
                            className={`text-[9px] tracking-[0.2em] uppercase px-2 py-0.5 rounded-full border transition-colors ${on ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' : 'border-border text-text-muted hover:border-blush'}`}
                          >
                            {labelForCategory(slug)}
                            <span className={`ml-1 ${on ? 'text-white/60' : 'text-text-muted/50'}`}>{categoryCounts.get(slug) ?? 0}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
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
                {filtered.map((item, idx) => {
                  const imageUrl = resolveItemImage(item)
                  return (
                    <DraggableItem
                      key={item.id}
                      item={{
                        id: item.id,
                        name: displayName(item),
                        brand: item.brand,
                        color: item.color,
                        imageUrl,
                      }}
                      hasNote={!!item.style_note?.trim()}
                      onAdd={() => addItemToCanvas(item.id, imageUrl)}
                      onEdit={() => setEditingItem(item)}
                      onZoom={() => setZoomIndex(idx)}
                    />
                  )
                })}
              </div>
            )}
            {!loading && filtered.length > 0 && (
              <p className="text-[10px] tracking-[0.2em] uppercase text-text-muted/30 text-center mt-4 pb-2">
                {filtered.length} piece{filtered.length !== 1 ? 's' : ''}
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
          onAdd={(item) => addItemToCanvas(item.id, resolveItemImage(item))}
        />
      )}
    </div>
  )
}
