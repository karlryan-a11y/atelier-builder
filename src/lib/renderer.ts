// Client → renderer-box bridge. When a stylist replaces / rotates / removes-bg on an item photo,
// the item row updates immediately everywhere the LIVE image is shown — but every look and capsule
// HERO is a baked composite PNG that still shows the old photo. This pings the always-on headless
// renderer box (see renderer/) to re-bake every affected look and capsule hero, hands-off.
//
// Best-effort and non-blocking: the stylist's replace succeeds regardless. If VITE_RENDERER_URL is
// unset (local dev / box not provisioned yet) this is a no-op, so nothing breaks without the box.
import { supabase } from '@/lib/supabase'

const RENDERER_URL = import.meta.env.VITE_RENDERER_URL as string | undefined

/**
 * Ask the renderer box to refresh every look / capsule hero that styles the given item(s).
 * Fire-and-forget — callers should NOT await this in a way that blocks the UI.
 */
export async function requestHeroRefresh(itemIds: string | string[]): Promise<void> {
  if (!RENDERER_URL) return
  const ids = [...new Set((Array.isArray(itemIds) ? itemIds : [itemIds]).filter(Boolean))]
  if (ids.length === 0) return
  try {
    const { data: { session } } = await supabase.auth.getSession()
    await fetch(`${RENDERER_URL.replace(/\/$/, '')}/regenerate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ item_ids: ids }),
      keepalive: true,
    })
  } catch {
    // The box has its own ret/queue; a dropped ping just means the hero refreshes on the next edit.
  }
}
