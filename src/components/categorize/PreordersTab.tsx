import { useEffect, useRef, useState } from 'react'
import { Plus, X, Check, Undo2 } from 'lucide-react'
import { usePreorders, type Preorder } from '@/hooks/usePreorders'
import { CATEGORY_LABELS } from '@/lib/categorize'
import { shownPrice } from '@/lib/preorders'
import { isPictureFile } from '@/lib/addPicture'
import { r2ImageUrl } from '@/lib/imageUrls'
import { TileImage } from '@/components/common/TileImage'
import { PIECE_TILE_WIDTH } from '@/lib/derivedImage'

// PRE-ORDERS (lib/preorders.ts). Cynthia Dada, 2026-11-19. A stylist adds a piece the client has
// on order, with its photos, price and description. It shows on the client's Pre-orders tab and
// nowhere else. Once she has tried it on: Keep moves it into her Collection, Return takes it off.

const CATEGORIES = Object.entries(CATEGORY_LABELS).filter(([slug]) => slug !== 'other')
const field = 'w-full bg-white border border-[#E8E4DF] rounded px-2.5 py-1.5 text-[13px] text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A]'
const label = 'block text-[10px] tracking-[0.2em] uppercase text-[#888] mb-1'

export function PreordersTab({ clientId, clientName }: { clientId: string | null; clientName?: string }) {
  const { items, loading, error, add, keep, giveBack } = usePreorders(clientId)
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [price, setPrice] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const inFlight = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const who = clientName?.split(' ')[0] || 'the client'

  function addFiles(list: FileList | null) {
    const picked = Array.from(list ?? []).filter(isPictureFile)
    if (picked.length) setFiles((cur) => [...cur, ...picked])
  }

  async function onAdd() {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setNote(null)
    try {
      await add({ name, brand, price, description, category, files })
      setName(''); setBrand(''); setPrice(''); setDescription(''); setCategory(''); setFiles([])
      setNote(`Added. It shows on ${who}'s Pre-orders tab, not in her Collection.`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'The pre-order did not save. Try again.')
    } finally {
      setSaving(false)
      inFlight.current = false
    }
  }

  async function onDecide(item: Preorder, how: 'keep' | 'return') {
    if (inFlight.current) return
    if (how === 'return' && !confirm(`Mark "${item.name}" as returned?\n\nIt comes off ${who}'s Pre-orders tab and never goes into her Collection.`)) return
    inFlight.current = true
    setBusy(item.id)
    try { await (how === 'keep' ? keep(item) : giveBack(item)) }
    catch (e) { alert(e instanceof Error ? e.message : 'That did not save. Try again.') }
    finally { setBusy(null); inFlight.current = false }
  }

  if (!clientId) return <p className="text-[#888] text-sm">Pick a client to see her pre-orders.</p>

  return (
    <div className="space-y-10" data-preorders>
      <section data-preorder-form className="max-w-xl bg-white border border-[#E8E4DF] rounded p-5">
        <p className="text-[10px] tracking-[0.3em] uppercase text-[#888] mb-4">Add a pre-order</p>
        <div className="space-y-3">
          <div>
            <span className={label}>Photos</span>
            <div className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`} className="relative w-16 h-20 border border-[#E8E4DF] rounded bg-[#F8F7F5] flex items-center justify-center overflow-hidden">
                  <PickedPhoto file={f} />
                  <button onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} aria-label="Remove photo"
                    className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-white/90 flex items-center justify-center text-[#888] hover:text-[#1A1A1A]"><X className="w-3 h-3" /></button>
                </div>
              ))}
              <button onClick={() => fileInput.current?.click()} data-preorder-add-photo
                className="w-16 h-20 border border-dashed border-[#ccc] rounded flex flex-col items-center justify-center text-[#888] hover:text-[#1A1A1A] hover:border-[#1A1A1A]">
                <Plus className="w-4 h-4" /><span className="text-[9px] mt-1">Photo</span>
              </button>
              <input ref={fileInput} type="file" accept="image/*,.heic,.heif" multiple className="hidden" data-preorder-photos
                onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
            </div>
            <p className="mt-1 text-[10px] text-[#888]">The first photo is the main one. Add as many as you like.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className={label}>Designer</span>
              <input value={brand} onChange={(e) => setBrand(e.target.value)} className={field} name="preorder-brand" /></label>
            <label className="block"><span className={label}>Price</span>
              <input value={price} onChange={(e) => setPrice(e.target.value)} className={field} name="preorder-price" placeholder="1,250" inputMode="decimal" /></label>
          </div>
          <label className="block"><span className={label}>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={field} name="preorder-name" placeholder="Wool wrap coat" /></label>
          <label className="block"><span className={label}>Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} className={`${field} resize-none`} name="preorder-description" /></label>
          <label className="block"><span className={label}>Category, for when she keeps it</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={field} name="preorder-category">
              <option value="">Choose later</option>
              {CATEGORIES.map(([slug, l]) => <option key={slug} value={slug}>{l}</option>)}
            </select></label>
          <div className="flex items-center gap-3 pt-1">
            <button onClick={onAdd} disabled={saving} data-preorder-save
              className="px-4 py-2 text-[11px] tracking-[0.15em] uppercase rounded bg-[#1A1A1A] text-white hover:opacity-80 disabled:opacity-40">
              {saving ? 'Adding…' : 'Add pre-order'}
            </button>
            {note && <p data-preorder-note className="text-[11px] text-[#888] leading-snug">{note}</p>}
          </div>
        </div>
      </section>

      <section>
        <p className="text-[10px] tracking-[0.3em] uppercase text-[#888] mb-4">On pre-order ({items.length})</p>
        {error ? <p className="text-[#b4443a] text-sm">Couldn’t load pre-orders: {error}</p>
          : loading ? <p className="text-[#888] text-sm">Loading…</p>
          : items.length === 0 ? <p className="text-[#888] text-sm">Nothing on pre-order for {who}. Her site shows no Pre-orders tab until you add one.</p>
          : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">
            {items.map((item) => (
              <div key={item.id} data-preorder-card={item.id} className="bg-white border border-[#E8E4DF] rounded overflow-hidden flex flex-col">
                <div className="aspect-[3/4] bg-white flex items-center justify-center">
                  {item.photoKeys[0] && <TileImage src={r2ImageUrl(item.photoKeys[0])} width={PIECE_TILE_WIDTH} alt={item.name} className="max-w-full max-h-full object-contain p-3" loading="lazy" />}
                </div>
                {item.photoKeys.length > 1 && (
                  <div className="flex gap-1 px-3">
                    {item.photoKeys.slice(1).map((k) => (
                      <TileImage key={k} src={r2ImageUrl(k)} width={PIECE_TILE_WIDTH} alt="" className="w-10 h-12 object-contain border border-[#E8E4DF] rounded" loading="lazy" />
                    ))}
                  </div>
                )}
                <div className="p-3 flex-1 flex flex-col">
                  {item.brand && <p className="text-[10px] tracking-[0.2em] uppercase text-[#888]">{item.brand}</p>}
                  <p className="text-[13px] text-[#1A1A1A] leading-snug">{item.name}</p>
                  {shownPrice(item.price) && <p data-preorder-price className="text-[12px] text-[#1A1A1A] mt-1">{shownPrice(item.price)}</p>}
                  {item.description && <p className="text-[11px] text-[#888] mt-1 leading-snug">{item.description}</p>}
                  <div className="mt-auto pt-3 flex gap-2">
                    <button onClick={() => onDecide(item, 'keep')} disabled={busy === item.id} data-preorder-keep
                      title={`She is keeping it: it moves into ${who}'s Collection`}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] tracking-[0.1em] uppercase rounded bg-[#1A1A1A] text-white hover:opacity-80 disabled:opacity-40">
                      <Check className="w-3 h-3" /> Keep
                    </button>
                    <button onClick={() => onDecide(item, 'return')} disabled={busy === item.id} data-preorder-return
                      title={`She sent it back: it comes off ${who}'s Pre-orders`}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] tracking-[0.1em] uppercase rounded border border-[#E8E4DF] text-[#888] hover:text-[#1A1A1A] disabled:opacity-40">
                      <Undo2 className="w-3 h-3" /> Return
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/** A photo she picked, shown before it uploads. */
function PickedPhoto({ file }: { file: File }) {
  const [url] = useState(() => URL.createObjectURL(file))
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  // full-size: a local preview of a file not yet uploaded; there is no small copy to ask for.
  return <img src={url} alt="" className="max-w-full max-h-full object-contain" />
}
