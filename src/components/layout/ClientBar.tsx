import { useState, useMemo, useRef, useEffect } from 'react'
import { Search, ChevronDown, User, Plus, Loader2 } from 'lucide-react'
import { useClients } from '@/hooks/useClients'
import { useClientStore } from '@/stores/clientStore'

const TIERS = ['A-la-carte', 'Signature', 'White Glove', 'Elève']

/**
 * The ONE client selector for the whole styling workspace (Canvas, Categorize, Shop).
 * Pinned top-left so the active client is always visible — a name pill you click to
 * search/switch. Reads/writes the shared `useClientStore.activeClient`, so picking a
 * client here updates every panel at once. Also creates new clients (the only create
 * entry point now that the per-panel selectors are gone).
 */
export function ClientBar() {
  const { clients, refetch } = useClients()
  const { activeClient, setActiveClient } = useClientStore()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newTier, setNewTier] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return clients.slice(0, 30)
    return clients.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 30)
  }, [clients, search])

  function pick(c: { id: string; name: string }) {
    setActiveClient(c)
    setOpen(false)
    setSearch('')
  }

  async function createClient() {
    const name = newName.trim()
    if (!name || creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const resp = await fetch('/api/create-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email: newEmail.trim() || undefined, phone: newPhone.trim() || undefined, membership_tier: newTier || undefined }),
      })
      const data = await resp.json()
      if (!resp.ok || !data?.client?.id) throw new Error(data?.error || 'Could not create client')
      refetch()
      setActiveClient({ id: data.client.id, name: data.client.name })
      setShowNew(false); setNewName(''); setNewEmail(''); setNewPhone(''); setNewTier('')
      setOpen(false)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Could not create client')
    } finally {
      setCreating(false)
    }
  }

  const inputCls = 'w-full bg-transparent border-0 border-b border-[#E8E4DF] text-sm pb-2 focus:outline-none focus:border-[#1A1A1A] transition-colors placeholder:text-[#aaa]'

  return (
    <div ref={wrapRef} className="relative">
      {/* The always-visible pill — shows who you're working on. */}
      <button
        onClick={() => { setOpen((o) => !o); setShowNew(false) }}
        title="Switch client"
        className={`flex items-center gap-2 h-8 pl-2.5 pr-2 rounded-sm border transition-colors max-w-[260px] ${
          activeClient ? 'bg-white border-[#E8E4DF] hover:border-[#ccc]' : 'bg-[#F8E5E7]/40 border-[#F0CDD0]'
        }`}
      >
        <User className="h-3.5 w-3.5 text-[#888] flex-none" />
        <span className={`text-[13px] truncate ${activeClient ? 'text-[#1A1A1A]' : 'text-[#9a6b70]'}`}>
          {activeClient?.name ?? 'Select client…'}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-[#aaa] flex-none transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-50 w-[300px] bg-white border border-[#E8E4DF] rounded-sm shadow-lg overflow-hidden">
          {!showNew ? (
            <>
              <div className="relative border-b border-[#F0EFEC]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#bbb]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search clients…"
                  autoFocus
                  className="w-full pl-9 pr-3 py-2.5 text-sm focus:outline-none placeholder:text-[#bbb]"
                />
              </div>
              <div className="max-h-[320px] overflow-y-auto py-1">
                {filtered.length === 0 ? (
                  <p className="px-3 py-3 text-[13px] text-[#999]">No clients match.</p>
                ) : filtered.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => pick(c)}
                    className={`w-full text-left px-3 py-2 text-[13px] hover:bg-[#F8F7F5] transition-colors ${
                      activeClient?.id === c.id ? 'bg-[#F8F7F5] font-medium text-[#1A1A1A]' : 'text-[#444]'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <button
                onClick={() => { setShowNew(true); setCreateError(null) }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-[12px] tracking-[0.1em] uppercase text-[#888] border-t border-[#F0EFEC] hover:bg-[#F8F7F5] hover:text-[#1A1A1A] transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> New client
              </button>
            </>
          ) : (
            <div className="p-4 space-y-3">
              <p className="text-[10px] tracking-[0.2em] uppercase text-[#888]">New client</p>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createClient()} placeholder="Client name (required)" autoFocus className={inputCls} />
              <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email (optional)" className={inputCls} />
              <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Phone (optional)" className={inputCls} />
              <select value={newTier} onChange={(e) => setNewTier(e.target.value)} className={inputCls + ' text-[#888]'}>
                <option value="">Membership tier (optional)</option>
                {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {createError && <p className="text-[10px] text-red-600">{createError}</p>}
              <div className="flex items-center gap-3 pt-1">
                <button onClick={createClient} disabled={creating || !newName.trim()} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1A1A1A] text-white text-[10px] tracking-[0.2em] uppercase rounded-sm hover:bg-[#333] transition-colors disabled:opacity-40">
                  {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  {creating ? 'Creating…' : 'Create'}
                </button>
                <button onClick={() => setShowNew(false)} className="text-[10px] tracking-[0.15em] uppercase text-[#888] hover:text-[#1A1A1A]">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
