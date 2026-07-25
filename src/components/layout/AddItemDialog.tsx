import { useRef, useState } from 'react'
import { X, Upload, Loader2, AlertTriangle, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { CATEGORY_LABELS } from '@/lib/categorize'
import { slugifyCategory, labelForCategory } from '@/lib/garmentCategory'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const FIXED = (Object.entries(CATEGORY_LABELS) as [string, string][]).filter(([s]) => s !== 'other')

// Absolute builder URL — the app is served under atelierbywatson.com/style (apex = the dashboard),
// so a RELATIVE /api/... would hit the dashboard, not this builder's serverless function. Same
// pattern as api/heic-convert. CORS is handled by the endpoint.
const ADD_ITEM_API = 'https://atelier-builder.vercel.app/api/add-closet-item'
const api = (body: any) =>
  fetch(ADD_ITEM_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(r => r.json().catch(() => ({})))

// Downscale a picked photo to a small JPEG data URI for the AI prefill call (keeps the request small;
// the FULL-resolution file is what actually gets uploaded + Photoroom-cleaned).
function toPrefillDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const max = 768
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const ctx = c.getContext('2d'); if (!ctx) return reject(new Error('canvas'))
      ctx.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')) }
    img.src = url
  })
}

interface Props {
  clientId: string
  clientName?: string
  customCategories?: { slug: string; label: string }[]
  onClose: () => void
  onAdded: () => void
}

export function AddItemDialog({ clientId, clientName, customCategories = [], onClose, onAdded }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [processing, setProcessing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [processedUrl, setProcessedUrl] = useState<string | null>(null) // the REAL Photoroom-cleaned image
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [color, setColor] = useState('')
  const [category, setCategory] = useState('')
  const [styleNote, setStyleNote] = useState('')
  const [customMode, setCustomMode] = useState(false)
  const [customName, setCustomName] = useState('')

  const currentInList = FIXED.some(([s]) => s === category) || customCategories.some(c => c.slug === category)
  const ready = !!draftId && !!processedUrl && !processing

  async function discardDraft(id: string | null) {
    if (id) { try { await api({ action: 'discard', item_id: id }) } catch { /* best-effort */ } }
  }

  // Pick a photo → AI PROCESSES it (Photoroom-clean the image into a hidden draft + AI metadata) → we
  // show the ACTUAL result. Nothing is live yet; the stylist reviews, then approves.
  async function onPick(f: File | null) {
    if (!f) return
    await discardDraft(draftId)
    setDraftId(null); setProcessedUrl(null); setProcessing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token ?? ''
      // hidden draft row to hang the image on
      const draft = await api({ action: 'create-draft', client_id: clientId })
      if (!draft?.item_id) { alert(draft?.error || 'Could not start the upload.'); setProcessing(false); return }
      setDraftId(draft.item_id)
      // process the image (Photoroom + R2, exactly like the digitizer) + read metadata, in parallel
      const [imgUrl, fields] = await Promise.all([
        (async () => {
          const fd = new FormData(); fd.append('item_id', draft.item_id); fd.append('photo', f)
          const ir = await fetch(`${SUPABASE_URL}/functions/v1/intake-replace-closet-image`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
          const ij = await ir.json().catch(() => ({}))
          return ij?.url as string | undefined
        })(),
        toPrefillDataUri(f).then(uri => api({ action: 'prefill', image: uri }).then(d => d?.fields || {})).catch(() => ({})),
      ])
      if (imgUrl) setProcessedUrl(imgUrl)
      if (fields.name && !name) setName(fields.name)
      if (fields.brand && !brand) setBrand(fields.brand)
      if (fields.color && !color) setColor(fields.color)
      if (fields.category && !category) setCategory(fields.category)
    } catch {
      alert('Could not process that photo — try again.')
    } finally { setProcessing(false) }
  }

  async function addToCollection() {
    if (!draftId) { alert('Pick a photo first.'); return }
    if (!name.trim()) { alert('Give the item a name.'); return }
    setSaving(true)
    try {
      const d = await api({ action: 'publish', item_id: draftId, name: name.trim(), brand, color, category, style_note: styleNote })
      if (!d?.ok) { alert(d?.error || 'Could not add the item.'); return }
      const published = draftId
      setDraftId(null) // so close() won't discard it
      void published
      onAdded()
      onClose()
    } catch {
      alert('Failed to add the item — try again.')
    } finally { setSaving(false) }
  }

  function close() { void discardDraft(draftId); onClose() }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onClick={close}>
      <div className="bg-white rounded-sm shadow-xl w-[480px] max-h-[88vh] flex flex-col border border-border" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-medium tracking-[0.1em] uppercase text-text">Add Item{clientName ? ` · ${clientName}` : ''}</h2>
          <button onClick={close} className="p-1 hover:bg-tile rounded-sm transition-colors"><X className="h-4 w-4 text-text-muted" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Go-live reminder */}
          <div className="flex items-start gap-2 rounded-sm border border-[#e6c98a] bg-[#fdf6e6] px-3 py-2.5">
            <AlertTriangle className="h-4 w-4 text-[#b07a1a] flex-none mt-0.5" />
            <p className="text-[11px] leading-snug text-[#7a5a12]">
              This is <b>exactly how it will appear</b> on {clientName ? `${clientName}'s` : "the client's"} lookbook. Review the
              processed photo and the details, then click <b>Add&nbsp;to&nbsp;Collection</b> to make it live.
            </p>
          </div>

          {/* Photo → shows the ACTUAL processed (Photoroom-cleaned) result once ready */}
          <div>
            <label className="text-[10px] tracking-[0.3em] uppercase text-text-muted/60 block mb-1.5">
              {processedUrl ? 'Processed photo (what goes live)' : 'Photo'}
            </label>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => onPick(e.target.files?.[0] ?? null)} />
            <button onClick={() => !processing && fileRef.current?.click()} disabled={processing}
              className="w-full aspect-[4/5] max-h-[300px] rounded-sm border border-dashed border-border bg-tile flex items-center justify-center overflow-hidden hover:border-blush transition-colors disabled:cursor-wait"
              style={processedUrl ? { backgroundImage: 'repeating-conic-gradient(#f2f0ee 0% 25%, #fff 0% 50%)', backgroundSize: '16px 16px' } : undefined}>
              {processing
                ? <span className="flex flex-col items-center gap-2 text-text-muted text-[11px] tracking-[0.15em] uppercase"><Loader2 className="h-5 w-5 animate-spin" />Processing photo…</span>
                : processedUrl
                  ? <img src={processedUrl} alt="" className="w-full h-full object-contain" />
                  : <span className="flex flex-col items-center gap-1 text-text-muted/60 text-[11px] tracking-[0.15em] uppercase"><Upload className="h-5 w-5" />Choose photo</span>}
            </button>
            {ready && <button onClick={() => fileRef.current?.click()} className="mt-1.5 text-[10px] tracking-[0.15em] uppercase text-text-muted hover:text-text underline">Use a different photo</button>}
            {processing && <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-text-muted"><Sparkles className="h-3 w-3" /> Removing background + reading the item…</p>}
          </div>

          <Field label="Name" value={name} onChange={setName} placeholder="e.g. Navy Wide-Leg Linen Trousers" />
          <Field label="Brand" value={brand} onChange={setBrand} placeholder="e.g. The Row" />

          <div>
            <label className="text-[10px] tracking-[0.3em] uppercase text-text-muted/60 block mb-1.5">Category</label>
            {customMode ? (
              <div className="flex items-center gap-1.5">
                <input autoFocus value={customName} onChange={e => setCustomName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && customName.trim()) { setCategory(slugifyCategory(customName)); setCustomMode(false); setCustomName('') } if (e.key === 'Escape') { setCustomMode(false); setCustomName('') } }}
                  placeholder="e.g. Rompers" className="flex-1 bg-tile rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blush" />
                <button onClick={() => { if (customName.trim()) { setCategory(slugifyCategory(customName)); setCustomMode(false); setCustomName('') } }} className="px-2 py-2 text-[10px] tracking-[0.15em] uppercase bg-text text-white rounded-sm">Add</button>
                <button onClick={() => { setCustomMode(false); setCustomName('') }} className="px-2 py-2 text-[10px] tracking-[0.15em] uppercase text-text-muted">Cancel</button>
              </div>
            ) : (
              <select value={category} onChange={e => { if (e.target.value === '__new__') { setCustomMode(true); setCustomName('') } else setCategory(e.target.value) }}
                className="w-full bg-tile rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blush">
                <option value="">— Choose a category —</option>
                {FIXED.map(([slug, label]) => <option key={slug} value={slug}>{label}</option>)}
                {customCategories.length > 0 && <optgroup label="Custom">{customCategories.map(c => <option key={c.slug} value={c.slug}>{c.label}</option>)}</optgroup>}
                {category && !currentInList && <option value={category}>{labelForCategory(category)}</option>}
                <option value="__new__">＋ New category…</option>
              </select>
            )}
          </div>

          <Field label="Color" value={color} onChange={setColor} placeholder="e.g. Navy" />

          <div>
            <label className="text-[10px] tracking-[0.3em] uppercase text-text-muted/60 block mb-1.5">Styling Note</label>
            <textarea value={styleNote} onChange={e => setStyleNote(e.target.value)} rows={2} placeholder="Optional (stylist-only)"
              className="w-full bg-tile rounded-sm px-3 py-2 text-sm placeholder:text-text-muted/40 focus:outline-none focus:ring-1 focus:ring-blush resize-none" />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button onClick={close} className="px-4 py-2 text-[11px] tracking-[0.15em] uppercase text-text-muted hover:text-text">Cancel</button>
          <button onClick={addToCollection} disabled={saving || !ready || !name.trim()}
            className="px-4 py-2 text-[11px] tracking-[0.15em] uppercase bg-text text-white rounded-sm disabled:opacity-40 flex items-center gap-1.5">
            {saving && <Loader2 className="h-3 w-3 animate-spin" />} Add to Collection
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-[10px] tracking-[0.3em] uppercase text-text-muted/60 block mb-1.5">{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-tile rounded-sm px-3 py-2 text-sm placeholder:text-text-muted/40 focus:outline-none focus:ring-1 focus:ring-blush" />
    </div>
  )
}
