// Vercel serverless — create ONE new client in gp_clients.
//
// Lets a stylist add a client who isn't in GoodPix (the GoodPix-sunset path:
// Atelier becomes a place clients can originate, not just a GoodPix mirror).
// Uses the service-role key server-side (same env as store-image.ts / ADR-0016)
// so we don't depend on anon INSERT RLS on the shared gp_clients table.
//
// Builder-created clients get a `wsg_`-prefixed id (never collides with GoodPix
// Mongo _id strings, and is easy to spot as builder-origin) and an 8-char
// microsite slug (matching GoodPix's slug shape) so they show in the lookbook.

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const WSG_TEAM_ID = '687fb860df4ad4912bc0abc5' // same team the scraper writes under

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const TIERS = ['A-la-carte', 'Signature', 'White Glove', 'Elève']

function slug(): string {
  // 8 lowercase alphanumerics, like GoodPix microsites (e.g. "k522xhzn")
  let s = ''
  while (s.length < 8) s += Math.random().toString(36).slice(2)
  return s.slice(0, 8)
}

async function rest(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  })
}

async function uniqueSlug(): Promise<string> {
  // A handful of tries — collision odds on 8 base36 chars are negligible.
  for (let i = 0; i < 5; i++) {
    const s = slug()
    const r = await rest(`gp_clients?microsite=eq.${s}&select=id&limit=1`, { method: 'GET' })
    const rows = r.ok ? await r.json() : []
    if (!Array.isArray(rows) || rows.length === 0) return s
  }
  return slug()
}

export default async function handler(req: any, res: any) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  if (!SUPABASE_URL || !SERVICE_KEY)
    return res.status(500).json({ error: 'server not configured' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
    const name = (body.name || '').trim()
    if (!name) return res.status(400).json({ error: 'name required' })

    const email = (body.email || '').trim() || null
    const phone = (body.phone || '').trim() || null
    const tier = TIERS.includes(body.membership_tier) ? body.membership_tier : null
    const stylist = (body.primary_stylist_id || '').trim() || null

    const now = new Date().toISOString()
    const microsite = await uniqueSlug()
    const row = {
      id: `wsg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      name,
      email,
      phone,
      membership_tier: tier,
      primary_stylist_id: stylist,
      status: (body.status || 'active').trim() || 'active',
      microsite,
      team_id: WSG_TEAM_ID,
      created_at: now,
      onboarded_at: now,
    }

    const ins = await rest('gp_clients', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    })
    if (!ins.ok) {
      const detail = await ins.text()
      return res.status(502).json({ error: 'insert failed', detail: detail.slice(0, 500) })
    }
    const created = (await ins.json())?.[0] || row
    return res.status(200).json({ client: { id: created.id, name: created.name }, microsite })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'create failed' })
  }
}
