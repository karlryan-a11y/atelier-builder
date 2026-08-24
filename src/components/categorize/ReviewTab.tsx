import { useMemo, useState } from 'react'
import { RotateCcw, Pencil } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useHiddenItems } from '@/hooks/useHiddenItems'
import { useClosetItems } from '@/hooks/useClosetItems'
import { resolveItemImage, proxyImageUrl, displayName, type ClosetItem } from '@/lib/images'
import { labelForCategory, customCategoriesFromItems, primaryCategoryOf } from '@/lib/garmentCategory'
import { EditItemDialog } from '@/components/layout/EditItemDialog'
import { ColorAuditPanel } from './ColorAuditPanel'

// The "Review" tab — one home for a client's data cleanup: HIDDEN pieces (recover ones hidden by
// mistake), MISSING INFO (fill blanks so search works), and COLORS (the existing color audit, folded
// in here). Builder-only; the lookbook is untouched until a stylist deliberately Restores/edits.

const REASON_LABEL: Record<string, string> = { archive: 'Archived', duplicate: 'Removed as duplicate', other: 'Hidden' }

type Pill = 'hidden' | 'missing' | 'colors'

export function ReviewTab({ clientId, clientName }: { clientId: string | null; clientName?: string }) {
  const [pill, setPill] = useState<Pill>('hidden')
  const hidden = useHiddenItems(clientId)
  const { items: visible, tagNameById, refetch } = useClosetItems(clientId)
  const customCats = useMemo(() => customCategoriesFromItems(visible), [visible])

  const [restoring, setRestoring] = useState<string | null>(null)
  const [editing, setEditing] = useState<ClosetItem | null>(null)
  const [saving, setSaving] = useState(false)

  const noBrand = useMemo(
    () => visible.filter((i) => { const b = (i.brand ?? '').trim(); return !b || b === 'None' }),
    [visible],
  )
  // "Missing category" means the piece will not RESOLVE to a garment category — not merely that
  // nobody typed an override into gp_closet_items.category. An empty column is the normal state:
  // most clients have zero overrides (Emily Reaser 1,058 of 1,058), because the category is worked
  // out from the GoodPix content tags and the item name at render. Flagging the column made this
  // list say "every piece needs attention" for most of the roster, which is why it went unread.
  // Now it flags only the pieces that genuinely fall through to "Other" and so are unfindable by
  // category on the client's lookbook.
  const noCategory = useMemo(
    () => visible.filter((i) => {
      const tagNames = (i.content_tag_ids ?? []).map((id) => tagNameById.get(id) ?? '').filter(Boolean)
      return primaryCategoryOf(i, tagNames) === 'other'
    }),
    [visible, tagNameById],
  )
  const missing = useMemo(() => {
    const seen = new Set<string>(); const out: ClosetItem[] = []
    for (const i of [...noBrand, ...noCategory]) { if (!seen.has(i.id)) { seen.add(i.id); out.push(i) } }
    return out
  }, [noBrand, noCategory])

  async function onRestore(id: string) {
    setRestoring(id)
    try { await hidden.restore(id) }
    catch (e) { alert('Could not restore: ' + (e instanceof Error ? e.message : 'unknown error')) }
    finally { setRestoring(null) }
  }

  async function save(data: { name_override: string | null; brand: string | null; color: string | null; style_note: string | null; category: string | null; custom_categories?: string[] | null; color_family?: string | null; color_families?: string[] | null }) {
    if (!editing) return
    setSaving(true)
    const { error } = await supabase.from('gp_closet_items').update(data).eq('id', editing.id)
    setSaving(false)
    if (error) { alert('Could not save — ' + error.message); return }
    setEditing(null)
    refetch()
  }

  const Pills = (
    <div className="flex items-center gap-1 mb-6">
      {([['hidden', 'Hidden', hidden.items.length], ['missing', 'Missing info', missing.length], ['colors', 'Colors', null]] as const).map(([key, label, count]) => (
        <button key={key} onClick={() => setPill(key)}
          className={`px-3.5 py-1.5 text-[11px] tracking-[0.15em] uppercase rounded transition-colors ${pill === key ? 'bg-[#1A1A1A] text-white' : 'text-[#888] hover:text-[#1A1A1A]'}`}>
          {label}{count != null && count > 0 ? <span className="ml-2 text-[10px] opacity-70">{count}</span> : null}
        </button>
      ))}
    </div>
  )

  return (
    <div>
      {/* Health snapshot */}
      <p className="text-[11px] tracking-[0.12em] text-[#888] mb-4">
        {clientName ? `${clientName.split(' ')[0]} · ` : ''}{visible.length} shown · {hidden.items.length} hidden · {noBrand.length} no designer · {noCategory.length} no category
      </p>
      {Pills}

      {pill === 'hidden' && (
        hidden.error ? <p className="text-[#b4443a] text-sm">Couldn’t load hidden items: {hidden.error}</p>
        : hidden.loading ? <p className="text-[#888] text-sm">Loading…</p>
        : hidden.items.length === 0 ? <p className="text-[#888] text-sm">Nothing hidden. Archived or removed pieces would show here to review and restore.</p>
        : (
          <>
            <p className="text-[12px] text-[#888] mb-4 max-w-xl">Pieces that were archived or removed and are hidden from her collection + lookbook. Restore the ones hidden by mistake — a restored piece returns to her lookbook.</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {hidden.items.map((item) => (
                <div key={item.id} className="group relative border border-[#E8E4DF] rounded-sm overflow-hidden bg-white">
                  <div className="aspect-square bg-[#F8F7F5] flex items-center justify-center">
                    {item.image ? <img src={item.image} alt={item.name} className="max-w-full max-h-full object-contain p-2.5 opacity-80" loading="lazy" />
                      : <span className="text-[10px] tracking-[0.2em] uppercase text-[#bbb]">No image</span>}
                  </div>
                  <div className="px-3 py-2.5">
                    {item.brand && <p className="text-[10px] tracking-[0.18em] uppercase text-[#1A1A1A] truncate">{item.brand}</p>}
                    <p className="text-[13px] text-[#1A1A1A] truncate mt-0.5">{item.name}</p>
                    <p className="text-[10px] tracking-[0.14em] uppercase text-[#aaa] mt-1 truncate">
                      {labelForCategory(item.category ?? 'other')}
                      {item.deletedReason ? ` · ${REASON_LABEL[item.deletedReason] ?? 'Hidden'}` : ''}
                    </p>
                    {item.deletedBy && <p className="text-[10px] text-[#c4c0ba] mt-0.5 truncate">by {item.deletedBy}{item.deletedAt ? ` · ${new Date(item.deletedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}</p>}
                    <button onClick={() => onRestore(item.id)} disabled={restoring === item.id}
                      className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] tracking-[0.12em] uppercase text-[#8a7a6a] hover:text-[#1A1A1A] transition-colors disabled:opacity-50" title="Restore this piece to her collection + lookbook">
                      <RotateCcw className="h-3 w-3" /> {restoring === item.id ? 'Restoring…' : 'Restore'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )
      )}

      {pill === 'missing' && (
        missing.length === 0 ? <p className="text-[#888] text-sm">Every visible piece has a designer and a category. Search is complete.</p>
        : (
          <>
            <p className="text-[12px] text-[#888] mb-4 max-w-xl">Pieces with no designer or no category. Search can only find what’s labelled, so filling these in makes her brand + category search reliable. Click the pencil to edit.</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {missing.map((item) => {
                const img = resolveItemImage(item)
                const b = (item.brand ?? '').trim(); const noB = !b || b === 'None'
                const noC = !(item.category ?? '').trim()
                return (
                  <div key={item.id} className="group relative border border-[#E8E4DF] rounded-sm overflow-hidden bg-white">
                    <button onClick={() => setEditing(item)} title="Edit"
                      className="absolute top-1.5 right-1.5 z-10 p-1.5 rounded-sm bg-white/90 text-[#888] opacity-0 group-hover:opacity-100 hover:text-[#1A1A1A] transition-opacity shadow-sm">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <div className="aspect-square bg-[#F8F7F5] flex items-center justify-center">
                      {img ? <img src={img} alt={displayName(item)} className="max-w-full max-h-full object-contain p-2.5" loading="lazy" />
                        : <span className="text-[10px] tracking-[0.2em] uppercase text-[#bbb]">No image</span>}
                    </div>
                    <div className="px-3 py-2.5">
                      <p className="text-[13px] text-[#1A1A1A] truncate">{displayName(item) || 'Untitled item'}</p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {noB && <span className="text-[9px] tracking-[0.12em] uppercase text-[#a33] border border-[#e3c9c9] rounded-sm px-1.5 py-0.5">No designer</span>}
                        {noC && <span className="text-[9px] tracking-[0.12em] uppercase text-[#a33] border border-[#e3c9c9] rounded-sm px-1.5 py-0.5">No category</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )
      )}

      {pill === 'colors' && <ColorAuditPanel clientId={clientId} />}

      {editing && (
        <EditItemDialog
          item={editing} saving={saving} customCategories={customCats}
          imageUrl={(() => { const s = resolveItemImage(editing); return s ? proxyImageUrl(s) : null })()}
          onSave={save} onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
