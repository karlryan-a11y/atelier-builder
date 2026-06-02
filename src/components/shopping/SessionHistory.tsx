import { useEffect, useState } from 'react'
import { History, Link2, Check, Loader2, ArrowUpRight } from 'lucide-react'
import { useShoppingStore } from '@/stores/shoppingStore'
import { getClientSessions, type ClientSessionSummary } from '@/lib/shopping-persistence'
import { resumeSession } from '@/lib/shopping-resume'

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  brief_locked: 'Brief locked',
  sourcing: 'Sourcing',
  review_round_1: 'In review',
  review_round_2: 'In review (r2)',
  cart_ready: 'Cart ready',
  checkout: 'Checkout',
  ordered: 'Ordered',
  delivered: 'Delivered',
  tryon: 'Try-on',
  complete: 'Complete',
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso.slice(0, 10)
  }
}

export function SessionHistory() {
  const clientId = useShoppingStore((s) => s.session.profile.client_id)
  const currentSessionId = useShoppingStore((s) => s.session.id)
  const [sessions, setSessions] = useState<ClientSessionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!clientId) {
      setSessions([])
      return
    }
    setLoading(true)
    getClientSessions(clientId)
      .then((s) => active && setSessions(s))
      .catch(() => {})
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [clientId, currentSessionId])

  function linkFor(id: string) {
    return `${window.location.origin}/#session=${id}`
  }
  async function open(id: string) {
    setOpeningId(id)
    window.location.hash = `#session=${id}`
    await resumeSession(id)
    setOpeningId(null)
  }
  async function copy(id: string) {
    try {
      await navigator.clipboard.writeText(linkFor(id))
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  if (!clientId || (!loading && sessions.length === 0)) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase text-text-muted/60">
        <History className="h-3 w-3" />
        Past shopping sessions
      </div>
      {loading ? (
        <p className="text-[11px] text-text-muted/50 py-1">Loading…</p>
      ) : (
        <div className="space-y-1">
          {sessions.map((s) => {
            const isCurrent = s.id === currentSessionId
            return (
              <div
                key={s.id}
                className={`flex items-center gap-3 rounded-sm border px-3 py-2 ${
                  isCurrent ? 'border-text/40 bg-tile/60' : 'border-wsg-border bg-white'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-text">
                    {fmtDate(s.created_at)}
                    <span className="text-text-muted"> · {STATUS_LABEL[s.status] ?? s.status}</span>
                    {isCurrent && <span className="text-text-muted/60"> · open now</span>}
                  </p>
                  <p className="text-[10px] text-text-muted/60">
                    {s.optionCount} option{s.optionCount === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  onClick={() => copy(s.id)}
                  title="Copy shareable link"
                  className="flex items-center gap-1 text-[10px] tracking-[0.1em] uppercase text-text-muted hover:text-text transition-colors px-2 py-1"
                >
                  {copiedId === s.id ? <Check className="h-3 w-3 text-green-600" /> : <Link2 className="h-3 w-3" />}
                  {copiedId === s.id ? 'Copied' : 'Link'}
                </button>
                <button
                  onClick={() => open(s.id)}
                  disabled={openingId === s.id}
                  className="flex items-center gap-1 text-[10px] tracking-[0.12em] uppercase bg-text text-white rounded-sm px-3 py-1.5 hover:bg-text/90 transition-colors disabled:opacity-50"
                >
                  {openingId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowUpRight className="h-3 w-3" />}
                  Open
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
