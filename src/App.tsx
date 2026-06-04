import { useState, useCallback, useEffect } from 'react'
import { DndContext, type DragEndEvent, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useAuth } from '@/hooks/useAuth'
import { LoginPage } from '@/components/auth/LoginPage'
import { Header } from '@/components/layout/Header'
import { ClosetPanel } from '@/components/layout/ClosetPanel'
import { LookCanvas } from '@/components/canvas/LookCanvas'
import { ChatPanel } from '@/components/layout/ChatPanel'
import { AdminPanel } from '@/components/admin/AdminPanel'
import { SearchDebug } from '@/components/admin/SearchDebug'
import { IntakeInbox } from '@/components/intake/IntakeInbox'
import { ShopView } from '@/components/shopping/ShopView'
import { useCanvasStore } from '@/stores/canvasStore'
import { useViewStore } from '@/stores/viewStore'
import { resumeSession } from '@/lib/shopping-resume'
import type { ClosetItemNode } from '@/types/canvas'

function App() {
  const { user, loading, signOut } = useAuth()
  const [showAdmin, setShowAdmin] = useState(false)
  const [showInbox, setShowInbox] = useState(() => ['#inbox', '#digitize'].includes(window.location.hash))
  const [showSearch, setShowSearch] = useState(() => window.location.hash === '#search')
  const { addNode, state } = useCanvasStore()
  const activeView = useViewStore((s) => s.activeView)
  const setActiveView = useViewStore((s) => s.setActiveView)

  // Handle hash-based routing for platform nav tabs
  useEffect(() => {
    const hash = window.location.hash
    if (hash === '#shop') setActiveView('shop')
    if (hash === '#digitize' || hash === '#inbox') setShowInbox(true)
  }, [setActiveView])

  useEffect(() => {
    const onHash = () => {
      setShowSearch(window.location.hash === '#search')
      setShowInbox(['#inbox', '#digitize'].includes(window.location.hash))
      if (window.location.hash === '#shop') setActiveView('shop')
      const m = window.location.hash.match(/#session=([0-9a-fA-F-]{36})/)
      if (m) resumeSession(m[1])
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [setActiveView])

  // Deep link: #session=<id> reopens that shopping session once the user is in.
  useEffect(() => {
    if (!user) return
    const m = window.location.hash.match(/#session=([0-9a-fA-F-]{36})/)
    if (m) resumeSession(m[1])
  }, [user])
  const [dragImage, setDragImage] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  )

  const handleDragStart = useCallback((event: { active: { data: { current?: { imageUrl?: string } } } }) => {
    setDragImage(event.active.data.current?.imageUrl ?? null)
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragImage(null)
      const { active, over } = event
      if (!over || over.id !== 'canvas-drop-target') return

      const data = active.data.current as { type?: string; closetItemId?: string; imageUrl?: string } | undefined
      if (data?.type !== 'closet_item' || !data.closetItemId) return

      const node: ClosetItemNode = {
        id: `ci_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'closet_item',
        closet_item_id: data.closetItemId,
        x: 300 + Math.random() * 200,
        y: 400 + Math.random() * 200,
        scale: 1,
        rotation: 0,
        flipped: false,
        z_index: state.nodes.length,
        locked: false,
      }

      addNode(node, data.imageUrl ?? undefined)
    },
    [addNode, state.nodes.length]
  )

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
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="h-screen flex flex-col overflow-hidden">
        <Header
          user={user}
          onSignOut={signOut}
          onOpenAdmin={user.role === 'admin' ? () => setShowAdmin(true) : undefined}
          onOpenInbox={() => setShowInbox(true)}
        />
        {activeView === 'style' ? (
          <div className="flex flex-1 overflow-hidden">
            <ClosetPanel />
            <LookCanvas />
            <ChatPanel />
          </div>
        ) : (
          <ShopView />
        )}
        {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
        {showInbox && <IntakeInbox onClose={() => { setShowInbox(false); window.location.hash = '' }} />}
        {showSearch && (
          <div className="fixed inset-0 bg-white z-50 overflow-auto">
            <div className="flex justify-between items-center p-4 border-b border-[#E8E4DF]">
              <h1 className="text-sm tracking-[0.2em] uppercase text-[#1A1A1A]">Search Debug</h1>
              <button
                onClick={() => { window.location.hash = ''; setShowSearch(false) }}
                className="text-sm text-[#888] hover:text-[#1A1A1A]"
              >
                Close
              </button>
            </div>
            <SearchDebug />
          </div>
        )}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragImage ? (
          <div className="w-24 h-32 rounded-sm overflow-hidden shadow-lg opacity-80 pointer-events-none">
            <img src={dragImage} alt="" className="w-full h-full object-cover" />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

export default App
