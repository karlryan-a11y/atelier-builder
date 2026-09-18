import { useMemo, useRef, useState } from 'react'
import { RotateCcw, Wand2, Archive, Copy } from 'lucide-react'
import type { useTransitions, TransitionedItem } from '@/hooks/useTransitions'
import { lookTitle, causeCaption } from '@/lib/transitionCaption'
import { groupPulledLooks, orderQueue, queueSummary, queueHeadline, type QueueCard } from '@/lib/transitionQueue'
import { TileImage } from '@/components/common/TileImage'
import { LOOK_TILE_WIDTH, PIECE_TILE_WIDTH } from '@/lib/derivedImage'

// Renders the transitioned pieces a client (or stylist) marked "no longer owned", and the looks
// that were pulled from the lookbook as a result. Restore returns a piece and re-publishes any
// look no other transitioned piece still holds back. See migration 014.

type TransitionsHook = ReturnType<typeof useTransitions>
type Props = TransitionsHook & {
  /**
   * Open a pulled look on the canvas with everything she no longer owns already off the board.
   * Takes the whole CARD, not the look, so a save can hand the lookbook slot over from every
   * duplicate the card covers rather than leaving the twin dark.
   */
  onRestyle: (card: QueueCard) => void
  restylingId: string | null
}

const REASON_LABEL: Record<string, string> = {
  donated: 'Donated', sold: 'Sold', discarded: 'Discarded', unspecified: 'Transitioned out',
}

export function TransitionsTab({ items, looks, loading, error, restoreItem, retireLooks, onRestyle, restylingId }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  // WORST FIRST, AND EACH PIECE OF WORK ONCE. Both decisions live in lib/transitionQueue.ts so
  // scripts/check-transition-queue.mjs measures the queue the stylist actually gets.
  const queue = useMemo(() => orderQueue(groupPulledLooks(looks)), [looks])
  const summary = useMemo(() => queueSummary(queue), [queue])
  // WHICH PIECE PULLED THIS LOOK. Julia Driscoll, 2026-09-09: "can I find in the look which
  // piece was the transitioned piece? I wasn't present during all of the transitioning."
  // The answer was already in the row -- `transitioned_item_ids` names the exact cause -- and
  // the tab loaded it, counted it and printed "Piece transitioned" without ever saying which.
  // Every one of the 443 cause references on the platform resolves to a piece in `items`
  // above (checked on production 2026-09-10), so this join costs nothing: no extra query, no
  // extra fetch, both lists are already on this screen.
  const itemById = new Map(items.map((i) => [i.id, i]))
  // Ref guard: blocks a second restore firing before React re-renders the disabled button
  // (state alone can lag a rapid double-tap / a stalled-then-retried click).
  const inFlight = useRef(false)

  async function onRetire(card: QueueCard) {
    if (inFlight.current) return
    const n = card.lookIds.length
    const alsoNames = card.siblings.map((s) => `"${lookTitle(s.name)}"`).join(', ')
    const twins = n > 1
      ? `\n\nThis card covers ${n} identical looks on the same board — ${alsoNames} will be retired too.`
      : ''
    if (!confirm(`Retire "${lookTitle(card.look.name)}" for good?${twins}\n\nIt leaves the client's lookbook and this queue. The look is archived, not deleted — Restore brings it back.`)) return
    inFlight.current = true
    setBusy(card.key)
    try { await retireLooks(card.lookIds) }
    catch (e) { alert('Could not retire: ' + (e instanceof Error ? e.message : 'unknown error')) }
    finally { setBusy(null); inFlight.current = false }
  }

  async function onRestore(itemId: string) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(itemId)
    try { await restoreItem(itemId) }
    catch (e) { alert('Could not restore: ' + (e instanceof Error ? e.message : 'unknown error')) }
    finally { setBusy(null); inFlight.current = false }
  }

  if (error) return <p className="text-[#b4443a] text-sm">Couldn’t load transitions: {error}</p>
  if (loading) return <p className="text-[#888] text-sm">Loading…</p>
  if (items.length === 0 && looks.length === 0) {
    return <p className="text-[#888] text-sm">Nothing transitioned out. When a client (or you) marks a piece as no longer owned, it and the looks styled with it land here.</p>
  }

  return (
    <div className="space-y-12">
      {/* ── Transitioned Collection Items ─────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-[12px] tracking-[0.2em] uppercase text-[#1A1A1A]">Transitioned Collection Items</h3>
          <span className="text-[11px] text-[#aaa]">{items.length}</span>
        </div>
        {items.length === 0 ? (
          <p className="text-[#aaa] text-[13px]">None.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {items.map((item) => (
              <div key={item.id} className="group relative border border-[#E8E4DF] rounded-sm overflow-hidden bg-white">
                <div className="aspect-square bg-[#F8F7F5] flex items-center justify-center">
                  {item.image ? (
                    <TileImage src={item.image} width={PIECE_TILE_WIDTH} alt={item.name} className="max-w-full max-h-full object-contain p-2.5 opacity-70" loading="lazy" />
                  ) : (
                    <span className="text-[10px] tracking-[0.2em] uppercase text-[#bbb]">No image</span>
                  )}
                </div>
                <div className="px-3 py-2.5">
                  {item.brand && <p className="text-[10px] tracking-[0.18em] uppercase text-[#1A1A1A] truncate">{item.brand}</p>}
                  <p className="text-[13px] text-[#1A1A1A] truncate mt-0.5">{item.name}</p>
                  <p className="text-[10px] tracking-[0.14em] uppercase text-[#aaa] mt-1">
                    {REASON_LABEL[item.reason ?? 'unspecified'] ?? 'Transitioned out'}
                    {item.source === 'stylist' ? ' · by stylist' : ''}
                  </p>
                  <button
                    onClick={() => onRestore(item.id)}
                    disabled={busy === item.id}
                    className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] tracking-[0.12em] uppercase text-[#8a7a6a] hover:text-[#1A1A1A] transition-colors disabled:opacity-50"
                    title="Restore this piece and any looks it alone was holding back"
                  >
                    <RotateCcw className="h-3 w-3" /> {busy === item.id ? 'Restoring…' : 'Restore'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Transitioned Looks ────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-[12px] tracking-[0.2em] uppercase text-[#1A1A1A]">Transitioned Looks</h3>
          <span className="text-[11px] text-[#aaa]">{queue.length}</span>
        </div>
        <p className="text-[12px] text-[#1A1A1A] mb-1.5">{queueHeadline(summary)}</p>
        <p className="text-[12px] text-[#aaa] mb-4 max-w-xl">
          Pulled from the lookbook because a piece they use was transitioned out. <strong>Worst first</strong>: the looks missing the most pieces are at the top, so you can see what you are taking on before you choose. <strong>Restyle</strong> opens the look on the canvas with everything she no longer owns already off the board, and the original picture beside it — saving returns the look to the lookbook, in its old place. <strong>Retire</strong> is for the rare look that shouldn’t come back (archived, not deleted). Restoring the piece above brings its looks back automatically.
        </p>
        {queue.length === 0 ? (
          <p className="text-[#aaa] text-[13px]">None.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {queue.map((card) => {
              const look = card.look
              const twins = card.lookIds.length
              return (
              <div key={card.key} className="border border-[#E8E4DF] rounded-sm overflow-hidden bg-white">
                <div className="aspect-[4/5] bg-[#F8F7F5] flex items-center justify-center">
                  {look.image ? (
                    <TileImage src={look.image} width={LOOK_TILE_WIDTH} alt={look.name} className="max-w-full max-h-full object-contain opacity-70" loading="lazy" />
                  ) : (
                    <span className="text-[10px] tracking-[0.2em] uppercase text-[#bbb]">Look</span>
                  )}
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-[13px] text-[#1A1A1A] truncate">{lookTitle(look.name)}</p>
                  {twins > 1 && (
                    <p className="mt-1 inline-flex items-center gap-1 text-[10px] tracking-[0.14em] uppercase text-[#8a7a6a]" title={card.siblings.map((s) => lookTitle(s.name)).join(', ')}>
                      <Copy className="h-3 w-3" /> {twins} identical looks · one job
                    </p>
                  )}
                  <CausePieces
                    causeItemIds={look.causeItemIds}
                    itemById={itemById}
                    transitionedAt={look.transitionedAt}
                  />
                  <div className="mt-2.5 flex items-center gap-4">
                    <button
                      onClick={() => onRestyle(card)}
                      disabled={restylingId === look.id || busy === card.key}
                      className="inline-flex items-center gap-1.5 text-[11px] tracking-[0.12em] uppercase text-[#8a7a6a] hover:text-[#1A1A1A] transition-colors disabled:opacity-50"
                      title="Open on the canvas without the pieces she no longer owns. Saving returns it to the lookbook."
                    >
                      <Wand2 className="h-3 w-3" /> {restylingId === look.id ? 'Opening…' : 'Restyle'}
                    </button>
                    <button
                      onClick={() => onRetire(card)}
                      disabled={busy === card.key || restylingId === look.id}
                      className="inline-flex items-center gap-1.5 text-[11px] tracking-[0.12em] uppercase text-[#bbb] hover:text-[#1A1A1A] transition-colors disabled:opacity-50"
                      title={twins > 1
                        ? `Archive all ${twins} identical looks on this board. Restore brings them back.`
                        : 'Archive this look for good. It leaves the queue and the lookbook; Restore brings it back.'}
                    >
                      <Archive className="h-3 w-3" /> {busy === card.key ? 'Retiring…' : 'Retire'}
                    </button>
                  </div>
                </div>
              </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * The missing sentence: WHICH piece knocked this look out of the lookbook, who removed it,
 * and when. Before this the card said "Piece transitioned" and nothing else, so a stylist
 * looking at 237 pulled looks (Alicia Hidalgo, 2026-09-10) could not tell which garment to
 * style around without opening each one. 110 of those 237 are down over exactly one piece.
 *
 * Shows the piece's own thumbnail beside its brand and name, because a stylist recognises the
 * garment faster than she reads it. The wording itself lives in lib/transitionCaption.ts so
 * the build can check it against real rows -- see scripts/check-transition-caption.mjs.
 */
function CausePieces({ causeItemIds, itemById, transitionedAt }: {
  causeItemIds: string[]
  itemById: Map<string, TransitionedItem>
  transitionedAt: string | null
}) {
  const caption = causeCaption(causeItemIds, (id) => itemById.get(id), transitionedAt)

  if (caption.pieces.length === 0 && caption.unresolved === 0) {
    return <p className="text-[10px] tracking-[0.14em] uppercase text-[#aaa] mt-1">{caption.headline}</p>
  }

  return (
    <div className="mt-1.5">
      <p className="text-[10px] tracking-[0.14em] uppercase text-[#aaa]">{caption.headline}</p>
      <ul className="mt-1.5 space-y-1.5">
        {caption.pieces.map((piece) => {
          const full = itemById.get(piece.id)
          return (
            <li key={piece.id} className="flex items-center gap-2">
              <span className="h-7 w-7 shrink-0 bg-[#F8F7F5] border border-[#EFEBE6] rounded-sm overflow-hidden flex items-center justify-center">
                {full?.image
                  ? <TileImage src={full.image} width={PIECE_TILE_WIDTH} alt="" className="max-w-full max-h-full object-contain p-0.5" loading="lazy" />
                  : <span className="text-[8px] tracking-[0.1em] uppercase text-[#ccc]">--</span>}
              </span>
              <span className="min-w-0">
                {piece.brand && (
                  <span className="block text-[9px] tracking-[0.16em] uppercase text-[#8a7a6a] truncate">{piece.brand}</span>
                )}
                <span className="block text-[12px] text-[#1A1A1A] leading-tight truncate">{piece.name}</span>
              </span>
            </li>
          )
        })}
        {caption.unresolved > 0 && (
          <li className="text-[11px] text-[#b4443a]">
            {caption.unresolved} {caption.unresolved === 1 ? 'piece' : 'pieces'} no longer in her collection - restore from the piece list above
          </li>
        )}
      </ul>
    </div>
  )
}
