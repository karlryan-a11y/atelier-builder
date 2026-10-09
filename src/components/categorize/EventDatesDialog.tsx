import { useState } from 'react'
import { X } from 'lucide-react'
import { formatEventDates } from '@/lib/eventDates'

/**
 * Set the date(s) of a look or a packing capsule (migration 041). One date for an evening, a
 * start and an end for a trip. Her lookbook shows it beside the name, lists it on her home page
 * while it is coming up, and moves it into Past trips (capsules) or "Worn" (looks) after.
 */
export function EventDatesDialog({ kind, name, start, end, onSave, onClose }: {
  kind: 'look' | 'capsule'
  name: string
  start: string | null
  end: string | null
  onSave: (start: string | null, end: string | null) => Promise<string | null>
  onClose: () => void
}) {
  const [s, setS] = useState(start ?? '')
  const [e, setE] = useState(end ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const preview = formatEventDates(s || null, e || null)

  async function save(nextS: string | null, nextE: string | null) {
    setBusy(true); setErr(null)
    const msg = await onSave(nextS, nextE)
    setBusy(false)
    if (msg) setErr(msg); else onClose()
  }

  const input = 'w-full border border-[#E8E4DF] px-3 py-2 text-[13px] focus:outline-none focus:border-[#1A1A1A]'
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div data-event-dates-dialog className="bg-white w-full max-w-sm p-5 rounded-sm" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[9px] tracking-[0.25em] uppercase text-[#888]">{kind === 'capsule' ? 'Trip dates' : 'Date'}</p>
            <p className="text-[14px] text-[#1A1A1A] mt-0.5">{name}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-[#999] hover:text-[#1A1A1A]"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-[10px] tracking-[0.15em] uppercase text-[#888]">{kind === 'capsule' ? 'Leaves' : 'Date'}
            <input type="date" value={s} onChange={(ev) => setS(ev.target.value)} className={`${input} mt-1`} />
          </label>
          <label className="text-[10px] tracking-[0.15em] uppercase text-[#888]">{kind === 'capsule' ? 'Back' : 'Until (optional)'}
            <input type="date" value={e} min={s || undefined} onChange={(ev) => setE(ev.target.value)} className={`${input} mt-1`} />
          </label>
        </div>
        <p className="mt-3 text-[12px] text-[#1A1A1A] min-h-[18px]">{preview ? `${name} · ${preview}` : ''}</p>
        <p className="mt-1 text-[11px] text-[#888] leading-relaxed">
          Shows next to the name on her lookbook and on her home page while it is coming up. After the date it moves to {kind === 'capsule' ? 'Past trips' : '"Worn"'}, and she can still open it.
        </p>
        {err && <p className="mt-2 text-[12px] text-[#8B0000]">{err}</p>}
        <div className="mt-4 flex items-center gap-2">
          <button disabled={busy || !s} onClick={() => void save(s || null, e || null)}
            className="flex-1 py-2 text-[10px] tracking-[0.2em] uppercase bg-[#1A1A1A] text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>
          {(start || end) && (
            <button disabled={busy} onClick={() => void save(null, null)}
              className="py-2 px-3 text-[10px] tracking-[0.2em] uppercase border border-[#E8E4DF] text-[#888] hover:text-[#1A1A1A]">Clear</button>
          )}
        </div>
      </div>
    </div>
  )
}
