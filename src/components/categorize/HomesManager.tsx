import { useMemo, useState } from 'react'
import { Check, Home, Pencil, Plus, Tag } from 'lucide-react'
import type { LookCategory, TaggableLook } from '@/hooks/useLookCategories'
import type { useLookCategories } from '@/hooks/useLookCategories'
import { useClosetItems } from '@/hooks/useClosetItems'
import { useItemHomes } from '@/hooks/useItemHomes'
import { homeCollection } from '@/lib/homeCollection'
import { MIN_RESIDENCES } from '@/lib/residences'
import { resolveItemImage, displayName, type ClosetItem } from '@/lib/images'
import { TileImage } from '@/components/common/TileImage'
import { LOOK_TILE_WIDTH, PIECE_TILE_WIDTH } from '@/lib/derivedImage'

/**
 * HER HOMES, ON RESIDENCES (Paige Berndt, 2026-11-13): "move the functionality for adding,
 * deleting, and editing residences from the Capsules page to the Residences page", and "view each
 * client's collections within their respective residences, along with the looks created from those
 * collections".
 *
 * Add, rename and remove a home here. Remove only stops a category being a home (the same write,
 * and the same question first, as the old Home switch on the category rail). It never deletes the
 * category, a look or a piece. Tapping a home shows the pieces her Collection puts there and the
 * looks made from them (lib/homeCollection.ts). Nothing here changes which home anything is in.
 */
type Hook = ReturnType<typeof useLookCategories>

interface Props {
  clientId: string
  clientName?: string
  categories: LookCategory[]
  looks: TaggableLook[]
  addHome: Hook['addHome']
  renameCategory: Hook['renameCategory']
  setCategoryResidence: Hook['setCategoryResidence']
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function HomesManager({ clientId, clientName, categories, looks, addHome, renameCategory, setCategoryResidence }: Props) {
  const homeRows = useMemo(
    () => categories.filter((c) => c.is_residence === true && !c.is_hidden).sort((a, b) => a.sort_order - b.sort_order),
    [categories],
  )
  const { items } = useClosetItems(clientId)
  const { homesByItem } = useItemHomes(clientId, items)
  const collections = useMemo(
    () => new Map(homeRows.map((h) => [h.id, homeCollection(h, items, looks, homesByItem)])),
    [homeRows, items, looks, homesByItem],
  )

  const [openId, setOpenId] = useState<string | null>(null)
  const [view, setView] = useState<'pieces' | 'looks'>('pieces')
  const [editing, setEditing] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')
  const [newHome, setNewHome] = useState('')
  const [note, setNote] = useState<string | null>(null)

  const open = homeRows.find((h) => h.id === openId) ?? null
  const openCollection = open ? collections.get(open.id) : undefined

  async function handleAdd() {
    const name = newHome.trim()
    if (!name) return
    const res = await addHome(name, (message) => window.confirm(message), clientName)
    if (!res) return
    if (!res.ok) { setNote(res.message); return }
    setNote(null)
    setNewHome('')
    setOpenId(res.category.id)
  }
  function commitRename() {
    if (editing && editVal.trim()) void renameCategory(editing, editVal)
    setEditing(null); setEditVal('')
  }
  async function handleRemove(cat: LookCategory) {
    const plan = await setCategoryResidence(cat.id, false, (message) => window.confirm(message), clientName)
    if (plan && openId === cat.id) setOpenId(null)
  }

  return (
    <section data-homes className="mb-8">
      <p className="text-[9px] tracking-[0.3em] uppercase text-[#888] mb-1">Her homes</p>
      <p className="text-[11px] text-[#888] leading-relaxed max-w-[720px] mb-3">
        Add, rename or remove her homes here. Tap a home to see the pieces in it and the looks made from them.
        Removing a home never deletes a piece, a look or the category.
      </p>

      <div className="flex flex-wrap items-stretch gap-3">
        {homeRows.map((h) => {
          const c = collections.get(h.id)
          const lookCount = (c?.filed.length ?? 0) + (c?.madeWith.length ?? 0)
          const isOpen = openId === h.id
          if (editing === h.id) {
            return (
              <div key={h.id} className="flex items-center gap-1.5 px-3 py-2 rounded border border-[#1A1A1A] bg-white min-w-[220px]">
                <input
                  value={editVal}
                  onChange={(e) => setEditVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setEditing(null); setEditVal('') } }}
                  autoFocus
                  aria-label={`New name for ${h.label}`}
                  className="flex-1 min-w-0 bg-white border border-[#E8E4DF] rounded px-2 py-1 text-[12px] focus:outline-none focus:border-[#1A1A1A]"
                />
                <button onClick={commitRename} className="flex-none w-7 h-7 flex items-center justify-center rounded bg-[#1A1A1A] text-white hover:opacity-80" aria-label="Save name">
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          }
          return (
            <div
              key={h.id}
              data-home-card={h.label}
              className={`flex items-center rounded border transition-colors ${isOpen ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'bg-white border-[#E8E4DF] text-[#1A1A1A] hover:border-[#1A1A1A]'}`}
            >
              <button
                onClick={() => { setOpenId(isOpen ? null : h.id); setView('pieces') }}
                aria-pressed={isOpen}
                className="flex items-center gap-2.5 pl-3.5 pr-2 py-2.5 text-left"
              >
                <Home className={`w-4 h-4 flex-none ${isOpen ? 'fill-white/20' : ''}`} />
                <span>
                  <span className="block text-[13px]">{h.label}</span>
                  <span data-home-counts className={`block text-[10px] ${isOpen ? 'text-white/70' : 'text-[#888]'}`}>
                    {plural(c?.pieces.length ?? 0, 'piece', 'pieces')} · {plural(lookCount, 'look', 'looks')}
                  </span>
                </span>
              </button>
              <button
                onClick={() => { setEditing(h.id); setEditVal(h.label) }}
                className={`flex-none p-1.5 rounded ${isOpen ? 'hover:bg-white/20' : 'hover:bg-[#F8F7F5]'}`}
                aria-label={`Rename ${h.label}`}
                title="Rename this home (her lookbook shows the new name)"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { void handleRemove(h) }}
                className={`flex-none mr-1.5 px-2 py-1 rounded text-[9px] tracking-[0.12em] uppercase ${isOpen ? 'text-white/80 hover:bg-white/20' : 'text-[#888] hover:text-[#1A1A1A] hover:bg-[#F8F7F5]'}`}
                aria-label={`Stop ${h.label} being one of her homes`}
                title="Stop this being a home. Its pieces, looks and category stay."
              >
                Remove
              </button>
            </div>
          )
        })}

        <div className="flex items-center gap-1.5 px-2 py-2 rounded border border-dashed border-[#E8E4DF] bg-white">
          <input
            value={newHome}
            onChange={(e) => { setNewHome(e.target.value); setNote(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
            placeholder="Add a home"
            aria-label="Name of the new home"
            className="w-[150px] bg-[#F8F7F5] border border-[#E8E4DF] rounded px-2.5 py-1.5 text-[12px] text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A]"
          />
          <button onClick={() => { void handleAdd() }} className="flex-none w-8 h-8 flex items-center justify-center rounded bg-[#1A1A1A] text-white hover:opacity-80" aria-label="Add this home">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
      {note && <p className="mt-2 text-[11px] text-[#a33]">{note}</p>}
      {homeRows.length < MIN_RESIDENCES && (
        <p className="mt-2 text-[11px] text-[#888] leading-relaxed max-w-[720px]">
          {homeRows.length === 0
            ? 'She has no homes yet. Add two and her lookbook opens on a tile for each.'
            : 'Add one more home and her lookbook opens on a tile for each. Pieces show under a home once she has two.'}
        </p>
      )}

      {open && openCollection && (
        <div data-home-open={open.label} className="mt-6">
          <div className="flex items-center gap-1 mb-4">
            {(['pieces', 'looks'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`px-3 py-1.5 text-[11px] tracking-[0.08em] uppercase rounded transition-colors ${
                  view === v ? 'bg-[#1A1A1A] text-white' : 'bg-white border border-[#E8E4DF] text-[#888] hover:text-[#1A1A1A]'
                }`}
              >
                {v === 'pieces'
                  ? `${open.label} pieces (${openCollection.pieces.length})`
                  : `Looks (${openCollection.filed.length + openCollection.madeWith.length})`}
              </button>
            ))}
          </div>

          {view === 'pieces' ? (
            openCollection.pieces.length === 0
              ? <p className="text-[#888] text-sm">No pieces at {open.label} yet. File a look here, or add {open.label} to a piece on the Collection tab.</p>
              : <PieceGrid pieces={openCollection.pieces} />
          ) : (
            <>
              <p className="text-[9px] tracking-[0.3em] uppercase text-[#888] mb-2">Filed in {open.label} ({openCollection.filed.length})</p>
              {openCollection.filed.length === 0
                ? <p className="text-[#888] text-[12px] mb-6">No looks are filed in {open.label} yet. Her lookbook shows a home's looks once they are filed in it.</p>
                : <LookGrid looks={openCollection.filed} />}
              <p className="text-[9px] tracking-[0.3em] uppercase text-[#888] mb-2 mt-6">Made with her {open.label} pieces ({openCollection.madeWith.length})</p>
              {openCollection.madeWith.length === 0
                ? <p className="text-[#888] text-[12px]">No other looks use these pieces.</p>
                : <LookGrid looks={openCollection.madeWith} />}
            </>
          )}
        </div>
      )}
    </section>
  )
}

function PieceGrid({ pieces }: { pieces: ClosetItem[] }) {
  return (
    <div data-home-pieces className="grid grid-cols-3 md:grid-cols-5 xl:grid-cols-7 gap-3">
      {pieces.map((p) => {
        const img = resolveItemImage(p)
        return (
          <div key={p.id} data-piece-id={p.id} className="bg-white rounded-sm border border-[#E8E4DF] flex flex-col">
            <div className="aspect-square flex items-center justify-center overflow-hidden">
              {img
                ? <TileImage src={img} width={PIECE_TILE_WIDTH} alt={displayName(p)} className="max-w-full max-h-full object-contain p-2" loading="lazy" />
                : <Tag className="w-5 h-5 text-[#E8E4DF]" />}
            </div>
            <div className="px-2 pb-2">
              <p className="text-[10px] text-[#1A1A1A] truncate">{displayName(p)}</p>
              {p.brand && <p className="text-[9px] text-[#888] truncate">{p.brand}</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function LookGrid({ looks }: { looks: TaggableLook[] }) {
  return (
    <div data-home-looks className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
      {looks.map((l) => (
        <div key={l.id} data-look-id={l.id} className="bg-white rounded-sm border border-[#E8E4DF] flex flex-col">
          <div className="aspect-square flex items-center justify-center p-2 overflow-hidden border-b border-[#F0EDE9]">
            {l.image
              ? <TileImage src={l.image} width={LOOK_TILE_WIDTH} alt={l.name} className="max-w-full max-h-full object-contain" loading="lazy" />
              : <Tag className="w-6 h-6 text-[#E8E4DF]" />}
          </div>
          <div className="px-3 py-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-[#1A1A1A] truncate">{l.name}</p>
            {!l.published && <span className="flex-none text-[8px] tracking-[0.12em] uppercase px-1.5 py-0.5 rounded bg-[#F8E5E7] text-[#1A1A1A]">Draft</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
