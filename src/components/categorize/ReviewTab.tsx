import { useMemo, useState } from 'react'
import { RotateCcw, Pencil } from 'lucide-react'
import { useHiddenItems } from '@/hooks/useHiddenItems'
import { useClosetItems } from '@/hooks/useClosetItems'
import { resolveItemImage, proxyImageUrl, displayName, type ClosetItem } from '@/lib/images'
import { labelForCategory, customCategoriesFromItems, primaryCategoryOf } from '@/lib/garmentCategory'
import { EditItemDialog } from '@/components/layout/EditItemDialog'
import { ColorAuditPanel } from './ColorAuditPanel'
import { TileImage } from '@/components/common/TileImage'
import { PIECE_TILE_WIDTH } from '@/lib/derivedImage'
import { updateClosetItem } from '@/lib/teamNotes'
import { useDeletedLooks, type DeletedLookCard } from '@/hooks/useDeletedLooks'
import { useAuthStore } from '@/stores/authStore'
import { LOOK_TILE_WIDTH } from '@/lib/derivedImage'

// The "Review" tab — one home for a client's data cleanup: HIDDEN pieces (recover ones hidden by
// mistake), MISSING INFO (fill blanks so search works), and COLORS (the existing color audit, folded
// in here). Builder-only; the lookbook is untouched until a stylist deliberately Restores/edits.
// DELETED LOOKS (Maegan, 2026-09-24): looks the client deleted from her lookbook, with her note on
// why (lib/deletedLooks.ts). Restore puts one back on her site; Clear takes it off this list.

const REASON_LABEL: Record<string, string> = { archive: 'Archived', duplicate: 'Removed as duplicate', other: 'Hidden' }

type Pill = 'deleted' | 'hidden' | 'missing' | 'colors'

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/** Read once in CategorizePanel, so the Review tab can carry the count of looks waiting. */
export function useReviewDeletedLooks(clientId: string | null) {
  const stylistName = useAuthStore((s) => s.user?.displayName ?? null)
  return useDeletedLooks(clientId, stylistName)
}

export function ReviewTab({ clientId, clientName, deleted }: {
  clientId: string | null; clientName?: string; deleted: ReturnType<typeof useDeletedLooks>
}) {
  // Opens on Deleted looks while she has any waiting: that is the work.
  const [pill, setPill] = useState<Pill>(deleted.waiting.length > 0 ? 'deleted' : 'hidden')
  const hidden = useHiddenItems(clientId)
  const [deletedBusy, setDeletedBusy] = useState<string | null>(null)
  const firstName = clientName ? clientName.split(' ')[0] : 'She'

  async function onDeletedAction(look: DeletedLookCard, action: 'restore' | 'clear') {
    if (action === 'clear' && !confirm(`Clear "${look.name}" from review? It stays off ${firstName}'s lookbook. Her note is kept.`)) return
    setDeletedBusy(look.lookId)
    try { await (action === 'restore' ? deleted.restore(look.lookId) : deleted.clear(look.lookId)) }
    catch (e) { alert(`Could not ${action}: ` + (e instanceof Error ? e.message : 'unknown error')) }
    finally { setDeletedBusy(null) }
  }
  const { items: visible, tagNameById, refetch, patchItems } = useClosetItems(clientId)
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
    const { error } = await updateClosetItem(editing.id, editing.client_id, data)
    setSaving(false)
    if (error) { alert('Could not save — ' + error.message); return }
    patchItems([editing.id], data as Partial<ClosetItem>)
    setEditing(null)
    refetch()
  }

  const Pills = (
    <div className="flex items-center gap-1 mb-6">
      {([['deleted', 'Deleted looks', deleted.waiting.length], ['hidden', 'Hidden', hidden.items.length], ['missing', 'Missing info', missing.length], ['colors', 'Colors', null]] as const).map(([key, label, count]) => (
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

      {pill === 'deleted' && (
        deleted.error ? <p className="text-[#b4443a] text-sm">Couldn’t load deleted looks: {deleted.error}</p>
        : deleted.loading ? <p className="text-[#888] text-sm">Loading…</p>
        : deleted.waiting.length === 0 && deleted.cleared.length === 0 ? <p className="text-[#888] text-sm">{firstName} hasn’t deleted any looks. When she deletes one from her lookbook, it lands here with her note.</p>
        : (
          <>
            <p className="text-[12px] text-[#888] mb-4 max-w-xl">Looks {firstName} deleted from her lookbook, with her note on why. The look itself is unchanged here in the builder. Restore puts it back on her lookbook where it was. Clear takes it off this list and it stays off her lookbook.</p>
            {deleted.waiting.length === 0 && <p className="text-[#888] text-sm mb-6">Nothing waiting for review.</p>}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5" data-deleted-looks>
              {deleted.waiting.map((look) => (
                <DeletedLookTile key={look.lookId} look={look} clientName={clientName} busy={deletedBusy === look.lookId}
                  onRestore={() => onDeletedAction(look, 'restore')} onClear={() => onDeletedAction(look, 'clear')} />
              ))}
            </div>
            {deleted.cleared.length > 0 && (
              <details className="mt-10">
                <summary className="cursor-pointer text-[11px] tracking-[0.15em] uppercase text-[#888] hover:text-[#1A1A1A]">Cleared, still off her lookbook ({deleted.cleared.length})</summary>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 mt-4">
                  {deleted.cleared.map((look) => (
                    <DeletedLookTile key={look.lookId} look={look} clientName={clientName} busy={deletedBusy === look.lookId}
                      onRestore={() => onDeletedAction(look, 'restore')} />
                  ))}
                </div>
              </details>
            )}
          </>
        )
      )}

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
                    {item.image ? <TileImage src={item.image} width={PIECE_TILE_WIDTH} alt={item.name} className="max-w-full max-h-full object-contain p-2.5 opacity-80" loading="lazy" />
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
                      {img ? <TileImage src={img} width={PIECE_TILE_WIDTH} alt={displayName(item)} className="max-w-full max-h-full object-contain p-2.5" loading="lazy" />
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
          item={editing} saving={saving} customCategories={customCats} enableMultiCategory
          imageUrl={(() => { const s = resolveItemImage(editing); return s ? proxyImageUrl(s) : null })()}
          onSave={save} onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

/** One look she deleted: the look, who, when, her note, and what the stylist can do with it. */
function DeletedLookTile({ look, clientName, busy, onRestore, onClear }: {
  look: DeletedLookCard; clientName?: string; busy: boolean; onRestore: () => void; onClear?: () => void
}) {
  return (
    <div className="border border-[#E8E4DF] rounded-sm overflow-hidden bg-white" data-deleted-look={look.lookId}>
      <div className="aspect-square bg-[#F8F7F5] flex items-center justify-center">
        {look.image ? <TileImage src={look.image} width={LOOK_TILE_WIDTH} alt={look.name} className="max-w-full max-h-full object-contain" loading="lazy" />
          : <span className="text-[10px] tracking-[0.2em] uppercase text-[#bbb]">No image</span>}
      </div>
      <div className="px-3 py-2.5">
        <p className="text-[13px] text-[#1A1A1A] truncate">{look.name}</p>
        <p className="text-[10px] tracking-[0.14em] uppercase text-[#aaa] mt-1 truncate">
          Deleted by {look.by && clientName && !clientName.startsWith(look.by) ? look.by : (clientName ?? 'her')}
        </p>
        <p className="text-[10px] tracking-[0.14em] uppercase text-[#aaa] mt-0.5">{shortDate(look.at)}</p>
        <p className={`text-[12px] mt-2 leading-snug whitespace-pre-line ${look.note ? 'text-[#1A1A1A]' : 'text-[#bbb] italic'}`}>
          {look.note ? `“${look.note}”` : 'No note'}
        </p>
        <div className="mt-2.5 flex items-center gap-4">
          <button onClick={onRestore} disabled={busy}
            className="inline-flex items-center gap-1.5 text-[11px] tracking-[0.12em] uppercase text-[#8a7a6a] hover:text-[#1A1A1A] transition-colors disabled:opacity-50" title="Put this look back on her lookbook">
            <RotateCcw className="h-3 w-3" /> {busy ? 'Saving…' : 'Restore'}
          </button>
          {onClear && (
            <button onClick={onClear} disabled={busy}
              className="text-[11px] tracking-[0.12em] uppercase text-[#888] hover:text-[#1A1A1A] transition-colors disabled:opacity-50" title="Take it off this list. It stays off her lookbook.">
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
