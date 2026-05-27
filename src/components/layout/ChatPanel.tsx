import { useState, useCallback, useRef, useEffect } from 'react'
import { Send, Save, FilePlus, Loader2, Check, ChevronRight } from 'lucide-react'
import { useCanvasStore } from '@/stores/canvasStore'
import { useClientStore } from '@/stores/clientStore'
import { useAuth } from '@/hooks/useAuth'
import { useLooks } from '@/hooks/useLooks'
import { supabase } from '@/lib/supabase'
import { LookGallery } from '@/components/canvas/LookGallery'
import { SaveLookDialog } from '@/components/canvas/SaveLookDialog'
import {
  runComposePipeline,
  resolveDisambiguation,
  allResolved,
  pickLayout,
  composeNodes,
  type ComposeMessage,
  type ResolvedItem,
  type CompositionPlan,
} from '@/lib/compose'
import type { ClosetItem } from '@/lib/images'
import type { LookCanvasState, ClosetItemNode } from '@/types/canvas'
import type { LookRow } from '@/hooks/useLooks'

type Tab = 'looks' | 'compose'

export function ChatPanel() {
  const [tab, setTab] = useState<Tab>('looks')
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saving, setSaving] = useState(false)
  const { user } = useAuth()
  const { activeClient } = useClientStore()
  const { state, currentLookId, isDirty, loadLook, reset, markClean, addNode } = useCanvasStore()
  const { looks, loading, saveLook, deleteLook } = useLooks(activeClient?.id ?? null)

  // Compose state
  const [messages, setMessages] = useState<ComposeMessage[]>([])
  const [input, setInput] = useState('')
  const [composing, setComposing] = useState(false)
  const [pendingItems, setPendingItems] = useState<ResolvedItem[] | null>(null)
  const [pendingPlan, setPendingPlan] = useState<CompositionPlan | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const currentLook = looks.find((l) => l.id === currentLookId) ?? null

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSave = useCallback(async (data: { name: string; notes: string; tags: string[] }) => {
    if (!activeClient) return
    setSaving(true)

    let thumbnailUrl: string | undefined
    const konvaContainer = document.querySelector('.konvajs-content canvas') as HTMLCanvasElement | null
    if (konvaContainer) {
      try {
        thumbnailUrl = konvaContainer.toDataURL('image/jpeg', 0.7)
      } catch {}
    }

    const { data: sessionData } = await supabase.auth.getSession()
    const authUserId = sessionData?.session?.user?.id ?? null

    await saveLook({
      id: currentLookId ?? undefined,
      clientId: activeClient.id,
      name: data.name,
      canvasState: state,
      tags: data.tags,
      notesInternal: data.notes,
      thumbnailUrl,
      createdBy: authUserId ?? undefined,
    })

    markClean()
    setSaving(false)
    setShowSaveDialog(false)
  }, [activeClient, currentLookId, state, saveLook, markClean, user])

  const handleSelectLook = useCallback(async (look: LookRow) => {
    if (isDirty && !confirm('You have unsaved changes. Discard and load this look?')) return

    const canvasState = look.canvas_state as LookCanvasState | null
    if (!canvasState) return

    const closetNodes = canvasState.nodes.filter((n): n is ClosetItemNode => n.type === 'closet_item')
    const closetItemIds = closetNodes.map((n) => n.closet_item_id)

    const newImageUrls: Record<string, string> = {}

    if (closetItemIds.length > 0) {
      const { data: items } = await supabase
        .from('closet_items')
        .select('id, raw')
        .in('id', closetItemIds)

      if (items) {
        const urlMap = new Map<string, string>()
        for (const item of items as Pick<ClosetItem, 'id' | 'raw'>[]) {
          const url = item.raw?.processed_image ?? item.raw?.image ?? item.raw?.images?.[0] ?? null
          if (url) urlMap.set(item.id, url)
        }
        for (const node of closetNodes) {
          const url = urlMap.get(node.closet_item_id)
          if (url) newImageUrls[node.id] = url
        }
      }
    }

    loadLook(look.id, canvasState, newImageUrls)
  }, [isDirty, loadLook])

  const handleNewLook = useCallback(() => {
    if (isDirty && !confirm('You have unsaved changes. Start a new look?')) return
    reset()
  }, [isDirty, reset])

  // ── Compose handlers ──────────────────────────────────────────────

  const handleCompose = useCallback(async () => {
    if (!input.trim() || !activeClient || composing) return

    const userMsg: ComposeMessage = { role: 'user', content: input.trim() }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setComposing(true)

    try {
      const result = await runComposePipeline(
        userMsg.content,
        activeClient.id,
        messages
      )

      if (result.needsDisambiguation) {
        setPendingItems(result.resolvedItems)
        setPendingPlan(result.plan)
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: result.summary,
            resolvedItems: result.resolvedItems,
            awaitingDisambiguation: true,
          },
        ])
      } else if (result.composed) {
        // Place items on canvas
        await placeOnCanvas(result.composed.nodes, result.resolvedItems)
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: result.summary },
        ])
        setPendingItems(null)
        setPendingPlan(null)
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'No matching items found. Try a different description.' },
        ])
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${err.message}` },
      ])
    } finally {
      setComposing(false)
    }
  }, [input, activeClient, composing, messages])

  const handleDisambiguate = useCallback(
    async (itemIndex: number, candidateIndex: number) => {
      if (!pendingItems || !pendingPlan) return

      const updated = resolveDisambiguation(pendingItems, itemIndex, candidateIndex)
      setPendingItems(updated)

      // Update the last message with the selection
      const selectedName = updated[itemIndex].selected?.name ?? ''
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: `Pick #${candidateIndex + 1} for "${updated[itemIndex].extraction.description}" → ${selectedName}` },
      ])

      if (allResolved(updated)) {
        setComposing(true)
        try {
          const layoutName = pickLayout(pendingPlan.items, pendingPlan.layout)
          const composed = composeNodes(updated, layoutName)
          await placeOnCanvas(composed.nodes, updated)

          const placed = updated.filter((r) => r.selected).length
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `All items resolved! Placed ${placed} items on canvas.` },
          ])
          setPendingItems(null)
          setPendingPlan(null)
        } catch (err: any) {
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `Error composing: ${err.message}` },
          ])
        } finally {
          setComposing(false)
        }
      }
    },
    [pendingItems, pendingPlan]
  )

  async function placeOnCanvas(
    nodes: import('@/types/canvas').CanvasNode[],
    _resolvedItems: ResolvedItem[]
  ) {
    // Fetch image URLs for placed closet items
    const closetItemIds = nodes
      .filter((n): n is ClosetItemNode => n.type === 'closet_item')
      .map((n) => n.closet_item_id)

    let imageUrlMap = new Map<string, string>()
    if (closetItemIds.length > 0) {
      const { data: items } = await supabase
        .from('closet_items')
        .select('id, raw')
        .in('id', closetItemIds)

      if (items) {
        for (const item of items as Pick<ClosetItem, 'id' | 'raw'>[]) {
          const url = item.raw?.processed_image ?? item.raw?.image ?? item.raw?.images?.[0] ?? null
          if (url) imageUrlMap.set(item.id, url)
        }
      }
    }

    // Add each node to canvas
    for (const node of nodes) {
      if (node.type === 'closet_item') {
        const url = imageUrlMap.get((node as ClosetItemNode).closet_item_id)
        addNode(node, url)
      } else {
        addNode(node)
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleCompose()
    }
  }

  return (
    <>
      <aside className="w-72 border-l border-border bg-white flex flex-col h-full">
        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setTab('looks')}
            className={`flex-1 py-2.5 text-[10px] tracking-[0.35em] uppercase text-center transition-colors ${
              tab === 'looks' ? 'text-text border-b-2 border-[#1A1A1A]' : 'text-text-muted/60 hover:text-text-muted'
            }`}
          >
            Looks
          </button>
          <button
            onClick={() => setTab('compose')}
            className={`flex-1 py-2.5 text-[10px] tracking-[0.35em] uppercase text-center transition-colors ${
              tab === 'compose' ? 'text-text border-b-2 border-[#1A1A1A]' : 'text-text-muted/60 hover:text-text-muted'
            }`}
          >
            Compose
          </button>
        </div>

        {/* Save bar */}
        {activeClient && (
          <div className="px-3 py-2 border-b border-border flex items-center gap-2">
            <button
              onClick={() => setShowSaveDialog(true)}
              disabled={state.nodes.length === 0}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-[#1A1A1A] text-white text-[10px] tracking-[0.2em] uppercase rounded-sm hover:bg-[#333] transition-colors disabled:opacity-30"
            >
              <Save className="h-3 w-3" />
              {currentLookId ? 'Update Look' : 'Save Look'}
            </button>
            <button
              onClick={handleNewLook}
              className="p-1.5 border border-border rounded-sm hover:bg-tile transition-colors"
              title="New look"
            >
              <FilePlus className="h-3.5 w-3.5 text-text-muted" />
            </button>
          </div>
        )}

        {/* Current look info */}
        {currentLook && (
          <div className="px-3 py-2 border-b border-border bg-tile/50">
            <p className="text-[10px] tracking-[0.2em] uppercase text-text-muted/60">Editing</p>
            <p className="text-[11px] font-medium text-text truncate">{currentLook.name}</p>
            {isDirty && (
              <p className="text-[9px] text-blush mt-0.5">Unsaved changes</p>
            )}
          </div>
        )}

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'looks' && activeClient && (
            <LookGallery
              looks={looks}
              loading={loading}
              currentLookId={currentLookId}
              onSelect={handleSelectLook}
              onDelete={(id) => deleteLook(id)}
              onNew={handleNewLook}
            />
          )}
          {tab === 'looks' && !activeClient && (
            <div className="flex items-center justify-center h-full p-4">
              <p className="text-[10px] tracking-[0.3em] uppercase text-text-muted/30 text-center">
                Select a client to view looks
              </p>
            </div>
          )}

          {/* Compose conversation */}
          {tab === 'compose' && (
            <div className="p-3 space-y-3">
              {messages.length === 0 && (
                <p className="text-[11px] leading-relaxed text-text-muted/50">
                  Describe a look and I'll compose it on canvas. Try something like:
                </p>
              )}
              {messages.length === 0 && (
                <div className="space-y-1.5">
                  {[
                    'White silk Dior blouse with dark wash jeans and black Louboutin pumps',
                    'Casual brunch: linen top, wide leg pants, espadrilles',
                    'Date night look with a Khaite bodycon dress and gold accessories',
                  ].map((example) => (
                    <button
                      key={example}
                      onClick={() => { setInput(example); }}
                      className="block w-full text-left px-2.5 py-2 bg-tile/50 rounded-sm text-[10px] leading-relaxed text-text-muted hover:bg-tile transition-colors"
                    >
                      "{example}"
                    </button>
                  ))}
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`${msg.role === 'user' ? 'text-right' : ''}`}>
                  <div
                    className={`inline-block max-w-[95%] px-3 py-2 rounded-lg text-[11px] leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-[#1A1A1A] text-white'
                        : 'bg-tile text-text'
                    }`}
                  >
                    {msg.content.split('\n').map((line, j) => (
                      <p key={j} className={j > 0 ? 'mt-1' : ''}>
                        {line.replace(/\*\*(.*?)\*\*/g, '$1')}
                      </p>
                    ))}
                  </div>

                  {/* Disambiguation cards */}
                  {msg.awaitingDisambiguation && pendingItems && (
                    <div className="mt-2 space-y-2">
                      {pendingItems.map((item, itemIdx) =>
                        item.needsDisambiguation ? (
                          <div key={itemIdx} className="bg-white border border-border rounded-sm p-2">
                            <p className="text-[10px] font-medium text-text mb-1.5">
                              {item.extraction.description}
                            </p>
                            {item.candidates.slice(0, 3).map((c, cIdx) => (
                              <button
                                key={c.id}
                                onClick={() => handleDisambiguate(itemIdx, cIdx)}
                                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-tile/80 transition-colors text-left"
                              >
                                <span className="w-5 h-5 rounded-full bg-tile flex items-center justify-center text-[9px] font-medium text-text-muted flex-shrink-0">
                                  {cIdx + 1}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[10px] text-text truncate">{c.name}</p>
                                  <p className="text-[9px] text-text-muted">{c.brand || 'no brand'} · {(c.similarity * 100).toFixed(0)}%</p>
                                </div>
                                <ChevronRight className="h-3 w-3 text-text-muted/40 flex-shrink-0" />
                              </button>
                            ))}
                          </div>
                        ) : item.selected ? (
                          <div key={itemIdx} className="flex items-center gap-2 px-2 py-1.5 bg-tile/30 rounded-sm">
                            <Check className="h-3 w-3 text-green-600 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] text-text truncate">{item.selected.name}</p>
                              <p className="text-[9px] text-text-muted">{item.extraction.description}</p>
                            </div>
                          </div>
                        ) : null
                      )}
                    </div>
                  )}
                </div>
              ))}

              {composing && (
                <div className="flex items-center gap-2 text-text-muted/60">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="text-[10px] tracking-[0.15em]">Composing...</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Compose input — always visible when on compose tab */}
        {tab === 'compose' && (
          <div className="p-3 border-t border-border">
            {!activeClient ? (
              <p className="text-[10px] tracking-[0.2em] uppercase text-text-muted/40 text-center py-2">
                Select a client first
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Describe a look..."
                  rows={3}
                  className="w-full bg-tile rounded-sm px-3 py-2 text-[11px] tracking-[0.05em] placeholder:text-text-muted/40 focus:outline-none focus:ring-1 focus:ring-blush resize-none"
                />
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={handleCompose}
                  className="self-end flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[#1A1A1A] text-white text-[10px] tracking-[0.15em] uppercase hover:bg-[#333] transition-colors cursor-pointer"
                >
                  <Send className="h-3 w-3" />
                  Compose
                </button>
              </div>
            )}
          </div>
        )}
      </aside>

      {showSaveDialog && (
        <SaveLookDialog
          initialName={currentLook?.name ?? ''}
          initialNotes={currentLook?.notes_internal ?? ''}
          initialTags={currentLook?.tags ?? []}
          saving={saving}
          onSave={handleSave}
          onClose={() => setShowSaveDialog(false)}
        />
      )}
    </>
  )
}
