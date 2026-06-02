// @ts-nocheck — shopping board persistence not yet finalized
import { useState, useMemo } from 'react'
import { Check, RotateCcw, ArrowLeftRight, Shirt, PackageCheck, AlertCircle } from 'lucide-react'
import { useBoardStore, type BoardOption } from '@/stores/boardStore'
import { useShoppingStore } from '@/stores/shoppingStore'
import { useAuth } from '@/hooks/useAuth'
import { ProductImage } from './ProductImage'
import { persistReviews, persistTryon, updateSessionMeta, recordKeptSizing } from '@/lib/shopping-persistence'
import { supabase } from '@/lib/supabase'

function getOrderSize(opt: BoardOption) {
  return opt.size_override || opt.recommended_size || '—'
}

function getOrderColor(opt: BoardOption) {
  return opt.color_override || opt.recommended_color || '—'
}

function TryOnCard({
  option,
  slotDescription,
  onKeep,
  onReturn,
  onExchange,
}: {
  option: BoardOption
  slotDescription: string
  onKeep: () => void
  onReturn: () => void
  onExchange: (notes: string) => void
}) {
  const [exchangeNotes, setExchangeNotes] = useState('')
  const [showExchange, setShowExchange] = useState(false)

  const statusConfig = {
    kept: { bg: 'bg-green-50/50', border: 'border-green-300', label: 'Kept', color: 'text-green-700' },
    returned: { bg: 'bg-red-50/30', border: 'border-red-200', label: 'Returned', color: 'text-red-600' },
    exchanged: { bg: 'bg-amber-50/30', border: 'border-amber-200', label: 'Exchange', color: 'text-amber-700' },
    pending: { bg: 'bg-white', border: 'border-wsg-border', label: '', color: '' },
  }

  const status = option.tryon_status ?? 'pending'
  const config = statusConfig[status]
  const isDecided = status !== 'pending'

  return (
    <div className={`border rounded-sm overflow-hidden transition-all ${config.border} ${config.bg}`}>
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="relative w-12 h-16 shrink-0 rounded-sm overflow-hidden">
            <ProductImage src={option.image_url} alt={option.product_name} brand={option.brand} compact />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] tracking-[0.15em] uppercase text-text-muted/60 mb-0.5">
              {slotDescription}
            </p>
            <p className="text-[11px] font-medium text-text uppercase tracking-[0.1em]">
              {option.brand || 'Unknown'}
            </p>
            <p className="text-[11px] text-text-muted truncate">{option.product_name}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-medium text-text">
              {option.price ? `$${option.price}` : '—'}
            </p>
            {isDecided && (
              <span className={`text-[9px] tracking-[0.1em] uppercase font-medium ${config.color}`}>
                {config.label}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted">
          <span>Size: <strong className="text-text">{getOrderSize(option)}</strong></span>
          <span>Color: <strong className="text-text">{getOrderColor(option)}</strong></span>
        </div>

        {option.closet_item_id && (
          <div className="flex items-center gap-1.5 text-[10px] text-green-600">
            <PackageCheck className="h-3 w-3" />
            <span className="tracking-[0.1em] uppercase">Added to closet</span>
          </div>
        )}

        {option.tryon_status === 'exchanged' && option.exchange_notes && (
          <p className="text-[10px] text-amber-700 italic">
            Exchange: {option.exchange_notes}
          </p>
        )}

        {!isDecided && (
          <div className="flex gap-1.5 pt-1">
            <button
              onClick={onKeep}
              className="flex-1 flex items-center justify-center gap-1 py-2 bg-green-600 text-white text-[10px] tracking-[0.1em] uppercase rounded-sm hover:bg-green-700 transition-colors"
            >
              <Check className="h-3 w-3" />
              Keep
            </button>
            <button
              onClick={onReturn}
              className="flex-1 flex items-center justify-center gap-1 py-2 bg-white border border-wsg-border text-text text-[10px] tracking-[0.1em] uppercase rounded-sm hover:bg-tile transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Return
            </button>
            <button
              onClick={() => setShowExchange(!showExchange)}
              className="flex-1 flex items-center justify-center gap-1 py-2 bg-white border border-wsg-border text-text text-[10px] tracking-[0.1em] uppercase rounded-sm hover:bg-tile transition-colors"
            >
              <ArrowLeftRight className="h-3 w-3" />
              Exchange
            </button>
          </div>
        )}

        {showExchange && !isDecided && (
          <div className="pt-2 space-y-2 border-t border-wsg-border/50">
            <input
              type="text"
              value={exchangeNotes}
              onChange={(e) => setExchangeNotes(e.target.value)}
              placeholder="Different size, color swap..."
              className="w-full bg-transparent border-0 border-b border-wsg-border text-[11px] pb-1 focus:outline-none focus:border-text placeholder:text-text-muted/40"
            />
            <button
              onClick={() => {
                onExchange(exchangeNotes)
                setShowExchange(false)
              }}
              className="w-full py-1.5 bg-amber-500 text-white text-[10px] tracking-[0.1em] uppercase rounded-sm hover:bg-amber-600 transition-colors"
            >
              Confirm Exchange
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function TryOnView() {
  const { slots, setTryonStatus, markAddedToCloset } = useBoardStore()
  const { session, setStatus } = useShoppingStore()
  const { user } = useAuth()
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncDone, setSyncDone] = useState(false)

  // Persist the moat signal — review decisions + try-on outcomes. Best-effort:
  // never blocks the stylist's workflow. Idempotent (clears + rewrites).
  async function persistOutcomes(markComplete: boolean) {
    const sid = useShoppingStore.getState().session.id
    if (!sid) return
    const boardSlots = useBoardStore.getState().slots
    const clientId = useShoppingStore.getState().session.profile.client_id
    try {
      await persistReviews(sid, boardSlots, user?.id ?? null)
      await persistTryon(sid, boardSlots, user?.id ?? null)
      // Learning loop: kept items become proven brand sizes for this client
      await recordKeptSizing(clientId, boardSlots)
      if (markComplete) {
        await updateSessionMeta(sid, { status: 'complete', completed_at: new Date().toISOString() })
      }
    } catch {
      // non-blocking — outcome capture is best-effort
    }
  }

  const approvedItems = useMemo(() => {
    const items: { option: BoardOption; slotDescription: string }[] = []
    for (const slot of slots) {
      for (const opt of slot.options) {
        if (opt.status === 'approved') {
          items.push({ option: opt, slotDescription: slot.description })
        }
      }
    }
    return items
  }, [slots])

  const keptItems = approvedItems.filter(({ option }) => option.tryon_status === 'kept')
  const returnedItems = approvedItems.filter(({ option }) => option.tryon_status === 'returned')
  const exchangedItems = approvedItems.filter(({ option }) => option.tryon_status === 'exchanged')
  const pendingItems = approvedItems.filter(({ option }) => !option.tryon_status)
  const allDecided = pendingItems.length === 0 && approvedItems.length > 0

  const keptTotal = keptItems.reduce((sum, { option }) => {
    const p = parseFloat(option.price)
    return sum + (isNaN(p) ? 0 : p)
  }, 0)

  async function handleAddToCloset() {
    if (!session.profile.client_id || keptItems.length === 0) return

    setSyncing(true)
    setSyncError(null)

    const itemsToAdd = keptItems.filter(({ option }) => !option.closet_item_id)

    for (const { option, slotDescription } of itemsToAdd) {
      const { data, error } = await supabase
        .from('closet_items')
        .insert({
          client_id: session.profile.client_id,
          name: `${option.brand} ${option.product_name}`.trim() || slotDescription,
          brand: option.brand || '',
          content_tag_ids: [],
          is_deleted: false,
          raw: {
            description: slotDescription,
            shopping_source: 'cowork',
            retailer: option.retailer,
            price: option.price,
            url: option.url,
            image_url: option.image_url,
            size: option.size_override || option.recommended_size,
            color: option.color_override || option.recommended_color,
          },
          primary_image_hash: null,
          processed_image_hash: null,
        })
        .select('id')
        .single()

      if (error) {
        setSyncError(`Failed to add "${option.product_name}": ${error.message}`)
        setSyncing(false)
        return
      }

      if (data) {
        markAddedToCloset(option.id, data.id)
      }
    }

    setSyncing(false)
    setSyncDone(true)
    // Capture review + try-on outcomes now that closet links exist
    await persistOutcomes(false)
  }

  async function handleComplete() {
    await persistOutcomes(true)
    setStatus('complete')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Shirt className="h-4 w-4 text-text-muted/50" />
            <span className="text-[11px] tracking-[0.2em] uppercase text-text font-medium">
              Try-On Session
            </span>
          </div>
          <p className="text-[10px] text-text-muted mt-0.5">
            {pendingItems.length > 0
              ? `${pendingItems.length} items awaiting decision`
              : `${keptItems.length} kept, ${returnedItems.length} returned, ${exchangedItems.length} exchanged`}
          </p>
        </div>
      </div>

      {/* Summary bar when all decided */}
      {allDecided && (
        <div className="grid grid-cols-3 gap-3">
          <div className="px-4 py-3 border border-green-200 bg-green-50/30 rounded-sm text-center">
            <p className="text-lg font-serif text-green-700">{keptItems.length}</p>
            <p className="text-[9px] tracking-[0.15em] uppercase text-green-600">Kept</p>
          </div>
          <div className="px-4 py-3 border border-wsg-border bg-white rounded-sm text-center">
            <p className="text-lg font-serif text-text-muted">{returnedItems.length}</p>
            <p className="text-[9px] tracking-[0.15em] uppercase text-text-muted">Returned</p>
          </div>
          <div className="px-4 py-3 border border-amber-200 bg-amber-50/30 rounded-sm text-center">
            <p className="text-lg font-serif text-amber-700">{exchangedItems.length}</p>
            <p className="text-[9px] tracking-[0.15em] uppercase text-amber-600">Exchanged</p>
          </div>
        </div>
      )}

      {/* Item cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {approvedItems.map(({ option, slotDescription }) => (
          <TryOnCard
            key={option.id}
            option={option}
            slotDescription={slotDescription}
            onKeep={() => setTryonStatus(option.id, 'kept')}
            onReturn={() => setTryonStatus(option.id, 'returned')}
            onExchange={(notes) => setTryonStatus(option.id, 'exchanged', notes)}
          />
        ))}
      </div>

      {/* Add to closet + complete */}
      {allDecided && keptItems.length > 0 && (
        <div className="space-y-3">
          {syncError && (
            <div className="flex items-center gap-2 p-3 border border-red-200 bg-red-50/30 rounded-sm">
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
              <p className="text-[11px] text-red-600">{syncError}</p>
            </div>
          )}

          {!syncDone ? (
            <button
              onClick={handleAddToCloset}
              disabled={syncing}
              className="w-full py-4 bg-green-600 text-white text-[11px] tracking-[0.25em] uppercase rounded-sm hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              {syncing
                ? 'Adding to Closet...'
                : `Add ${keptItems.length} Kept Items to Closet ($${keptTotal.toFixed(2)})`}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2 py-4 border border-green-200 bg-green-50/30 rounded-sm">
                <PackageCheck className="h-4 w-4 text-green-600" />
                <span className="text-[11px] tracking-[0.2em] uppercase text-green-600">
                  {keptItems.length} items added to {session.profile.client_name}'s closet
                </span>
              </div>
              <button
                onClick={handleComplete}
                className="w-full py-4 bg-text text-white text-[11px] tracking-[0.25em] uppercase rounded-sm hover:bg-text/90 transition-colors"
              >
                Complete Shopping Session
              </button>
            </div>
          )}
        </div>
      )}

      {allDecided && keptItems.length === 0 && (
        <button
          onClick={handleComplete}
          className="w-full py-4 bg-text text-white text-[11px] tracking-[0.25em] uppercase rounded-sm hover:bg-text/90 transition-colors"
        >
          Complete Shopping Session — No Items Kept
        </button>
      )}
    </div>
  )
}
