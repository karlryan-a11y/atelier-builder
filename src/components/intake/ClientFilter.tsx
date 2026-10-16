import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

export interface ClientFilterOption { id: string; name: string; count?: number }

/**
 * The client filter on the Digitize page (Karl, 2026-10-16: "change it to a search bar, then you select the client and see only that
 * client's items"). It replaces the row of one chip per client, which ran off the screen. Type to search; pick "All clients" or a client.
 * The chosen client shows as a pill with a clear button.
 */
export function ClientFilter({ options, value, valueName, onChange }: {
  options: ClientFilterOption[]
  value: string | null
  valueName?: string
  onChange: (id: string | null) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    const hit = s ? options.filter((o) => o.name.toLowerCase().includes(s)) : options
    // clients with pieces waiting first, then the rest alphabetically
    return [...hit].sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.name.localeCompare(b.name)).slice(0, 40)
  }, [options, q])

  const pick = (id: string | null) => { onChange(id); setOpen(false); setQ('') }
  const selectedName = value ? (options.find((o) => o.id === value)?.name ?? valueName ?? 'Client') : null

  return (
    <div ref={wrap} className="relative flex items-center gap-3">
      <span className="text-[9px] tracking-[0.22em] uppercase text-[#888]">Client</span>
      {selectedName ? (
        <span className="inline-flex items-center gap-2 bg-[#1A1A1A] text-white pl-3 pr-1.5 py-1 text-[11px] tracking-[0.08em]">
          {selectedName}
          <button type="button" aria-label="Show all clients" onClick={() => pick(null)} className="p-1 hover:bg-white/15"><X size={12} /></button>
        </span>
      ) : (
        <span className="text-[11px] tracking-[0.08em] text-[#888]">All clients</span>
      )}
      <div className="relative w-[260px]">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#888]" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'Enter' && matches[0]) pick(matches[0].id)
          }}
          placeholder="Search clients"
          aria-label="Search clients"
          className="w-full border border-[#E8E4DF] bg-white pl-8 pr-2 py-1.5 text-[12px] text-[#1A1A1A] outline-none focus:border-[#1A1A1A]"
        />
        {open ? (
          <ul role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto border border-[#E8E4DF] bg-white shadow-lg">
            <li>
              <button type="button" onClick={() => pick(null)} className={`block w-full px-3 py-2 text-left text-[12px] hover:bg-[#F8F7F5] ${!value ? 'text-[#1A1A1A]' : 'text-[#888]'}`}>All clients</button>
            </li>
            {matches.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => pick(o.id)} className={`flex w-full items-center justify-between px-3 py-2 text-left text-[12px] hover:bg-[#F8F7F5] ${value === o.id ? 'bg-[#F8F7F5]' : ''}`}>
                  <span className="truncate">{o.name}</span>
                  {o.count != null ? <span className="ml-2 text-[10px] text-[#888]">{o.count}</span> : null}
                </button>
              </li>
            ))}
            {matches.length === 0 ? <li className="px-3 py-2 text-[12px] text-[#888]">No client matches</li> : null}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
