// The builder's half of the one-login bridge with the dashboard (atelierbywatson.com/style).
//
// WHY THIS EXISTS. The dashboard's /api/auth/session used to hand the builder the dashboard's
// REFRESH token. The builder then refreshed that session on its own clock while the dashboard
// refreshed it on its clock. Supabase sees the same refresh token used twice, calls it token theft
// and revokes the whole session family: 19 fully revoked sessions in 21 days (measured 9/19), each a surprise
// logout / white login page for a stylist (Julia, Cynthia, Claire, Madeline, Maegan, Karl).
//
// THE RULE NOW. The builder never holds, stores or sends the dashboard's refresh token. When it
// adopts the dashboard login it stores the dashboard's ACCESS token plus a placeholder refresh
// token (BRIDGE_REFRESH_TOKEN). supabase-js still believes it owns a normal session, so every
// existing supabase.auth.getSession() / authHeader() caller keeps working unchanged. When
// supabase-js goes to refresh that placeholder (its normal ~90 s-before-expiry refresh), the fetch
// wrapper below answers from the dashboard's /api/auth/session instead of calling Supabase, so the
// dashboard stays the ONLY thing that ever refreshes its session.
//
// A session the stylist signed into on the builder itself (password form) has a real refresh token
// of its own family and is refreshed with Supabase as before, untouched.
//
// ONE-TIME MIGRATION. Devices that adopted before this change still hold a stored copy of the
// dashboard's real refresh token. If a refresh arrives for a real token whose session is the SAME
// Supabase session the dashboard is on (same session_id), that copied token is never sent: the
// refresh is answered from the dashboard instead and the stored copy is replaced by the placeholder.
//
// Proven by scripts/check-dashboard-refresh-token.mjs (drives the real useAuth hook and the real
// supabase-js client against a fake dashboard + fake Supabase).

export const BRIDGE_REFRESH_TOKEN = 'dashboard-bridge'
export const SESSION_ENDPOINT = '/api/auth/session'

type FetchLike = typeof fetch

export interface DashboardAccess {
  access_token: string
  expires_at: number
  expires_in: number
  token_type: string
  user: unknown
}

function b64urlDecode(part: string): string {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4)
  return atob(b64)
}

export function jwtClaims(token: string | undefined | null): Record<string, unknown> | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(b64urlDecode(parts[1]))
  } catch {
    return null
  }
}

// Ask the dashboard for its current access token. Never reads a refresh token, even if an older
// dashboard deployment still sends one. Returns null when nobody is signed in there; throws when
// the dashboard could not be reached (callers treat that as "try again", not "signed out").
export async function fetchDashboardAccess(fetchImpl: FetchLike): Promise<DashboardAccess | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 4000)
  let resp: Response
  try {
    resp = await fetchImpl(SESSION_ENDPOINT, {
      credentials: 'include',
      cache: 'no-store',
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(t)
  }
  if (resp.status === 404) return null // standalone builder host: no dashboard behind it
  if (!resp.ok) throw new Error(`dashboard session endpoint ${resp.status}`)
  const body = await resp.json().catch(() => null)
  const access = typeof body?.access_token === 'string' ? body.access_token : null
  if (!access) return null
  const claims = jwtClaims(access)
  const exp = typeof claims?.exp === 'number' ? claims.exp : Math.floor(Date.now() / 1000) + 60
  return {
    access_token: access,
    expires_at: exp,
    expires_in: Math.max(0, exp - Math.floor(Date.now() / 1000)),
    token_type: 'bearer',
    user: body?.user ?? null,
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function isRefreshRequest(input: RequestInfo | URL): boolean {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  return url.includes('/auth/v1/token') && url.includes('grant_type=refresh_token')
}

function refreshTokenOf(init?: RequestInit): string | null {
  if (typeof init?.body !== 'string') return null
  try {
    const t = JSON.parse(init.body)?.refresh_token
    return typeof t === 'string' ? t : null
  } catch {
    return null
  }
}

function readStoredSession(storageKey: string): { access_token?: string; refresh_token?: string } | null {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

async function answerFromDashboard(fetchImpl: FetchLike, prefetched?: DashboardAccess): Promise<Response> {
  let access: DashboardAccess | null
  try {
    access = prefetched ?? (await fetchDashboardAccess(fetchImpl))
  } catch {
    // Dashboard unreachable for a moment: a 503 is retryable to supabase-js, so the session is kept
    // and the next refresh tick asks again. Never a reason to log a stylist out.
    return json(503, { error: 'dashboard_unreachable', error_description: 'Dashboard session endpoint unreachable' })
  }
  if (!access) {
    // Signed out on the dashboard: end this session too (supabase-js emits SIGNED_OUT).
    return json(400, {
      error: 'invalid_grant',
      error_description: 'Dashboard session ended',
      code: 'refresh_token_not_found',
    })
  }
  let user = access.user
  if (!user) {
    const claims = jwtClaims(access.access_token)
    user = { id: claims?.sub, email: claims?.email, user_metadata: claims?.user_metadata ?? {}, app_metadata: claims?.app_metadata ?? {}, aud: claims?.aud }
  }
  return json(200, { ...access, user, refresh_token: BRIDGE_REFRESH_TOKEN })
}

// Wraps the fetch supabase-js uses. Everything except a refresh-token grant passes straight through.
export function createBridgeFetch(storageKey: string, baseFetch?: FetchLike): FetchLike {
  const base: FetchLike = (...args) => (baseFetch ?? globalThis.fetch)(...args)
  return async (input, init) => {
    if (!isRefreshRequest(input)) return base(input, init)
    const token = refreshTokenOf(init)
    if (token === BRIDGE_REFRESH_TOKEN) return answerFromDashboard(base)

    // A real refresh token. If it is a stored copy of the DASHBOARD's session (pre-fix adoption),
    // it must never reach Supabase: answer from the dashboard and let the placeholder replace it.
    const stored = readStoredSession(storageKey)
    if (token && stored?.refresh_token === token) {
      const storedSid = jwtClaims(stored.access_token)?.session_id
      if (storedSid) {
        let dash: DashboardAccess | null
        try {
          dash = await fetchDashboardAccess(base)
        } catch {
          // Can't tell yet whether this is a copied dashboard token: don't risk sending it.
          // 503 is retryable, so supabase-js keeps the session and asks again next tick.
          return json(503, { error: 'dashboard_unreachable', error_description: 'Dashboard session endpoint unreachable' })
        }
        if (dash && jwtClaims(dash.access_token)?.session_id === storedSid) {
          return answerFromDashboard(base, dash)
        }
      }
    }
    return base(input, init)
  }
}

export function defaultStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
}
