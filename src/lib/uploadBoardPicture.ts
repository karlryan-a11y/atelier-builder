import { authHeader } from '@/lib/authHeader'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

/**
 * Upload a look's or capsule's picture to R2 through upload-image. Used by EVERY board save
 * (hooks/useLooks, hooks/useCapsules). ADR-0168.
 *
 * Before 2026-10-07 a failed upload was skipped and the row was written anyway, so a look could
 * go live with no picture and nobody was told. Now: a 45-second limit per try, one retry, and a
 * plain answer. The caller does not write the row when this says no.
 */
export async function uploadBoardPicture(key: string, base64: string): Promise<{ ok: true } | { ok: false; message: string }> {
  let last = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 45_000)
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/upload-image`, {
        method: 'POST',
        // Signed in, always: upload-image writes with the service-role key and refuses a caller it
        // cannot identify (ADR-0139).
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ base64, content_type: 'image/png', key }),
        signal: ctl.signal,
      })
      if (resp.ok) return { ok: true }
      last = `upload answered ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 200)}`
    } catch (e) {
      last = ctl.signal.aborted ? 'upload took longer than 45 seconds' : `upload failed: ${e instanceof Error ? e.message : String(e)}`
    } finally {
      clearTimeout(timer)
    }
  }
  return { ok: false, message: `The picture did not upload (${last}).` }
}
