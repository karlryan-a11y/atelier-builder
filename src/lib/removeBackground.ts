// Remove BG and its Undo, for every surface (Edit dialog, bulk, canvas, Reconciliation).
// See api/remove-bg.ts: the server runs the remover, refuses a result that cut into the piece
// (the photo stays as it was and `reason` says so in plain words), and puts back the earlier photo
// on Undo. Callers refresh heroes only on ok, the same way Replace photo does.
//
// The builder's own address on its own deployment (a branch preview included); on
// atelierbywatson.com/style a relative /api/ is the DASHBOARD's, so it goes to the builder directly.
import { authHeader } from '@/lib/authHeader'

const API = typeof window !== 'undefined' && /^atelier-builder[a-z0-9-]*\.vercel\.app$/.test(window.location.hostname)
  ? '/api/remove-bg'
  : 'https://atelier-builder.vercel.app/api/remove-bg'

export interface RemoveBgResult {
  ok: boolean
  /** The new transparent picture, when ok. */
  url?: string
  /** Plain words for the stylist when not ok. */
  reason?: string
  /** true when the result cut into the piece and the earlier photo was kept. */
  damaged?: boolean
}

/**
 * The key Remove BG saves its result under: while it shows, Undo can put the earlier photo back.
 * (The remover keeps that photo in raw.bg_backup; the closet list does not load raw whole, so the
 * server checks the backup is there.)
 */
export const isRemoveBgResult = (item: { processed_image_hash?: string | null }) =>
  String(item.processed_image_hash ?? '').startsWith('closet/nobg/')

async function call(body: Record<string, unknown>): Promise<RemoveBgResult> {
  try {
    const resp = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify(body),
    })
    const d = await resp.json().catch(() => ({}))
    if (!resp.ok || !d?.ok) return { ok: false, damaged: !!d?.damaged, reason: d?.reason || d?.error || 'Could not remove the background.' }
    return { ok: true, url: d.url }
  } catch {
    return { ok: false, reason: 'Could not reach the background remover. Try again.' }
  }
}

/** client_id rides along so the request names whose piece it is (logs, and the test harness). */
export const removeBackground = (itemId: string, imageUrl: string | null, clientId?: string | null) =>
  call({ action: 'remove', item_id: itemId, image_url: imageUrl, client_id: clientId ?? null })

export const undoRemoveBackground = (itemId: string, clientId?: string | null) =>
  call({ action: 'undo', item_id: itemId, client_id: clientId ?? null })
