import { useState, useMemo } from 'react'
import { Search, ChevronDown, Pencil, StickyNote } from 'lucide-react'
import { useClients } from '@/hooks/useClients'
import { useClosetItems } from '@/hooks/useClosetItems'
import { useContentTags } from '@/hooks/useContentTags'
import { CATEGORY_LABELS, SIDEBAR_STRUCTURE } from '@/lib/categorize'
import { categoryOf, labelForCategory, isFixedCategory, customCategoriesFromItems } from '@/lib/garmentCategory'
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
  hasNote,
}: {
  item: { id: string; name: string; brand: string; color: string | null; imageUrl: string | null }
  onAdd: () => void
  onEdit: () => void
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

export function ClosetPanel() {
  const { clients } = useClients()
  const { activeClient, setActiveClient } = useClientStore()
  const { items, itemTagIds, loading, error, refetch } = useClosetItems(activeClient?.id ?? null)
  const { tags } = useContentTags()
  const { addNode, state } = useCanvasStore()
  const [search, setSearch] = useState('')
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set())
  const [clientPickerOpen, setClientPickerOpen] = useState(false)
  const [clientSearch, setClientSearch] = useState('')
  const [editingItem, setEditingItem] = useState<ClosetItem | null>(null)
  const [savingItem, setSavingItem] = useState(false)

  async function handleSaveItem(data: { name_override: string | null; color: string | null; style_note: string | null; category: string | null }) {
    if (!editingItem) return
    setSavingItem(true)
    const { error } = await supabase
      .from('gp_closet_items')
      .update({ name_override: data.name_override, color: data.color, style_note: data.style_note, category: data.category })
      .eq('id', editingItem.id)
    setSavingItem(false)
    if (error) {
      console.error('Failed to save item edits:', error)
      return
    }
    setEditingItem(null)
    refetch()
  }

  // Resolve every item to ONE garment category, using the same resolver the
  // lookbook uses (stylist override → content tag → name detection).
  const tagNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of tags) m.set(t.id, String(t.display_name ?? ''))
    return m
  }, [tags])

  const categoryByItem = useMemo(() => {
    const m = new Map<string, string>()
    for (const i of items) {
      const tagNames = (itemTagIds.get(i.id) ?? []).map((id) => tagNameById.get(id) ?? '').filter(Boolean)
      m.set(i.id, categoryOf(i, tagNames))
    }
    return m
  }, [items, itemTagIds, tagNameById])

  const customCats = useMemo(() => customCategoriesFromItems(items), [items])

  // How many of this client's items fall in each category — shown on the chip.
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const cat of categoryByItem.values()) counts.set(cat, (counts.get(cat) ?? 0) + 1)
    return counts
  }, [categoryByItem])

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
      // Multi-select unions: show items in ANY selected garment category.
      result = result.filter((i) => activeCategories.has(categoryByItem.get(i.id) ?? ''))
    }
    return result
  }, [items, search, activeCategories, categoryByItem])

  function addItemToCanvas(itemId: string, imageUrl: string | null) {
    const node: ClosetItemNode = {
      id: `ci_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'closet_item',
      closet_item_id: itemId,
      x: 200 + Math.random() * 400,
      y: 300 + Math.random() * 400,
      scale: 1,
      rotation: 0,
      flipped: false,
      z_index: state.nodes.length,
      locked: false,
    }
    addNode(node, imageUrl ?? undefined)
  }

  return (
    <div className="w-72 border-r border-border bg-white flex flex-col overflow-hidden">
      {/* Client picker */}
      <div className="p-3 border-b border-border relative">
        <button
          onClick={() => {
            setClientPickerOpen(!clientPickerOpen)
            setClientSearch('')
          }}
          className="w-full flex items-center justify-between text-left px-2 py-1.5 rounded hover:bg-tile transition-colors"
        >
          <div>
            <p className="text-[10px] tracking-[0.35em] uppercase text-text-muted/60">Client</p>
            <p className="text-sm font-medium text-text mt-0.5">
              {activeClient?.name ?? 'Select client...'}
            </p>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
        </button>

        {clientPickerOpen && (
          <div className="absolute left-3 right-3 top-full mt-1 bg-white border border-border rounded-sm shadow-lg z-50 max-h-72 flex flex-col overflow-hidden">
            <div className="p-2 border-b border-border">
              <input
                type="text"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Search clients..."
                autoFocus
                className="w-full bg-tile rounded-sm px-2.5 py-1.5 text-[11px] tracking-[0.1em] placeholder:text-text-muted/40 placeholder:uppercase focus:outline-none focus:ring-1 focus:ring-blush"
              />
            </div>
            <div className="overflow-y-auto">
              {clients
                .filter((c) => !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase()))
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setActiveClient(c)
                      setClientPickerOpen(false)
                      setClientSearch('')
                      setSearch('')
                      setActiveCategories(new Set())
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-tile transition-colors ${
                      activeClient?.id === c.id ? 'bg-tile font-medium' : ''
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>

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
                {filtered.map((item) => {
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
          onSave={handleSaveItem}
          onClose={() => setEditingItem(null)}
        />
      )}
    </div>
  )
}
