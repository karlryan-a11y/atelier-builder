import { AlertTriangle, ShoppingCart, MessageSquare } from 'lucide-react'
import { useBoardStore } from '@/stores/boardStore'
import { OptionCard } from './OptionCard'
import { CartView } from './CartView'

export function ShoppingBoard() {
  const { slots, round, view, setView, advanceToRound2 } = useBoardStore()

  const activeSlots = slots.filter((s) => s.status !== 'rejected')
  const allReviewed = activeSlots.every((slot) =>
    slot.status !== 'pending' || slot.options.every((o) => o.status !== 'pending')
  )
  const hasSwaps = slots.some((s) => s.options.some((o) => o.status === 'swapped'))
  const approvedCount = slots.reduce(
    (sum, s) => sum + s.options.filter((o) => o.status === 'approved').length,
    0
  )
  const pendingCount = activeSlots.reduce(
    (sum, s) => sum + s.options.filter((o) => o.status === 'pending').length,
    0
  )

  return (
    <div className="space-y-6">
      {/* Board header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-xl text-text">
            Round {round}
          </h2>
          <p className="text-[11px] text-text-muted mt-0.5">
            {approvedCount} approved, {pendingCount} pending review
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* View toggles */}
          <div className="flex border border-wsg-border rounded-sm overflow-hidden">
            {(['slot', 'look', 'cart'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-[10px] tracking-[0.15em] uppercase transition-colors ${
                  view === v ? 'bg-text text-white' : 'bg-white text-text-muted hover:bg-tile'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Round 1 complete + has swaps = can advance */}
      {round === 1 && allReviewed && hasSwaps && (
        <div className="flex items-center gap-3 p-4 border border-wsg-border bg-blush/30 rounded-sm">
          <MessageSquare className="h-5 w-5 text-text-muted shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-text font-medium">Round 1 complete</p>
            <p className="text-[11px] text-text-muted mt-0.5">
              {slots.filter((s) => s.options.some((o) => o.status === 'swapped')).length} items
              need alternates. Generate a Round 2 prompt for Cowork with swap feedback.
            </p>
          </div>
          <button
            onClick={advanceToRound2}
            className="px-4 py-2 bg-text text-white text-[10px] tracking-[0.2em] uppercase rounded-sm hover:bg-text/90 transition-colors shrink-0"
          >
            Start Round 2
          </button>
        </div>
      )}

      {/* Round 2 hard cap warning */}
      {round === 2 && (
        <div className="flex items-center gap-3 p-3 border border-wsg-border bg-tile rounded-sm">
          <AlertTriangle className="h-4 w-4 text-text-muted shrink-0" />
          <p className="text-[11px] text-text-muted">
            Round 2 — final round. Approve, reject, or escalate each remaining item.
          </p>
        </div>
      )}

      {/* All approved = cart ready */}
      {allReviewed && !hasSwaps && approvedCount > 0 && (
        <div className="flex items-center gap-3 p-4 border border-text/30 bg-tile rounded-sm">
          <ShoppingCart className="h-5 w-5 text-text shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-text font-medium">Ready for checkout</p>
            <p className="text-[11px] text-text-muted mt-0.5">
              {approvedCount} items approved. Switch to Cart view for QA checklist.
            </p>
          </div>
          <button
            onClick={() => setView('cart')}
            className="px-4 py-2 bg-text text-white text-[10px] tracking-[0.2em] uppercase rounded-sm hover:bg-text/90 transition-colors shrink-0"
          >
            View Cart
          </button>
        </div>
      )}

      {/* Slot view — grid of slot cards */}
      {view === 'slot' && (
        <div className="space-y-8">
          {activeSlots.map((slot) => (
            <div key={slot.id}>
              {/* Slot header */}
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-text">{slot.description}</h3>
                <div className="flex items-center gap-2">
                  {slot.status === 'escalated' && (
                    <span className="px-2 py-0.5 text-[9px] tracking-[0.1em] uppercase bg-blush text-text rounded-sm">
                      Escalated
                    </span>
                  )}
                  {slot.status !== 'escalated' && slot.status !== 'rejected' && (
                    <>
                      <button
                        onClick={() => useBoardStore.getState().escalateSlot(slot.id)}
                        className="text-[9px] tracking-[0.1em] uppercase text-text-muted hover:text-amber-600 transition-colors"
                      >
                        Escalate
                      </button>
                      <button
                        onClick={() => useBoardStore.getState().rejectSlot(slot.id)}
                        className="text-[9px] tracking-[0.1em] uppercase text-text-muted hover:text-red-500 transition-colors"
                      >
                        Remove slot
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Option cards grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {slot.options
                  .filter((o) => round === 1 || o.status !== 'rejected')
                  .map((option) => (
                    <OptionCard key={option.id} option={option} round={round} />
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Look view placeholder */}
      {view === 'look' && (
        <div className="py-12 text-center">
          <p className="text-[11px] tracking-[0.2em] uppercase text-text-muted">
            Look view — coming soon. Group items by outfit for pairing checks.
          </p>
        </div>
      )}

      {/* Cart view */}
      {view === 'cart' && <CartView />}
    </div>
  )
}
