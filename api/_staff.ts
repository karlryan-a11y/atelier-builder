// Shared sign-in gate for this app's serverless functions.
//
// Why this exists: every function in api/ holds the SERVICE-ROLE key, which bypasses every row
// rule in the database. Until now they answered any request from anywhere (CORS '*', no auth), so
// the URL alone was the only thing standing between the internet and a service-role write - or a
// Claude call billed to us. The caller must now prove they are signed in AND on the team.
//
// Team = has a row in dashboard.profiles. That is the same definition the dashboard and the
// builder's own useAuth use (resolved by EMAIL - never join public.users.id to auth.uid()).
//
// Files in api/ whose name starts with "_" are not routed by Vercel, so this is a helper, not an
// endpoint.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''

export interface StaffCaller {
  id: string
  email: string
}

function bearer(req: any): string {
  const raw = req?.headers?.authorization || req?.headers?.Authorization || ''
  const m = /^Bearer\s+(.+)$/i.exec(String(raw))
  return m ? m[1].trim() : ''
}

/**
 * Resolve the caller from their Supabase access token, or null if they are not a signed-in team
 * member. Never throws: a failure is an anonymous caller.
 */
export async function getStaffCaller(req: any): Promise<StaffCaller | null> {
  const token = bearer(req)
  if (!token || !SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return null

  try {
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    })
    if (!who.ok) return null
    const user = await who.json()
    const email = String(user?.email || '').toLowerCase()
    if (!email) return null

    // A client login carries user_metadata.role === 'client' and has no profiles row. Check the
    // row rather than the metadata, so a forged-looking metadata field can never grant staff.
    const prof = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=id,email&email=eq.${encodeURIComponent(email)}&limit=1`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Accept-Profile': 'dashboard',
        },
      }
    )
    if (!prof.ok) return null
    const rows = await prof.json()
    if (!Array.isArray(rows) || rows.length === 0) return null

    return { id: String(user.id), email }
  } catch {
    return null
  }
}

/**
 * Gate a handler. Returns the caller, or writes 401 and returns null - in which case the handler
 * must return immediately.
 */
export async function requireStaff(req: any, res: any): Promise<StaffCaller | null> {
  const caller = await getStaffCaller(req)
  if (!caller) {
    res.status(401).json({ error: 'sign in required' })
    return null
  }
  return caller
}
