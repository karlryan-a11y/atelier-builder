import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { LoginPage } from '@/components/auth/LoginPage'
import { Header } from '@/components/layout/Header'
import { ClosetPanel } from '@/components/layout/ClosetPanel'
import { Canvas } from '@/components/layout/Canvas'
import { ChatPanel } from '@/components/layout/ChatPanel'
import { AdminPanel } from '@/components/admin/AdminPanel'

function App() {
  const { user, loading, signOut } = useAuth()
  const [showAdmin, setShowAdmin] = useState(false)

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#1A1A1A]">
        <div className="text-center">
          <img src="/brand/atelier-logo-inverse.svg" alt="Atelier" className="h-10 mx-auto mb-3" />
          <p className="text-[10px] tracking-[0.35em] uppercase text-white/30">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <LoginPage />
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header
        user={user}
        onSignOut={signOut}
        onOpenAdmin={user.role === 'admin' ? () => setShowAdmin(true) : undefined}
      />
      <div className="flex flex-1 overflow-hidden">
        <ClosetPanel />
        <Canvas />
        <ChatPanel />
      </div>
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
    </div>
  )
}

export default App
