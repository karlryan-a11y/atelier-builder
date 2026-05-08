import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { UserPlus, Shield, Users, X } from 'lucide-react'

interface AppUser {
  id: string
  email: string
  display_name: string
  role: string
}

interface Client {
  id: string
  name?: string
}

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const [users, setUsers] = useState<AppUser[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [assignments, setAssignments] = useState<Record<string, string[]>>({})
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState<'stylist' | 'admin' | 'support'>('stylist')
  const [inviting, setInviting] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const [usersRes, clientsRes, assignmentsRes] = await Promise.all([
      supabase.from('users').select('*').order('created_at'),
      supabase.from('clients').select('id, name').order('name'),
      supabase.from('client_assignments').select('user_id, client_id'),
    ])

    if (usersRes.data) setUsers(usersRes.data)
    if (clientsRes.data) setClients(clientsRes.data)
    if (assignmentsRes.data) {
      const map: Record<string, string[]> = {}
      for (const a of assignmentsRes.data) {
        if (!map[a.user_id]) map[a.user_id] = []
        map[a.user_id].push(a.client_id)
      }
      setAssignments(map)
    }
  }

  async function inviteUser(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    setMessage('')

    const { error } = await supabase.from('users').insert({
      email: newEmail.toLowerCase().trim(),
      display_name: newName.trim(),
      role: newRole,
    })

    if (error) {
      setMessage(`Error: ${error.message}`)
    } else {
      setMessage(`Added ${newEmail}`)
      setNewEmail('')
      setNewName('')
      await loadData()
    }
    setInviting(false)
  }

  async function toggleAssignment(userId: string, clientId: string) {
    const current = assignments[userId] || []
    if (current.includes(clientId)) {
      await supabase
        .from('client_assignments')
        .delete()
        .eq('user_id', userId)
        .eq('client_id', clientId)
    } else {
      await supabase
        .from('client_assignments')
        .insert({ user_id: userId, client_id: clientId })
    }
    await loadData()
  }

  async function updateRole(userId: string, role: string) {
    await supabase.from('users').update({ role }).eq('id', userId)
    await loadData()
  }

  if (user?.role !== 'admin') {
    return <div className="p-8 text-center text-muted-foreground">Admin access required.</div>
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-xl shadow-lg border border-border w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-wsg-gold" />
            <h2 className="text-lg font-semibold">Team Management</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Invite form */}
          <form onSubmit={inviteUser} className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1">Email</label>
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="stylist@watsonstylegroup.com"
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              />
            </div>
            <div className="w-36">
              <label className="block text-xs font-medium mb-1">Name</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Display name"
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              />
            </div>
            <div className="w-28">
              <label className="block text-xs font-medium mb-1">Role</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as 'stylist' | 'admin' | 'support')}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                <option value="stylist">Stylist</option>
                <option value="admin">Admin</option>
                <option value="support">Support</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={inviting}
              className="flex items-center gap-1 rounded-md bg-wsg-black text-wsg-white px-3 py-1.5 text-sm font-medium hover:bg-wsg-charcoal disabled:opacity-50"
            >
              <UserPlus className="h-4 w-4" />
              Add
            </button>
          </form>

          {message && (
            <p className={`text-sm ${message.startsWith('Error') ? 'text-destructive' : 'text-wsg-gold'}`}>
              {message}
            </p>
          )}

          {/* Users list */}
          <div>
            <h3 className="text-sm font-medium flex items-center gap-2 mb-3">
              <Users className="h-4 w-4" />
              Team ({users.length})
            </h3>
            <div className="space-y-3">
              {users.map((u) => (
                <div key={u.id} className="border border-border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="font-medium text-sm">{u.display_name}</span>
                      <span className="text-xs text-muted-foreground ml-2">{u.email}</span>
                    </div>
                    <select
                      value={u.role}
                      onChange={(e) => updateRole(u.id, e.target.value)}
                      className="text-xs rounded border border-input bg-background px-2 py-1"
                    >
                      <option value="admin">Admin</option>
                      <option value="stylist">Stylist</option>
                      <option value="support">Support</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {clients.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => toggleAssignment(u.id, c.id)}
                        className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                          (assignments[u.id] || []).includes(c.id)
                            ? 'bg-wsg-gold/20 border-wsg-gold text-wsg-black'
                            : 'border-border text-muted-foreground hover:border-wsg-gold/50'
                        }`}
                      >
                        {c.name || c.id}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
