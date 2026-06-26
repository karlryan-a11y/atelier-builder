import { useEffect, useMemo, useState } from 'react'
import { Pencil, Search } from 'lucide-react'
import { useClosetItems } from '@/hooks/useClosetItems'
import { useContentTags } from '@/hooks/useContentTags'
import { resolveItemImage, displayName, type ClosetItem } from '@/lib/images'
import { categoryOf, labelForCategory, customCategoriesFromItems } from '@/lib/garmentCategory'
import { supabase } from '@/lib/supabase'
import { EditItemDialog } from '@/components/layout/EditItemDialog'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

// COLLECTION tab inside Categorize: the stylist sees the client's collection the way the client
// does (her lookbook's Collection grid) but with per-item edit — hover an item → pencil → edit
// Name / Category / Color / Style Note. Saves to gp_closet_items (the same store the client view
// reads), so changes show in her lookbook. Reuses the closet hook + the canvas EditItemDialog.
// Each item's garment category is resolved with the SAME resolver as the lookbook + Style canvas
// (override → tag → name), so GoodPix carry-overs categorize too. Reports counts up for the rail
// filter and accepts a garment-category filter.
export function CollectionTab({ clientId, filterCategories, onCategoryCounts }: {
  clientId: string | null
  filterCategories?: Set<string>
  onCategoryCounts?: (counts: Map<string, number>) => void
}) {
  const { items, itemTagIds, loading, error, refetch } = useClosetItems(clientId)
  const { tags } = useContentTags()
  const [editing, setEditing] = useState<ClosetItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [removingBg, setRemovingBg] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [q, setQ] = useState('')

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

  // Report category counts up to the rail (present categories + counts for the filter chips).
  useEffect(() => {
    if (!onCategoryCounts) return
    const counts = new Map<string, number>()
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
      live = live.filter((i) => filterCategories.has(categoryByItem.get(i.id) ?? ''))
    }
    const term = q.trim().toLowerCase()
    if (!term) return live
    return live.filter((i) =>
      displayName(i).toLowerCase().includes(term) ||
      (i.category ?? '').toLowerCase().includes(term) ||
      (i.brand ?? '').toLowerCase().includes(term))
  }, [items, q, filterCategories, categoryByItem])

  async function save(data: { name_override: string | null; brand: string | null; color: string | null; style_note: string | null; category: string | null }) {
    if (!editing) return
    setSaving(true)
    const { error: e } = await supabase.from('gp_closet_items').update(data).eq('id', editing.id)
    setSaving(false)
    if (e) { console.error('Failed to save item edits:', e); return }
    setEditing(null)
    refetch()
  }

  // Archive the item — soft-delete (is_deleted=true). Removes it from the stylist's Collection
  // view AND the client's lookbook closet (getClosetItems filters is_deleted=false). Reversible.
  async function archive() {
    if (!editing) return
    if (!confirm(`Archive "${displayName(editing) || 'this item'}"?\n\nIt will be removed from the client's collection and lookbook. You can restore it later.`)) return
    setArchiving(true)
    const { error: e } = await supabase.from('gp_closet_items').update({ is_deleted: true }).eq('id', editing.id)
    setArchiving(false)
    if (e) { alert('Could not archive this item — ' + e.message); return }
    setEditing(null)
    refetch()
  }

  // Remove the item's background → transparent (deterministic strip; declines gracefully when it
  // can't). Updates raw.processed_image (reversible). On success, refetch so the new image shows.
  async function removeBg() {
    if (!editing) return
    setRemovingBg(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-remove-bg-item`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token ?? ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: editing.id, image_url: resolveItemImage(editing) }),
      })
      const d = await resp.json().catch(() => ({}))
      if (!resp.ok || !d?.ok) { alert(d?.reason || d?.error || 'Could not remove the background.'); return }
      setEditing(null)
      refetch()
    } catch {
      alert('Failed to remove background — try again.')
    } finally {
      setRemovingBg(false)
    }
  }

  // Replace an item's image with a stylist-uploaded photo (cleaned through Photoroom on the way in).
  // Reversible (raw.bg_backup). Updates the item → shows in builder + lookbook.
  async function replacePhoto(file: File) {
    if (!editing) return
    setReplacing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const fd = new FormData()
      fd.append('item_id', editing.id)
      fd.append('photo', file)
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-replace-closet-image`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token ?? ''}` }, // no Content-Type — browser sets the multipart boundary
        body: fd,
      })
      const d = await resp.json().catch(() => ({}))
      if (!resp.ok || !d?.ok) { alert(d?.error || 'Could not replace the photo.'); return }
      setEditing(null)
      refetch()
    } catch {
      alert('Failed to replace the photo — try again.')
    } finally {
      setReplacing(false)
    }
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
                  <p className="text-[10px] tracking-[0.18em] uppercase text-[#aaa] mt-0.5 truncate">{labelForCategory(categoryByItem.get(item.id) ?? 'other')}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && <EditItemDialog item={editing} saving={saving} customCategories={customCats} onSave={save} onClose={() => setEditing(null)} onRemoveBackground={removeBg} removingBg={removingBg} onReplacePhoto={replacePhoto} replacing={replacing} onArchive={archive} archiving={archiving} />}
    </div>
  )
}
