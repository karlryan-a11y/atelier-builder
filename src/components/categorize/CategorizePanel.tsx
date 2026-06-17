import { useMemo, useState } from 'react'
import { Plus, Tag, X, Send, ChevronDown, Pencil, Check } from 'lucide-react'
import { useClientStore } from '@/stores/clientStore'
import { useClients } from '@/hooks/useClients'
import { useLookCategories, type TaggableLook, type TaggableCapsule } from '@/hooks/useLookCategories'
import { supabase } from '@/lib/supabase'

const PROVISION_URL = 'https://atelierbywatson.com/looks/api/chat/provision'

function ClientPicker({
  clients, value, onChange,
}: { clients: { id: string; name: string }[]; value: string | null; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const current = clients.find((c) => c.id === value)
  return (
    <div className="relative">
      <button
        onClick={() => { setOpen(!open); setSearch('') }}
        className="w-full flex items-center justify-between text-left px-3 py-2 rounded border border-[#E8E4DF] bg-white hover:border-[#1A1A1A] transition-colors"
      >
        <span className="text-[13px] text-[#1A1A1A]">{current?.name ?? 'Select client…'}</span>
        <ChevronDown className="h-3.5 w-3.5 text-[#888]" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-[#E8E4DF] rounded shadow-lg z-50 max-h-72 flex flex-col overflow-hidden">
          <div className="p-2 border-b border-[#E8E4DF]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients…"
              autoFocus
              className="w-full bg-[#F8F7F5] rounded px-2.5 py-1.5 text-[12px] placeholder:text-[#888]/60 focus:outline-none focus:ring-1 focus:ring-[#F8E5E7]"
            />
          </div>
          <div className="overflow-y-auto">
            {clients
              .filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()))
              .map((c) => (
                <button
                  key={c.id}
                  onClick={() => { onChange(c.id); setOpen(false); setSearch('') }}
                  className={`w-full text-left px-3 py-2 text-[13px] hover:bg-[#F8F7F5] transition-colors ${
                    value === c.id ? 'bg-[#F8F7F5] font-medium' : ''
                  }`}
                >
                  {c.name}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

type Mode = 'looks' | 'capsules'
type Status = 'draft' | 'published' | 'archived' | 'all'

export function CategorizePanel() {
  const { activeClient, setActiveClient } = useClientStore()
  const { clients } = useClients()
  const pickClient = (id: string) => setActiveClient(clients.find((c) => c.id === id) ?? null)
  const {
    loading, categories, looks, capsules, createCategory, renameCategory,
    assignLook, assignCapsule,
    setLookPublished, setCapsulePublished,
    archiveLook, archiveCapsule,
    restoreLook, restoreCapsule,
  } = useLookCategories(activeClient?.id ?? null)

  const [mode, setMode] = useState<Mode>('looks')
  const [brush, setBrush] = useState<string | null>(null)   // category ID
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<Status>('draft')
  const [newCat, setNewCat] = useState('')
  const [editing, setEditing] = useState<string | null>(null) // category ID being renamed
  const [editVal, setEditVal] = useState('')
  const [chatStatus, setChatStatus] = useState<string | null>(null)

  // Enable client↔stylist chat for the active client: creates/links their private
  // Slack channel + wires the conversation, via the lookbook provision endpoint
  // (authed with this stylist's builder session token).
  async function enableChat() {
    if (!activeClient) return
    setChatStatus('Enabling…')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(PROVISION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ clientId: activeClient.id }),
      })
      const data = await res.json()
      setChatStatus(res.ok ? `Chat on · #${data.channelName}` : `Failed: ${data.error || res.status}`)
    } catch (e) {
      setChatStatus('Failed: network error')
    }
  }

  // Share a look/capsule into the client's chat (lands as a card in their thread).
  async function shareToChat(itemId: string) {
    if (!activeClient) return
    setChatStatus('Sharing…')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('https://atelierbywatson.com/looks/api/chat/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ clientId: activeClient.id, type: mode === 'capsules' ? 'capsule' : 'look', itemId }),
      })
      const data = await res.json()
      setChatStatus(res.ok ? 'Shared to chat ✓' : `Share failed: ${data.error || res.status}`)
    } catch {
      setChatStatus('Share failed')
    }
  }

  const activeBrush = brush ?? categories[0]?.id ?? null
  const labelOf = useMemo(() => {
    const m = new Map(categories.map((c) => [c.id, c.label]))
    return (id: string) => m.get(id) ?? '—'
  }, [categories])
  const activeBrushLabel = activeBrush ? labelOf(activeBrush) : null

  const items: (TaggableLook | TaggableCapsule)[] = mode === 'looks' ? looks : capsules
  const assignItem = mode === 'looks' ? assignLook : assignCapsule
  const setItemPublished = mode === 'looks' ? setLookPublished : setCapsulePublished
  const archiveItem = mode === 'looks' ? archiveLook : archiveCapsule
  const restoreItem = mode === 'looks' ? restoreLook : restoreCapsule

  const queueCount = (arr: { published: boolean; archived: boolean }[]) =>
    arr.filter((i) => !i.published && !i.archived).length

  const visible = useMemo(
    () => items.filter((i) => {
      if (status === 'all') return true
      if (status === 'archived') return i.archived
      if (status === 'published') return i.published && !i.archived
      return !i.published && !i.archived // queue
    }),
    [items, status],
  )

  const has = (item: { categoryIds: string[] }, catId: string) => item.categoryIds.includes(catId)

  function toggleOnItem(item: { id: string; categoryIds: string[] }, catId: string) {
    assignItem(item.id, catId, !has(item, catId))
  }

  function onCardClick(item: { id: string; categoryIds: string[] }) {
    if (selected.size > 0) {
      setSelected((prev) => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n })
      return
    }
    if (activeBrush) toggleOnItem(item, activeBrush)
  }

  function applyBrushToSelected(remove = false) {
    if (!activeBrush || selected.size === 0) return
    for (const item of items) {
      if (!selected.has(item.id)) continue
      const on = !remove
      if (has(item, activeBrush) !== on) assignItem(item.id, activeBrush, on)
    }
    setSelected(new Set())
  }

  function publishSelected(publish: boolean) {
    if (selected.size === 0) return
    for (const item of items) if (selected.has(item.id)) setItemPublished(item.id, publish)
    setSelected(new Set())
  }

  async function handleCreate() {
    const n = newCat.trim()
    if (!n) return
    const cat = await createCategory(n)
    if (cat) setBrush(cat.id)
    setNewCat('')
  }

  function startRename(id: string, current: string) {
    setEditing(id); setEditVal(current)
  }
  function commitRename() {
    if (editing && editVal.trim()) renameCategory(editing, editVal)
    setEditing(null); setEditVal('')
  }

  if (!activeClient) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-5 bg-[#F8F7F5]">
        <p className="text-[#888] text-sm tracking-[0.1em] uppercase">Select a client to categorize</p>
        <div className="w-[300px]">
          <ClientPicker clients={clients} value={null} onChange={pickClient} />
        </div>
      </div>
    )
  }

  const statuses: { key: Status; label: string }[] = [
    { key: 'draft', label: `Queue (${queueCount(items)})` },
    { key: 'published', label: 'On lookbook' },
    { key: 'archived', label: `Archived (${items.filter((i) => i.archived).length})` },
    { key: 'all', label: 'All' },
  ]

  return (
    <div className="flex-1 flex overflow-hidden bg-[#F8F7F5]">
      {/* Left rail: category brush + rename + create */}
      <aside className="w-[260px] flex-none border-r border-[#E8E4DF] bg-white flex flex-col">
        <div className="px-5 py-4 border-b border-[#E8E4DF]">
          <p className="text-[10px] tracking-[0.3em] uppercase text-[#888] mb-2">Categorize</p>
          <ClientPicker clients={clients} value={activeClient.id} onChange={pickClient} />
          <button
            onClick={enableChat}
            className="mt-2 w-full text-[10px] tracking-[0.15em] uppercase py-1.5 rounded border border-[#E8E4DF] text-[#888] hover:text-[#1A1A1A] hover:border-[#1A1A1A] transition-colors"
            title="Create/link this client's Slack channel and turn on their chat"
          >Enable client chat</button>
          {chatStatus && <p className="mt-1 text-[10px] text-[#888] leading-snug">{chatStatus}</p>}
        </div>
        <div className="px-5 py-3 border-b border-[#E8E4DF] flex-1 overflow-hidden flex flex-col">
          <p className="text-[9px] tracking-[0.3em] uppercase text-[#888] mb-2">Active category</p>
          <p className="text-[10px] text-[#888] mb-3 leading-relaxed">
            Pick one, then click {mode} to tag them. Shift-click to multi-select. Pencil renames everywhere.
          </p>
          <div className="flex flex-col gap-1 overflow-y-auto pr-1">
            {categories.length === 0 && (
              <span className="text-[11px] text-[#bbb]">No categories yet — create one below.</span>
            )}
            {categories.map((cat) => {
              const isActive = activeBrush === cat.id
              if (editing === cat.id) {
                return (
                  <div key={cat.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-[#F8F7F5]">
                    <input
                      value={editVal}
                      onChange={(e) => setEditVal(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setEditing(null); setEditVal('') } }}
                      autoFocus
                      className="flex-1 min-w-0 bg-white border border-[#1A1A1A] rounded px-2 py-1 text-[12px] focus:outline-none"
                    />
                    <button onClick={commitRename} className="flex-none w-6 h-6 flex items-center justify-center rounded bg-[#1A1A1A] text-white hover:opacity-80" aria-label="Save name">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              }
              return (
                <div
                  key={cat.id}
                  className={`group flex items-center justify-between rounded text-[12px] transition-colors ${
                    isActive ? 'bg-[#1A1A1A] text-white' : 'text-[#1A1A1A] hover:bg-[#F8F7F5]'
                  }`}
                >
                  <button onClick={() => setBrush(cat.id)} className="flex-1 text-left px-3 py-2 capitalize truncate">
                    {cat.label}
                  </button>
                  <button
                    onClick={() => startRename(cat.id, cat.label)}
                    className={`flex-none mr-1.5 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${isActive ? 'hover:bg-white/20' : 'hover:bg-[#E8E4DF]'}`}
                    aria-label={`Rename ${cat.label}`}
                    title="Rename (updates every look in this category)"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-[#E8E4DF]">
          <div className="flex items-center gap-1.5">
            <input
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="New category"
              className="flex-1 min-w-0 bg-[#F8F7F5] border border-[#E8E4DF] rounded px-2.5 py-1.5 text-[12px] text-[#1A1A1A] focus:outline-none focus:border-[#1A1A1A]"
            />
            <button onClick={handleCreate} className="flex-none w-8 h-8 flex items-center justify-center rounded bg-[#1A1A1A] text-white hover:opacity-80" aria-label="Create category">
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-3 border-b border-[#E8E4DF] bg-white gap-4 flex-wrap">
          <div className="flex items-center gap-1">
            {(['looks', 'capsules'] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setSelected(new Set()) }}
                className={`px-4 py-1.5 text-[12px] tracking-[0.18em] uppercase rounded transition-colors ${mode === m ? 'bg-[#1A1A1A] text-white' : 'text-[#888] hover:text-[#1A1A1A]'}`}
              >{m}</button>
            ))}
          </div>

          <div className="flex items-center gap-1 bg-[#F8F7F5] rounded p-0.5">
            {statuses.map((s) => (
              <button
                key={s.key}
                onClick={() => { setStatus(s.key); setSelected(new Set()) }}
                className={`px-3 py-1.5 text-[11px] tracking-[0.1em] uppercase rounded transition-colors ${status === s.key ? 'bg-white text-[#1A1A1A] shadow-sm' : 'text-[#888] hover:text-[#1A1A1A]'}`}
              >{s.label}</button>
            ))}
          </div>

          {selected.size > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[11px] text-[#888]">{selected.size} selected</span>
              {activeBrushLabel && (
                <>
                  <button onClick={() => applyBrushToSelected(false)} className="px-2.5 py-1.5 text-[11px] tracking-[0.08em] uppercase rounded bg-[#F8E5E7] text-[#1A1A1A] hover:brightness-95">+ {activeBrushLabel}</button>
                  <button onClick={() => applyBrushToSelected(true)} className="px-2.5 py-1.5 text-[11px] tracking-[0.08em] uppercase rounded border border-[#E8E4DF] text-[#888] hover:text-[#1A1A1A]">− {activeBrushLabel}</button>
                </>
              )}
              <button onClick={() => publishSelected(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] tracking-[0.08em] uppercase rounded bg-[#1A1A1A] text-white hover:opacity-80">
                <Send className="w-3 h-3" /> Add to lookbook
              </button>
              <button onClick={() => setSelected(new Set())} className="text-[11px] text-[#888] hover:text-[#1A1A1A]">Clear</button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <p className="text-[#888] text-sm">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="text-[#888] text-sm">
              {status === 'draft' ? `No ${mode} waiting in the queue — all caught up.` : `No ${mode} here.`}
            </p>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-5">
              {visible.map((item) => {
                const isSel = selected.has(item.id)
                const hasBrush = activeBrush ? has(item, activeBrush) : false
                return (
                  <div
                    key={item.id}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        setSelected((prev) => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n })
                      } else { onCardClick(item) }
                    }}
                    className={`group relative cursor-pointer bg-white rounded-sm border-2 transition-all ${
                      isSel ? 'border-[#1A1A1A]' : hasBrush ? 'border-[#F8E5E7]' : 'border-transparent hover:border-[#E8E4DF]'
                    }`}
                  >
                    {/* status pill */}
                    <span className={`absolute top-1.5 left-1.5 z-10 text-[8px] tracking-[0.12em] uppercase px-1.5 py-0.5 rounded ${
                      item.archived ? 'bg-[#E8E4DF] text-[#6b6b6b]' : item.published ? 'bg-[#1A1A1A] text-white' : 'bg-[#F8E5E7] text-[#1A1A1A]'
                    }`}>{item.archived ? 'Archived' : item.published ? 'Live' : 'Draft'}</span>

                    {/* archive (non-archived cards) */}
                    {!item.archived && (
                      <button
                        onClick={(e) => { e.stopPropagation(); archiveItem(item.id) }}
                        className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-full bg-white/90 border border-[#E8E4DF] flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[#1A1A1A] hover:text-white"
                        aria-label="Archive"
                        title="Archive (remove, keep recoverable)"
                      ><X className="w-3 h-3" /></button>
                    )}

                    <div className="aspect-square flex items-center justify-center p-2 overflow-hidden">
                      {item.image ? (
                        <img src={item.image} alt={item.name} className="max-w-full max-h-full object-contain" loading="lazy" />
                      ) : (
                        <Tag className="w-6 h-6 text-[#E8E4DF]" />
                      )}
                    </div>
                    <div className="px-2.5 pb-2.5">
                      <p className="text-[11px] text-[#1A1A1A] truncate">{item.name}</p>
                      <div className="flex flex-wrap gap-1 mt-1 min-h-[16px]">
                        {item.categoryIds.length === 0
                          ? <span className="text-[9px] text-[#bbb] tracking-[0.1em] uppercase">uncategorized</span>
                          : item.categoryIds.map((cid) => (
                              <span key={cid} className="text-[9px] px-1.5 py-0.5 rounded bg-[#F8E5E7]/60 text-[#1A1A1A] capitalize">{labelOf(cid)}</span>
                            ))}
                      </div>
                      {/* actions */}
                      {item.archived ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); restoreItem(item.id) }}
                          className="mt-2 w-full py-1.5 text-[10px] tracking-[0.08em] uppercase rounded bg-[#1A1A1A] text-white hover:opacity-80"
                        >Restore to queue</button>
                      ) : (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); setItemPublished(item.id, !item.published) }}
                            className={`mt-2 w-full flex items-center justify-center gap-1 py-1.5 text-[10px] tracking-[0.08em] uppercase rounded transition-colors ${
                              item.published
                                ? 'border border-[#E8E4DF] text-[#888] hover:text-[#1A1A1A]'
                                : 'bg-[#1A1A1A] text-white hover:opacity-80'
                            }`}
                          >
                            {item.published ? 'Remove from lookbook' : <><Send className="w-3 h-3" /> Add to lookbook</>}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); shareToChat(item.id) }}
                            className="mt-1 w-full py-1 text-[9px] tracking-[0.12em] uppercase text-[#888] hover:text-[#1A1A1A] transition-colors"
                            title="Send this to the client's chat"
                          >Share to chat</button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
