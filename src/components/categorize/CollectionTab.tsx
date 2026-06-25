import { useEffect, useMemo, useState } from 'react'
import { Pencil, Search } from 'lucide-react'
import { useClosetItems } from '@/hooks/useClosetItems'
import { useContentTags } from '@/hooks/useContentTags'
import { resolveItemImage, displayName, type ClosetItem } from '@/lib/images'
import { resolveCategory, CATEGORY_LABELS, type Category } from '@/lib/categorize'
import { supabase } from '@/lib/supabase'
import { EditItemDialog } from '@/components/layout/EditItemDialog'

// COLLECTION tab inside Categorize: the stylist sees the client's collection the way the client
// does (her lookbook's Collection grid) but with per-item edit — hover an item → pencil → edit
// Name / Category / Color / Style Note. Saves to gp_closet_items (the same store the client view
// reads), so changes show in her lookbook. Reuses the closet hook + the canvas EditItemDialog.
// Each item's garment category is resolved with the SAME resolver as the lookbook + Style canvas
// (override → tag → name), so GoodPix carry-overs categorize too. Reports counts up for the rail
// filter and accepts a garment-category filter.
export function CollectionTab({ clientId, filterCategories, onCategoryCounts }: {
  clientId: string | null
  filterCategories?: Set<Category>
  onCategoryCounts?: (counts: Map<Category, number>) => void
}) {
  const { items, itemTagIds, loading, error, refetch } = useClosetItems(clientId)
  const { tags } = useContentTags()
  const [editing, setEditing] = useState<ClosetItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [q, setQ] = useState('')

  const tagNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of tags) m.set(t.id, String(t.display_name ?? ''))
    return m
  }, [tags])

  const categoryByItem = useMemo(() => {
    const m = new Map<string, Category>()
    for (const i of items) {
      const tagNames = (itemTagIds.get(i.id) ?? []).map((id) => tagNameById.get(id) ?? '').filter(Boolean)
      m.set(i.id, resolveCategory({ name: displayName(i), category: i.category }, tagNames))
    }
    return m
  }, [items, itemTagIds, tagNameById])

  // Report category counts up to the rail (present categories + counts for the filter chips).
  useEffect(() => {
    if (!onCategoryCounts) return
    const counts = new Map<Category, number>()
    for (const i of items) {
      if (i.is_deleted) continue
      const c = categoryByItem.get(i.id)
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    onCategoryCounts(counts)
  }, [categoryByItem, items, onCategoryCounts])

  const visible = useMemo(() => {
    let live = items.filter((i) => !i.is_deleted)
    if (filterCategories && filterCategories.size > 0) {
      live = live.filter((i) => filterCategories.has(categoryByItem.get(i.id) as Category))
    }
    const term = q.trim().toLowerCase()
    if (!term) return live
    return live.filter((i) =>
      displayName(i).toLowerCase().includes(term) ||
      (i.category ?? '').toLowerCase().includes(term) ||
      (i.brand ?? '').toLowerCase().includes(term))
  }, [items, q, filterCategories, categoryByItem])

  async function save(data: { name_override: string | null; color: string | null; style_note: string | null; category: string | null }) {
    if (!editing) return
    setSaving(true)
    const { error: e } = await supabase.from('gp_closet_items').update(data).eq('id', editing.id)
    setSaving(false)
    if (e) { console.error('Failed to save item edits:', e); return }
    setEditing(null)
    refetch()
  }

  if (!clientId) return <p className="text-[#888] text-sm">Select a client to view their collection.</p>
  if (loading) return <p className="text-[#888] text-sm">Loading collection…</p>
  if (error) return <p className="text-[#a33] text-sm">Couldn't load collection — {error}</p>

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#aaa]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search collection…"
            className="pl-8 pr-3 py-2 text-sm border border-[#E8E4DF] rounded-sm focus:outline-none focus:ring-1 focus:ring-blush w-64"
          />
        </div>
        <span className="text-[11px] tracking-[0.1em] uppercase text-[#888]">{visible.length} item{visible.length === 1 ? '' : 's'}</span>
        <span className="text-[11px] text-[#aaa] ml-auto">Hover an item → pencil to edit name, category, color &amp; note</span>
      </div>

      {visible.length === 0 ? (
        <p className="text-[#888] text-sm">{q ? 'No items match your search.' : 'This client has no collection items yet.'}</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {visible.map((item) => {
            const img = resolveItemImage(item)
            return (
              <div key={item.id} className="group relative border border-[#E8E4DF] rounded-sm overflow-hidden bg-white">
                <button
                  title="Edit item"
                  onClick={() => setEditing(item)}
                  className="absolute top-1.5 right-1.5 z-10 p-1.5 rounded-sm bg-white/90 text-[#888] opacity-0 group-hover:opacity-100 hover:text-[#1A1A1A] transition-opacity shadow-sm"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <div className="aspect-square bg-[#F8F7F5] flex items-center justify-center">
                  {img ? (
                    <img src={img} alt={displayName(item)} className="max-w-full max-h-full object-contain p-2.5" loading="lazy" />
                  ) : (
                    <span className="text-[10px] tracking-[0.2em] uppercase text-[#bbb]">No image</span>
                  )}
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-[13px] text-[#1A1A1A] truncate">{displayName(item) || 'Untitled item'}</p>
                  <p className="text-[10px] tracking-[0.18em] uppercase text-[#aaa] mt-0.5 truncate">{CATEGORY_LABELS[categoryByItem.get(item.id) ?? 'other']}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && <EditItemDialog item={editing} saving={saving} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  )
}
