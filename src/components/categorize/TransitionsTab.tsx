import { useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { useTransitions } from '@/hooks/useTransitions'

// Renders the transitioned pieces a client (or stylist) marked "no longer owned", and the looks
// that were pulled from the lookbook as a result. Restore returns a piece and re-publishes any
// look no other transitioned piece still holds back. See migration 014.

type TransitionsHook = ReturnType<typeof useTransitions>

const REASON_LABEL: Record<string, string> = {
  donated: 'Donated', sold: 'Sold', discarded: 'Discarded', unspecified: 'Transitioned out',
}

export function TransitionsTab({ items, looks, loading, error, restoreItem }: TransitionsHook) {
  const [busy, setBusy] = useState<string | null>(null)
  // Ref guard: blocks a second restore firing before React re-renders the disabled button
  // (state alone can lag a rapid double-tap / a stalled-then-retried click).
  const inFlight = useRef(false)

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
                    <img src={item.image} alt={item.name} className="max-w-full max-h-full object-contain p-2.5 opacity-70" loading="lazy" />
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
          <span className="text-[11px] text-[#aaa]">{looks.length}</span>
        </div>
        <p className="text-[12px] text-[#aaa] mb-4 max-w-xl">
          Pulled from the lookbook because a piece they use was transitioned out. Restyle with pieces the client still owns; a restyled look returns to the lookbook on its own. Restoring the piece above brings its looks back automatically.
        </p>
        {looks.length === 0 ? (
          <p className="text-[#aaa] text-[13px]">None.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {looks.map((look) => (
              <div key={look.id} className="border border-[#E8E4DF] rounded-sm overflow-hidden bg-white">
                <div className="aspect-[4/5] bg-[#F8F7F5] flex items-center justify-center">
                  {look.image ? (
                    <img src={look.image} alt={look.name} className="max-w-full max-h-full object-contain opacity-70" loading="lazy" />
                  ) : (
                    <span className="text-[10px] tracking-[0.2em] uppercase text-[#bbb]">Look</span>
                  )}
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-[13px] text-[#1A1A1A] truncate">{look.name}</p>
                  <p className="text-[10px] tracking-[0.14em] uppercase text-[#aaa] mt-1">
                    {look.causeItemIds.length > 1 ? `${look.causeItemIds.length} pieces transitioned` : 'Piece transitioned'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
