// Ask the server to make the small copy of a picture now, instead of waiting for the backfill.
// See api/derive-image.ts. Fire-and-forget: callers never await this in a way that blocks the UI,
// and a failure only means the tile shows the original (via the photo path's redirect) until the
// backfill runs.
//
// Absolute URL on purpose: on atelierbywatson.com/style a relative /api/ is the DASHBOARD's /api.
// Same pattern as AddItemDialog's add-closet-item call.
import { authHeader } from '@/lib/authHeader'

const DERIVE_API = 'https://atelier-builder.vercel.app/api/derive-image'

export async function requestDerivatives(ids: {
  look_ids?: string[]
  item_ids?: string[]
  intake_item_ids?: string[]
}): Promise<void> {
  const body: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(ids)) {
    const clean = [...new Set((v ?? []).filter(Boolean))]
    if (clean.length) body[k] = clean
  }
  if (Object.keys(body).length === 0) return
  try {
    await fetch(DERIVE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify(body),
      keepalive: true,
    })
  } catch {
    // Best effort; the backfill covers anything missed.
  }
}
