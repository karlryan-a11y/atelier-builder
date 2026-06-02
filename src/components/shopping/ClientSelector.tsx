import { useState, useMemo } from 'react'
import { Search, Plus, User, Loader2 } from 'lucide-react'
import { useClients } from '@/hooks/useClients'
import { useShoppingStore } from '@/stores/shoppingStore'
import { loadClientData } from '@/lib/client-data'

export function ClientSelector() {
  const { clients, loading } = useClients()
  const {
    session,
    setProfile,
    profileLoading,
    profileExists,
    setProfileLoading,
    hydrateClientData,
    clearClientData,
  } = useShoppingStore()
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (!search.trim()) return clients.slice(0, 20)
    const q = search.toLowerCase()
    return clients.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 20)
  }, [clients, search])

  async function selectExisting(id: string, name: string) {
    setLoadError(null)
    setProfile({ client_id: id, client_name: name, is_new_client: false })
    setProfileLoading(true)
    try {
      const bundle = await loadClientData(id)
      hydrateClientData(bundle)
    } catch (e) {
      setProfileLoading(false)
      setLoadError(e instanceof Error ? e.message : 'Failed to load client data')
    }
  }

  function changeClient() {
    clearClientData()
    setProfile({ client_id: '', client_name: '', is_new_client: false })
  }

  if (session.profile.client_id) {
    return (
      <div className="flex items-center gap-3 p-4 bg-tile rounded-sm">
        <div className="w-10 h-10 rounded-full bg-blush/30 flex items-center justify-center">
          {profileLoading ? (
            <Loader2 className="h-4 w-4 text-text/50 animate-spin" />
          ) : (
            <User className="h-4 w-4 text-text/50" />
          )}
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-text">{session.profile.client_name}</p>
          <p className="text-[10px] tracking-[0.2em] uppercase text-text-muted">
            {session.profile.is_new_client
              ? 'New client'
              : profileLoading
              ? 'Loading profile…'
              : profileExists
              ? 'Existing client · profile loaded'
              : 'Existing client · no profile yet'}
          </p>
          {loadError && (
            <p className="mt-0.5 text-[10px] text-red-600">{loadError}</p>
          )}
        </div>
        <button
          onClick={changeClient}
          className="text-[10px] tracking-[0.15em] uppercase text-text-muted hover:text-text transition-colors"
        >
          Change
        </button>
      </div>
    )
  }

  if (showNew) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Client name"
            autoFocus
            className="flex-1 bg-transparent border-0 border-b border-wsg-border text-sm pb-2 focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/50"
          />
          <button
            onClick={() => {
              if (newName.trim()) {
                setProfile({
                  client_id: `new_${Date.now()}`,
                  client_name: newName.trim(),
                  is_new_client: true,
                })
              }
            }}
            disabled={!newName.trim()}
            className="px-3 py-1.5 bg-text text-white text-[10px] tracking-[0.15em] uppercase disabled:opacity-30"
          >
            Add
          </button>
        </div>
        <button
          onClick={() => setShowNew(false)}
          className="text-[10px] tracking-[0.15em] uppercase text-text-muted hover:text-text"
        >
          Back to search
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-0 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted/50" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients..."
          className="w-full bg-transparent border-0 border-b border-wsg-border text-sm pb-2 pl-6 focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/50"
        />
      </div>

      {loading ? (
        <div className="py-4 text-center text-[10px] tracking-[0.2em] uppercase text-text-muted">
          Loading clients...
        </div>
      ) : (
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {filtered.map((client) => (
            <button
              key={client.id}
              onClick={() => selectExisting(client.id, client.name)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-tile rounded-sm transition-colors text-text"
            >
              {client.name}
            </button>
          ))}
          {filtered.length === 0 && search && (
            <p className="py-3 text-center text-[11px] text-text-muted">No clients found</p>
          )}
        </div>
      )}

      <button
        onClick={() => setShowNew(true)}
        className="flex items-center gap-2 text-[10px] tracking-[0.15em] uppercase text-text-muted hover:text-text transition-colors"
      >
        <Plus className="h-3 w-3" />
        New client
      </button>
    </div>
  )
}
