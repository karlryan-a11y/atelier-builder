import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env.js'

/** Service-role client — bypasses RLS to read canvas_state/items and write baked hero fields. */
export const db: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** Verify a caller's JWT (from the builder). Returns the user id, or null if the token is invalid. */
export async function verifyCaller(token: string): Promise<string | null> {
  const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await anon.auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}

/**
 * Upload a base64 PNG to R2 through the same upload-image edge function the builder uses.
 * Returns the R2 key on success, or null (the caller keeps the old hero rather than a broken one).
 */
export async function uploadImage(base64: string, key: string): Promise<string | null> {
  try {
    const resp = await fetch(`${env.SUPABASE_URL}/functions/v1/upload-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Harmless if the function has verify_jwt=false (as the browser call implies); required if not.
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ base64, content_type: 'image/png', key }),
    })
    if (!resp.ok) {
      console.warn('upload-image failed', resp.status, await resp.text().catch(() => ''))
      return null
    }
    return key
  } catch (err) {
    console.warn('upload-image error', err)
    return null
  }
}
