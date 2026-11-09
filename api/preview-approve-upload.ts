// Vercel serverless, BRANCH PREVIEWS ONLY: presses an upload card's Approve for a demo client.
//
// WHY. The browser tester stops every Supabase edge function call, so the Approve on Needs Review >
// Uploads could not be tried end to end before GO. This passes the same call on with the caller's own
// sign-in, and refuses on live, for anyone who is not staff, and for any card that is not a demo client's.

import { requireStaff } from './_staff.js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY
const DEMO = new Set(['de301700a2026ba7b1ede1ce', '67d07083e2ef5b4561d5e846', 'wsg_1a117e2a7186d7ab4'])

export default async function handler(req: any, res: any) {
  if (process.env.VERCEL_ENV !== 'preview') return res.status(404).json({ error: 'not found' })
  if (req.method !== 'POST') return res.status(405).json({ error: 'wrong method' })
  const caller = await requireStaff(req, res)
  if (!caller) return

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})
  const itemId = String(body.item_id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return res.status(400).json({ error: 'bad item' })
  const auth = String(req.headers.authorization ?? '')
  const look = await fetch(`${SUPABASE_URL}/rest/v1/intake_items?id=eq.${itemId}&select=client_id`, { headers: { apikey: String(ANON), Authorization: auth } })
  const rows = look.ok ? await look.json() : []
  if (!rows.length || !DEMO.has(rows[0].client_id)) return res.status(403).json({ error: 'demo clients only' })

  const r = await fetch(`${SUPABASE_URL}/functions/v1/intake-approve-item`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ item_id: itemId, metadata_overrides: body.metadata_overrides, feedback: body.feedback }),
  })
  const text = await r.text()
  res.setHeader('Content-Type', 'application/json')
  return res.status(r.status).send(text)
}
