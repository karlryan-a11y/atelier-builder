import { useState, useCallback, useEffect } from 'react'
import { DndContext, type DragEndEvent, DragOverlay, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useAuth } from '@/hooks/useAuth'
import { LoginPage } from '@/components/auth/LoginPage'
import { Header } from '@/components/layout/Header'
import { ClosetPanel } from '@/components/layout/ClosetPanel'
import { ClientBar } from '@/components/layout/ClientBar'
import { LookCanvas } from '@/components/canvas/LookCanvas'
import { LookItemsPanel } from '@/components/canvas/LookItemsPanel'
import { ChatPanel } from '@/components/layout/ChatPanel'
import { AdminPanel } from '@/components/admin/AdminPanel'
import { SearchDebug } from '@/components/admin/SearchDebug'
import { IntakeInbox } from '@/components/intake/IntakeInbox'
import { ShopView } from '@/components/shopping/ShopView'
import { CategorizePanel } from '@/components/categorize/CategorizePanel'
import { FeedbackButton } from '@/components/feedback/FeedbackButton'
import { useCanvasStore } from '@/stores/canvasStore'
import { useViewStore } from '@/stores/viewStore'
import { useClientStore } from '@/stores/clientStore'
import { useDraftCount } from '@/hooks/useLookCategories'
import { resumeSession } from '@/lib/shopping-resume'
import type { ClosetItemNode } from '@/types/canvas'

function App() {
  const { user, loading, signOut } = useAuth()
  const [showAdmin, setShowAdmin] = useState(false)
  const [showSearch, setShowSearch] = useState(() => window.location.hash === '#search')
  const styleTab = useViewStore((s) => s.styleTab)
  const setStyleTab = useViewStore((s) => s.setStyleTab)
  const activeClient = useClientStore((s) => s.activeClient)
  const draftCount = useDraftCount(activeClient?.id ?? null, styleTab)
  const { addNode, state } = useCanvasStore()
  const activeView = useViewStore((s) => s.activeView)
  const setActiveView = useViewStore((s) => s.setActiveView)

  // Dismiss the "Watson W" preloader (index.html) only once auth has resolved — so the W
  // shows continuously through the auth check, never the app's loading screen or a login flash.
  useEffect(() => {
    if (!loading) document.getElementById('atelier-preloader')?.classList.add('is-done')
  }, [loading])

  // Handle hash-based routing for platform nav tabs
  useEffect(() => {
    const hash = window.location.hash
    if (hash === '#shop') setActiveView('shop')
    if (hash === '#digitize' || hash === '#inbox') setActiveView('digitize')
  }, [setActiveView])

  useEffect(() => {
    const onHash = () => {
      setShowSearch(window.location.hash === '#search')
      if (window.location.hash === '#shop') setActiveView('shop')
      if (['#inbox', '#digitize'].includes(window.location.hash)) setActiveView('digitize')
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

      const off = (state.nodes.length % 6) * 30
      const node: ClosetItemNode = {
        id: `ci_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'closet_item',
        closet_item_id: data.closetItemId,
        x: Math.round(state.canvas.width / 2 - 140 + off),
        y: Math.round(state.canvas.height / 2 - 190 + off),
        scale: 1,
        target_height: 340,
        rotation: 0,
        flipped: false,
        z_index: state.nodes.length,
        locked: false,
      }

      addNode(node, data.imageUrl ?? undefined)
    },
    [addNode, state.nodes.length, state.canvas.width, state.canvas.height]
  )

  // While auth is resolving, render nothing — the "Watson W" preloader (index.html) stays
  // on top. We dismiss it only once `loading` is false, so the W shows continuously through
  // the auth check instead of flashing the app's loading screen or the login page.
  if (loading) return null
  if (!user) return <LoginPage />
  // Defense-in-depth: this internal tool is staff-only. Clients aren't in the `users` table (so
  // `user` is already null for them), but guard the role explicitly too so a non-staff account can
  // never reach the styling UI. `stylist_scoped` is a single-client-scoped stylist (e.g. a hiring
  // candidate on a styling assessment): they use the same builder UI, but RLS limits every client
  // read/write to the clients assigned to them in client_assignments.
  if (!['admin', 'stylist', 'support', 'stylist_scoped'].includes(user.role)) return <LoginPage />

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="h-screen flex flex-col overflow-hidden">
        <Header
          user={user}
          onSignOut={signOut}
          onOpenAdmin={user.role === 'admin' ? () => setShowAdmin(true) : undefined}
        />
        {activeView === 'digitize' ? (
          <IntakeInbox />
        ) : activeView === 'style' ? (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Top bar: the ONE client selector (always visible) + the Style sub-tabs. */}
            <div className="flex items-center gap-3 px-6 h-11 bg-white border-b border-[#E8E4DF] flex-none">
              <ClientBar />
              <div className="w-px h-5 bg-[#E8E4DF]" />
              {(['canvas', 'categorize'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setStyleTab(t)}
                  className={`relative px-3 py-1.5 text-[12px] tracking-[0.18em] uppercase transition-colors ${
                    styleTab === t ? 'text-[#1A1A1A]' : 'text-[#888] hover:text-[#1A1A1A]'
                  }`}
                >
                  {t}
                  {t === 'categorize' && draftCount > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-[#F8E5E7] text-[#1A1A1A] text-[9px] font-medium align-middle">
                      {draftCount}
                    </span>
                  )}
                  {styleTab === t && (
                    <span className="absolute left-3 right-3 bottom-0 h-[1.5px] bg-[#1A1A1A]" />
                  )}
                </button>
              ))}
            </div>
            {styleTab === 'canvas' ? (
              <div className="flex flex-1 overflow-hidden">
                <ClosetPanel />
                <LookCanvas />
                <LookItemsPanel />
                <ChatPanel />
              </div>
            ) : (
              <CategorizePanel />
            )}
          </div>
        ) : (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Same client bar, same place — so Shop shows who you're working on too. */}
            <div className="flex items-center px-6 h-11 bg-white border-b border-[#E8E4DF] flex-none">
              <ClientBar />
            </div>
            <ShopView />
          </div>
        )}
        {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
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
      <FeedbackButton />
    </DndContext>
  )
}

export default App
