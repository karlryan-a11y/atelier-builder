// Vercel serverless: the share-link calls (mint / status / revoke) on the builder's own address.
//
// WHY. The endpoints live in the lookbook (atelier-looks /api/share/*). On atelierbywatson.com/style
// the dashboard passes /looks/... there on the same address, but on the builder's own addresses (its
// branch previews included) a direct call is cross-origin and the lookbook refuses that origin, so
// Copy link and the phone's Send could never be tried before GO. This passes the call on, server to
// server, with the caller's own sign-in: the lookbook still decides who is staff and stamps the
// client from the look itself. Nothing here holds or uses a key of its own.

import { requireStaff } from './_staff.js'

const LOOKBOOK = 'https://atelier-looks.vercel.app/api/share'
const ACTIONS = new Set(['mint', 'status', 'revoke'])

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export default async function handler(req: any, res: any) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(204).end()
  const action = String(req.query?.action ?? '')
  if (!ACTIONS.has(action)) return res.status(404).json({ error: 'unknown action' })
  if (req.method !== (action === 'status' ? 'GET' : 'POST')) return res.status(405).json({ error: 'wrong method' })

  const caller = await requireStaff(req, res)
  if (!caller) return

  try {
    const qs = action === 'status' && req.query?.clientId ? `?clientId=${encodeURIComponent(String(req.query.clientId))}` : ''
    const body = action === 'status' ? undefined : typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})
    const r = await fetch(`${LOOKBOOK}/${action}${qs}`, {
      method: action === 'status' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: String(req.headers.authorization ?? '') },
      body,
    })
    const text = await r.text()
    res.setHeader('Content-Type', 'application/json')
    return res.status(r.status).send(text)
  } catch {
    return res.status(502).json({ error: 'lookbook unreachable' })
  }
}
