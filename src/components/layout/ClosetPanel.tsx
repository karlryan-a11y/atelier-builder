import { useState, useMemo } from 'react'
import { Search, ChevronDown } from 'lucide-react'
import { useClients } from '@/hooks/useClients'
import { useClosetItems } from '@/hooks/useClosetItems'
import { useContentTags } from '@/hooks/useContentTags'
import { useClientStore } from '@/stores/clientStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { resolveItemImage } from '@/lib/images'
import { useDraggable } from '@dnd-kit/core'
import type { ClosetItemNode } from '@/types/canvas'

function DraggableItem({
  item,
  onAdd,
}: {
  item: { id: string; name: string; brand: string; imageUrl: string | null }
  onAdd: () => void
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
      <div className="aspect-[3/4] bg-tile rounded-sm overflow-hidden mb-1.5 flex items-center justify-center">
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
      <p className="text-[10px] text-text-muted truncate">{item.brand}</p>
    </div>
  )
}

export function ClosetPanel() {
  const { clients } = useClients()
  const { activeClient, setActiveClient } = useClientStore()
  const { items, itemTagIds, loading } = useClosetItems(activeClient?.id ?? null)
  const { categories, tags } = useContentTags()
  const { addNode, state } = useCanvasStore()
  const [search, setSearch] = useState('')
  const [activeTagId, setActiveTagId] = useState<string | null>(null)
  const [clientPickerOpen, setClientPickerOpen] = useState(false)
  const [clientSearch, setClientSearch] = useState('')

  const usedTagIds = useMemo(() => {
    const ids = new Set<string>()
    for (const tagIds of itemTagIds.values()) {
      for (const tid of tagIds) ids.add(tid)
    }
    return ids
  }, [itemTagIds])

  const visibleCategories = useMemo(() => {
    return categories.filter((c) => c.client_visible)
  }, [categories])

  const tagsByCategory = useMemo(() => {
    const map = new Map<string, typeof tags>()
    for (const cat of visibleCategories) {
      const catTags = tags
        .filter((t) => t.category_id === cat.id && usedTagIds.has(t.id))
        .sort((a, b) => a.display_name.localeCompare(b.display_name))
      if (catTags.length > 0) map.set(cat.id, catTags)
    }
    return map
  }, [visibleCategories, tags, usedTagIds])

  const filtered = useMemo(() => {
    let result = items
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (i) => i.name?.toLowerCase().includes(q) || i.brand?.toLowerCase().includes(q)
      )
    }
    if (activeTagId) {
      result = result.filter((i) => (itemTagIds.get(i.id) ?? []).includes(activeTagId))
    }
    return result
  }, [items, itemTagIds, search, activeTagId])

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
                      setActiveTagId(null)
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

          {/* Tag filters grouped by category */}
          {tagsByCategory.size > 0 && (
            <div className="px-3 py-2 border-b border-border max-h-40 overflow-y-auto space-y-1.5">
              <button
                onClick={() => setActiveTagId(null)}
                className={`text-[9px] tracking-[0.2em] uppercase px-2 py-0.5 rounded-full border transition-colors ${
                  !activeTagId
                    ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                    : 'border-border text-text-muted hover:border-blush'
                }`}
              >
                All
              </button>
              {visibleCategories
                .filter((cat) => tagsByCategory.has(cat.id))
                .map((cat) => (
                  <div key={cat.id}>
                    <p className="text-[8px] tracking-[0.3em] uppercase text-text-muted/40 mb-0.5">{cat.name}</p>
                    <div className="flex flex-wrap gap-1">
                      {tagsByCategory.get(cat.id)!.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setActiveTagId(activeTagId === t.id ? null : t.id)}
                          className={`text-[9px] tracking-[0.2em] uppercase px-2 py-0.5 rounded-full border transition-colors ${
                            activeTagId === t.id
                              ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                              : 'border-border text-text-muted hover:border-blush'
                          }`}
                        >
                          {t.display_name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
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
                        name: item.name,
                        brand: item.brand,
                        imageUrl,
                      }}
                      onAdd={() => addItemToCanvas(item.id, imageUrl)}
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
    </div>
  )
}
