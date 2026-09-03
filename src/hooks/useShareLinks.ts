import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Share links for looks + capsules.
 *
 * A stylist presses "Copy link" on a card and pastes the result into a text or an
 * email; the client opens a public card page (atelierbywatson.com/c/<token>) that
 * renders the look or capsule read-only, with no login. This is what makes it
 * possible to send a DRAFT packing capsule to someone in an airport.
 *
 * The endpoints live in the lookbook app (it owns the data, the images and the
 * page), and are called cross-origin with the stylist's Supabase Bearer token —
 * exactly like shareToChat in CategorizePanel. Minting is idempotent, so the
 * link for a capsule is stable and its open count never splits across two tokens.
 */

const API = 'https://atelierbywatson.com/looks/api/share'

export type ShareKind = 'look' | 'capsule'

export interface ShareState {
  url: string
  openCount: number
  lastOpenedAt: string | null
}

const keyOf = (kind: ShareKind, subjectId: string) => `${kind}:${subjectId}`

/** "opened 2d ago" for the card. Mirrors openedAgo() in atelier-looks/src/lib/shareLinks.ts. */
export function openedAgo(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return null
  const mins = Math.max(0, Math.round((now - then) / 60000))
  if (mins < 1) return 'opened just now'
  if (mins < 60) return `opened ${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `opened ${hrs}h ago`
  return `opened ${Math.round(hrs / 24)}d ago`
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'Content-Type': 'application/json',
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }
}

/**
 * Put text on the clipboard, with a fallback.
 *
 * `navigator.clipboard.writeText` needs a secure context and, in Safari, an
 * unbroken user gesture — and the first press of Copy link has to await a mint
 * round-trip before it has anything to write. When that loses the gesture we
 * fall back to a hidden textarea, which has no such rule. If BOTH fail the
 * caller shows the URL so she can copy it by hand rather than being told
 * "copied" when nothing was.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

export function useShareLinks(clientId: string | null) {
  const [links, setLinks] = useState<Map<string, ShareState>>(new Map())
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  // One request per client, not one per tile: a client with 200 looks would
  // otherwise be 200 calls every time the panel opens.
  useEffect(() => {
    let cancelled = false
    if (!clientId) { setLinks(new Map()); return }
    ;(async () => {
      try {
        const res = await fetch(`${API}/status?clientId=${encodeURIComponent(clientId)}`, {
          headers: await authHeaders(),
        })
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        const next = new Map<string, ShareState>()
        for (const l of data.links ?? []) {
          next.set(keyOf(l.kind, l.subjectId), {
            url: l.url,
            openCount: l.openCount ?? 0,
            lastOpenedAt: l.lastOpenedAt ?? null,
          })
        }
        setLinks(next)
      } catch {
        /* the panel works fine without share state; the button mints on demand */
      }
    })()
    return () => { cancelled = true }
  }, [clientId])

  const stateFor = useCallback(
    (kind: ShareKind, subjectId: string) => links.get(keyOf(kind, subjectId)) ?? null,
    [links],
  )

  const copyLink = useCallback(async (kind: ShareKind, subjectId: string) => {
    const key = keyOf(kind, subjectId)
    setBusy(key)
    setStatus(null)
    try {
      // Already minted → write synchronously, which keeps Safari's user gesture.
      const known = links.get(key)
      let url = known?.url ?? ''
      if (!url) {
        const res = await fetch(`${API}/mint`, {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify({ kind, itemId: subjectId }),
        })
        const data = await res.json()
        if (!res.ok) { setStatus(`Link failed: ${data.error || res.status}`); return }
        url = data.url
        setLinks((prev) => new Map(prev).set(key, {
          url,
          openCount: data.openCount ?? 0,
          lastOpenedAt: data.lastOpenedAt ?? null,
        }))
      }
      const copied = await copyText(url)
      setStatus(copied ? 'Link copied — paste it into a text or an email' : `Copy failed. The link is ${url}`)
    } catch {
      setStatus('Link failed')
    } finally {
      setBusy(null)
    }
  }, [links])

  const revokeLink = useCallback(async (kind: ShareKind, subjectId: string) => {
    const key = keyOf(kind, subjectId)
    if (!confirm('Kill this link? Anyone holding it stops being able to open it. Copy link will make a new one.')) return
    setBusy(key)
    setStatus(null)
    try {
      const res = await fetch(`${API}/revoke`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ kind, itemId: subjectId }),
      })
      const data = await res.json()
      if (!res.ok) { setStatus(`Revoke failed: ${data.error || res.status}`); return }
      setLinks((prev) => { const n = new Map(prev); n.delete(key); return n })
      setStatus('Link revoked')
    } catch {
      setStatus('Revoke failed')
    } finally {
      setBusy(null)
    }
  }, [])

  return { stateFor, copyLink, revokeLink, busy, status, setStatus }
}
