import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { proposePairing, type ProposalPhoto } from '@/lib/pairing'
import { SignedImage } from './IntakeItemCard'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const proxy = (k: string) => `${SUPABASE_URL}/functions/v1/image-proxy?key=${encodeURIComponent(k)}`

interface BoardPhoto { id: string; r2_key: string; classified_as: string | null; original_filename: string | null; rotation: number }
interface BoardBatch { id: string; batch_label: string | null; category: string | null }
// One item the stylist is building: a garment + optional tag. No AI pre-grouping —
// the person assigns every photo, so pairing is confirmed, never guessed.
interface BuildItem { id: string; garmentId: string; tagId: string | null }
type Inspect = { mode: 'single'; idx: number } | { mode: 'compare'; ids: [string, string] } | null

// Confirm board (manual tagger): batches parked at status='pending_confirm' show every photo
// in upload order. The stylist taps each as an "Item" (garment) or its "Tag", zooms to inspect
// fabric, and can compare two similar photos side-by-side before deciding. Nothing renders until
// they hit Digitize → intake-confirm-items creates exactly the confirmed items.
export function IntakeConfirmBoard({ onDone, clientId, onWaiting }: { onDone?: () => void; clientId?: string | null; onWaiting?: (n: number) => void }) {
  const [batches, setBatches] = useState<BoardBatch[]>([])
  const [activeBatch, setActiveBatch] = useState<string | null>(null)
  const [photos, setPhotos] = useState<Record<string, BoardPhoto>>({})
  const [order, setOrder] = useState<string[]>([])
  const [items, setItems] = useState<BuildItem[]>([])
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [compareSel, setCompareSel] = useState<string[]>([])
  const [inspect, setInspect] = useState<Inspect>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  // Report how many batches are waiting so the parent can show a count on the collapsed header.
  useEffect(() => { onWaiting?.(batches.length) }, [batches.length, onWaiting])
  const idSeq = useRef(0)
  const newId = () => `it_${idSeq.current++}`

  const loadBatches = useCallback(async () => {
    // Scope to the selected client so two stylists working different clients in parallel don't see
    // (or accidentally tag) each other's batches. When no client is selected (ALL), show everything.
    let q = supabase
      .from('intake_batches')
      .select('id, batch_label, category')
      .eq('status', 'pending_confirm')
      .order('created_at', { ascending: false })
    if (clientId) q = q.eq('client_id', clientId)
    const { data } = await q
    setBatches(data ?? [])
    setActiveBatch((prev) => prev ?? (data && data.length ? data[0].id : null))
  }, [clientId])

  useEffect(() => { loadBatches() }, [loadBatches])

  // When the client filter changes, drop the active batch so the board re-picks from the new
  // client's queue (loadBatches only auto-selects when none is chosen, to avoid disrupting the poll).
  useEffect(() => { setActiveBatch(null) }, [clientId])

  // Poll: a batch that finishes classifying flips to 'pending_confirm' AFTER this board mounted,
  // so without polling it wouldn't appear until a hard refresh. loadBatches only sets activeBatch
  // when none is chosen, so this never disrupts an in-progress sort.
  useEffect(() => {
    const iv = setInterval(() => { loadBatches() }, 5000)
    return () => clearInterval(iv)
  }, [loadBatches])

  // Load one batch's photos in upload order; reset the build.
  useEffect(() => {
    if (!activeBatch) return
    ;(async () => {
      const { data } = await supabase
        .from('intake_photos')
        .select('id, r2_key, classified_as, original_filename, position_in_batch, rotation')
        .eq('batch_id', activeBatch)
        .order('position_in_batch', { ascending: true })
      const ps = (data ?? []) as (BoardPhoto & { position_in_batch: number })[]
      const map: Record<string, BoardPhoto> = {}
      const ord: string[] = []
      ps.forEach((p) => {
        map[p.id] = { id: p.id, r2_key: p.r2_key, classified_as: p.classified_as, original_filename: p.original_filename, rotation: p.rotation ?? 0 }
        ord.push(p.id)
      })
      setPhotos(map); setOrder(ord); setItems([]); setActiveItemId(null); setCompareSel([]); setMsg('')
    })()
  }, [activeBatch])

  // photoId -> which item it belongs to and in what role (drives badges + dimming).
  const assignment = useMemo(() => {
    const m: Record<string, { itemIdx: number; role: 'garment' | 'tag' }> = {}
    items.forEach((it, idx) => {
      m[it.garmentId] = { itemIdx: idx, role: 'garment' }
      if (it.tagId) m[it.tagId] = { itemIdx: idx, role: 'tag' }
    })
    return m
  }, [items])

  const unsorted = order.filter((id) => !assignment[id])
  const activeIdx = items.findIndex((x) => x.id === activeItemId)

  // Rotate a source photo 90° (persists to intake_photos.rotation; the gen path applies it before
  // the AI call, so an upside-down/sideways photo digitizes upright). Optimistic local update.
  const rotatePhoto = async (photoId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    const cur = photos[photoId]
    if (!cur) return
    const next = (((cur.rotation ?? 0) + 90) % 360)
    setPhotos((m) => ({ ...m, [photoId]: { ...m[photoId], rotation: next } }))
    await supabase.from('intake_photos').update({ rotation: next }).eq('id', photoId)
  }

  // ---- assignment actions ----
  const makeItem = (photoId: string) => {
    if (assignment[photoId]) return
    const id = newId()
    setItems((prev) => [...prev, { id, garmentId: photoId, tagId: null }])
    setActiveItemId(id)
    setMsg('')
  }
  const makeTag = (photoId: string) => {
    if (assignment[photoId]) return
    if (!activeItemId) { setMsg('Tap “Item” on a garment first, then add its tag.'); return }
    // Attaching to an item that already has a tag replaces it; the old tag frees up automatically.
    setItems((prev) => prev.map((it) => (it.id === activeItemId ? { ...it, tagId: photoId } : it)))
    setMsg('')
  }
  const unassign = (photoId: string) => {
    const a = assignment[photoId]; if (!a) return
    const it = items[a.itemIdx]
    if (a.role === 'garment') {
      setItems((prev) => prev.filter((x) => x.id !== it.id))
      if (activeItemId === it.id) setActiveItemId(null)
    } else {
      setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, tagId: null } : x)))
    }
  }
  const detachTag = (itemId: string) => setItems((prev) => prev.map((x) => (x.id === itemId ? { ...x, tagId: null } : x)))
  const removeItem = (itemId: string) => {
    setItems((prev) => prev.filter((x) => x.id !== itemId))
    if (activeItemId === itemId) setActiveItemId(null)
  }

  // Optional accelerator — deterministic, role-aware, garment-anchored (won't cascade). Pre-fills
  // items in upload order; everything stays editable so the stylist just fixes the exceptions.
  const autopair = () => {
    const proposal = proposePairing(order.map((id) => ({ id, classified_as: photos[id]?.classified_as as ProposalPhoto['classified_as'] })))
    const built: BuildItem[] = proposal.items.map((p) => ({ id: newId(), garmentId: p.garmentId, tagId: p.tagId }))
    setItems(built)
    setActiveItemId(built.length ? built[built.length - 1].id : null)
    setMsg(`Proposed ${built.length} item(s) in upload order — review and fix any that look wrong.`)
  }
  const clearAll = () => { setItems([]); setActiveItemId(null); setCompareSel([]); setMsg('') }

  const toggleCompare = (photoId: string) => {
    setCompareSel((prev) =>
      prev.includes(photoId) ? prev.filter((x) => x !== photoId) : prev.length >= 2 ? [prev[1], photoId] : [...prev, photoId],
    )
  }

  // ---- inspect overlay ----
  const openSingle = (photoId: string) => setInspect({ mode: 'single', idx: order.indexOf(photoId) })
  const openCompare = () => { if (compareSel.length === 2) setInspect({ mode: 'compare', ids: [compareSel[0], compareSel[1]] }) }
  const nextUnassignedFrom = (idx: number) => {
    for (let i = idx + 1; i < order.length; i++) if (!assignment[order[i]]) return i
    return Math.min(idx + 1, order.length - 1)
  }

  // Keyboard in single-inspect: I = item, T = tag (both advance), ← → move, Esc close.
  useEffect(() => {
    if (!inspect) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setInspect(null); return }
      if (inspect.mode !== 'single') return
      const curId = order[inspect.idx]
      if (e.key === 'ArrowRight') setInspect({ mode: 'single', idx: Math.min(inspect.idx + 1, order.length - 1) })
      else if (e.key === 'ArrowLeft') setInspect({ mode: 'single', idx: Math.max(inspect.idx - 1, 0) })
      else if (e.key.toLowerCase() === 'i') { makeItem(curId); setInspect({ mode: 'single', idx: nextUnassignedFrom(inspect.idx) }) }
      else if (e.key.toLowerCase() === 't') { makeTag(curId); setInspect({ mode: 'single', idx: nextUnassignedFrom(inspect.idx) }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspect, order, assignment, activeItemId, items, photos])

  const confirm = async () => {
    if (!activeBatch) return
    if (!items.length) { setMsg('Build at least one item before digitizing.'); return }
    // Guard: a batch must NOT be digitized while photos are still untagged — those photos get
    // left out of the batch (this is how a 66-photo upload once dropped 65). Force an explicit
    // acknowledgement that the untagged photos will be skipped before proceeding.
    if (unsorted.length > 0) {
      const ok = window.confirm(
        `${unsorted.length} photo${unsorted.length === 1 ? ' is' : 's are'} not tagged as Item or Tag yet and will NOT be digitized — they'll be left out of this batch.\n\n` +
        `Click Cancel to go back and tag them, or OK to digitize ${items.length} item${items.length === 1 ? '' : 's'} and skip the other ${unsorted.length}.`,
      )
      if (!ok) return
    }
    const assignments = items.map((i) => ({ garment_photo_id: i.garmentId, tag_photo_id: i.tagId }))
    setBusy(true); setMsg('Creating items…')
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-confirm-items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: activeBatch, assignments }),
      })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(body.error || 'Confirm failed')
      setMsg(`Digitizing ${body.items_created} item(s) — they’ll appear in the inbox shortly.`)
      setActiveBatch(null)
      await loadBatches()
      onDone?.()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Confirm failed') }
    finally { setBusy(false) }
  }

  // Always render the panel (even with nothing to confirm) so stylists have a stable place to look —
  // it just shows a "0 waiting" empty state instead of disappearing.
  if (!batches.length) return (
    <div className="max-w-5xl mx-auto py-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="text-[15px] font-medium text-[#1A1A1A]">
          Confirm items <span className="text-[#aaa] font-normal">(0 waiting)</span>
        </h2>
      </div>
      <p className="text-[11px] text-[#888]">
        Nothing waiting to confirm{clientId ? ' for this client' : ''}. New uploads land here once they finish classifying.
      </p>
    </div>
  )

  const badge = (a: { itemIdx: number; role: 'garment' | 'tag' }) => (
    <span
      className="absolute top-1 left-1 text-[8px] tracking-[0.08em] uppercase px-1 py-0.5 rounded-sm text-white"
      style={{ background: a.role === 'garment' ? '#185FA5' : '#7a7a7a' }}
    >
      Item {a.itemIdx + 1} · {a.role}
    </span>
  )

  return (
    <div className="max-w-5xl mx-auto py-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="text-[15px] font-medium text-[#1A1A1A]">
          Confirm items {batches.length > 1 ? `(${batches.length} batches waiting)` : ''}
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={autopair} className="text-[10px] px-2 py-1 border border-[#E8E4DF] rounded-sm hover:bg-[#F8F7F5]">
            ⚡ Pair in upload order
          </button>
          <button onClick={clearAll} className="text-[10px] px-2 py-1 border border-[#E8E4DF] rounded-sm hover:bg-[#F8F7F5]">
            Clear
          </button>
        </div>
      </div>
      <p className="text-[11px] text-[#888] mb-3">
        Tap each photo as an <span className="text-[#185FA5] font-medium">Item</span> (the garment) or its{' '}
        <span className="text-[#666] font-medium">Tag</span>. Click any photo to zoom in. Tick two to compare them side-by-side.
      </p>

      {/* Batch switcher */}
      {batches.length > 1 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {batches.map((b) => (
            <button
              key={b.id}
              onClick={() => setActiveBatch(b.id)}
              className={`text-[10px] px-2 py-1 rounded-sm border ${b.id === activeBatch ? 'border-[#1A1A1A] bg-[#1A1A1A] text-white' : 'border-[#E8E4DF]'}`}
            >
              {b.batch_label || b.id.slice(0, 8)}
            </button>
          ))}
        </div>
      )}

      {/* Photo strip */}
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 mb-5">
        {order.map((id) => {
          const p = photos[id]
          const a = assignment[id]
          const cmp = compareSel.includes(id)
          return (
            <div key={id} className={`rounded-sm border ${a ? 'border-[#E8E4DF] opacity-70' : 'border-[#ddd]'} p-1`}>
              <div className="relative aspect-[4/5] bg-[#F8F7F5] rounded-sm overflow-hidden cursor-zoom-in" onClick={() => openSingle(id)}>
                {p ? (
                  <div className="w-full h-full transition-transform duration-150" style={{ transform: `rotate(${p.rotation ?? 0}deg)` }}>
                    <SignedImage r2Key={p.r2_key} alt="" className="w-full h-full object-contain" />
                  </div>
                ) : null}
                {p ? (
                  <button
                    onClick={(e) => rotatePhoto(id, e)}
                    title="Rotate 90° (digitizes upright)"
                    className="absolute top-1 right-1 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-white/85 border border-[#E8E4DF] text-[#1A1A1A] text-sm leading-none hover:bg-white"
                  >
                    ↻
                  </button>
                ) : null}
                {a ? badge(a) : null}
              </div>
              <div className="flex items-center gap-1 mt-1">
                {a ? (
                  <button onClick={() => unassign(id)} className="flex-1 text-[9px] px-1 py-1 border border-[#E8E4DF] rounded-sm text-[#a33]">
                    × unassign
                  </button>
                ) : (
                  <>
                    <button onClick={() => makeItem(id)} className="flex-1 text-[9px] px-1 py-1 border border-[#185FA5] text-[#185FA5] rounded-sm">
                      Item
                    </button>
                    <button onClick={() => makeTag(id)} className="flex-1 text-[9px] px-1 py-1 border border-[#999] text-[#666] rounded-sm">
                      Tag
                    </button>
                  </>
                )}
                <button
                  onClick={() => toggleCompare(id)}
                  title="Compare"
                  className={`text-[9px] px-1.5 py-1 rounded-sm border ${cmp ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' : 'border-[#E8E4DF]'}`}
                >
                  ⊞
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {compareSel.length === 2 && (
        <div className="mb-4">
          <button onClick={openCompare} className="text-[11px] px-3 py-1.5 border border-[#1A1A1A] rounded-sm">
            ⊞ Compare the 2 selected photos
          </button>
        </div>
      )}

      {/* Items built */}
      {items.length > 0 && (
        <div className="mb-5">
          <p className="text-[11px] font-medium text-[#1A1A1A] mb-2">Items ({items.length}) — tap one to make it active for the next tag</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {items.map((it, idx) => {
              const active = it.id === activeItemId
              return (
                <div
                  key={it.id}
                  onClick={() => setActiveItemId(it.id)}
                  className={`rounded-md border p-2 cursor-pointer ${active ? 'border-[#1A1A1A] bg-[#1A1A1A]/[0.03]' : 'border-[#E8E4DF]'}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-medium">Item {idx + 1}{active ? ' · active' : ''}</span>
                    <button onClick={(e) => { e.stopPropagation(); removeItem(it.id) }} className="text-[9px] text-[#a33]">remove</button>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <p className="text-[8px] tracking-[0.1em] uppercase mb-0.5" style={{ color: '#185FA5' }}>Garment</p>
                      <div className="aspect-[4/5] rounded-sm overflow-hidden border border-[#E8E4DF] bg-[#F8F7F5]">
                        {photos[it.garmentId] ? <SignedImage r2Key={photos[it.garmentId].r2_key} alt="garment" className="w-full h-full object-contain" /> : null}
                      </div>
                    </div>
                    <div className="flex-1">
                      <p className="text-[8px] tracking-[0.1em] uppercase mb-0.5 text-[#888]">Tag</p>
                      {it.tagId ? (
                        <div className="relative aspect-[4/5] rounded-sm overflow-hidden border border-[#E8E4DF] bg-[#F8F7F5]">
                          <SignedImage r2Key={photos[it.tagId].r2_key} alt="tag" className="w-full h-full object-contain" />
                          <button
                            onClick={(e) => { e.stopPropagation(); detachTag(it.id) }}
                            className="absolute top-0.5 right-0.5 w-4 h-4 bg-white/90 rounded-full text-[9px] leading-none flex items-center justify-center"
                          >×</button>
                        </div>
                      ) : (
                        <div className="aspect-[4/5] flex items-center justify-center text-[9px] text-[#bbb] border border-dashed border-[#E8E4DF] rounded-sm">no tag</div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Sticky footer */}
      <div className="flex items-center justify-between gap-3 mt-4 sticky bottom-0 bg-white py-3 border-t border-[#E8E4DF]">
        <div className="text-[11px] text-[#888] min-w-0">
          {msg ? (
            <span>{msg}</span>
          ) : (
            <span>
              {items.length} item{items.length === 1 ? '' : 's'} built
              {unsorted.length > 0 && (
                <span className="text-amber-800"> · ⚠ {unsorted.length} photo{unsorted.length === 1 ? '' : 's'} not sorted (won’t be digitized)</span>
              )}
            </span>
          )}
        </div>
        <button
          onClick={confirm}
          disabled={busy || !items.length}
          className="px-6 py-2.5 bg-[#1A1A1A] text-white text-[11px] tracking-[0.15em] uppercase rounded-sm disabled:opacity-40 shrink-0"
        >
          {busy ? 'Working…' : `Digitize ${items.length} item${items.length === 1 ? '' : 's'}`}
        </button>
      </div>

      {/* Inspect / compare overlay */}
      {inspect && (
        <div className="fixed inset-0 bg-black/85 z-[120] flex flex-col items-center justify-center p-4" onClick={() => setInspect(null)}>
          {inspect.mode === 'single' ? (
            (() => {
              const id = order[inspect.idx]
              const p = photos[id]
              const a = assignment[id]
              if (!p) return null
              return (
                <div className="relative flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
                  <img src={proxy(p.r2_key)} alt="" className="max-w-[92vw] max-h-[72vh] object-contain rounded-sm" />
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={() => setInspect({ mode: 'single', idx: Math.max(0, inspect.idx - 1) })} className="px-3 py-2 text-white/80 text-lg">‹</button>
                    {a ? (
                      <button onClick={() => unassign(id)} className="px-4 py-2 bg-white text-[#a33] text-[11px] rounded-sm">× unassign (Item {a.itemIdx + 1} · {a.role})</button>
                    ) : (
                      <>
                        <button onClick={() => { makeItem(id); setInspect({ mode: 'single', idx: nextUnassignedFrom(inspect.idx) }) }} className="px-4 py-2 bg-[#185FA5] text-white text-[11px] rounded-sm">This is an ITEM</button>
                        <button onClick={() => { makeTag(id); setInspect({ mode: 'single', idx: nextUnassignedFrom(inspect.idx) }) }} className="px-4 py-2 bg-white text-[#1A1A1A] text-[11px] rounded-sm">
                          This is a TAG{activeIdx >= 0 ? ` for Item ${activeIdx + 1}` : ''}
                        </button>
                      </>
                    )}
                    <button onClick={() => setInspect({ mode: 'single', idx: Math.min(order.length - 1, inspect.idx + 1) })} className="px-3 py-2 text-white/80 text-lg">›</button>
                  </div>
                  <p className="text-white/50 text-[10px] mt-2">{inspect.idx + 1} / {order.length} · Esc close · ← → move · I = item · T = tag</p>
                </div>
              )
            })()
          ) : (
            <div className="flex gap-4 w-full max-w-[94vw] max-h-[86vh]" onClick={(e) => e.stopPropagation()}>
              {inspect.ids.map((id) => (
                <div key={id} className="flex-1 min-w-0 flex items-center justify-center">
                  {photos[id] ? <img src={proxy(photos[id].r2_key)} alt="" className="max-w-full max-h-[84vh] object-contain rounded-sm" /> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
