// Vercel serverless, BRANCH PREVIEWS ONLY: presses Remove BG or Replace photo for a demo client's piece.
//
// WHY. The browser tester stops every Supabase edge function call, so Remove BG (intake-remove-bg-item)
// and Replace photo (intake-replace-closet-image) could not be tried end to end before GO (Cynthia Dada,
// 2026-11-18, Peyton's Jacquemus pieces). This passes the same call on with the caller's own sign-in,
// and refuses on live, for anyone who is not staff, and for any piece that is not a demo client's.
// Replace photo's file comes as base64 in JSON and is sent on as the same multipart form.

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
  if (!itemId) return res.status(400).json({ error: 'bad item' })
  const auth = String(req.headers.authorization ?? '')
  const look = await fetch(`${SUPABASE_URL}/rest/v1/gp_closet_items?id=eq.${encodeURIComponent(itemId)}&select=client_id`, { headers: { apikey: String(ANON), Authorization: auth } })
  const rows = look.ok ? await look.json() : []
  if (!rows.length || !DEMO.has(rows[0].client_id)) return res.status(403).json({ error: 'demo clients only' })

  let r: Response
  if (body.fn === 'intake-remove-bg-item') {
    r = await fetch(`${SUPABASE_URL}/functions/v1/intake-remove-bg-item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ item_id: itemId, image_url: body.image_url }),
    })
  } else if (body.fn === 'intake-replace-closet-image') {
    const fd = new FormData()
    fd.append('item_id', itemId)
    fd.append('photo', new Blob([Buffer.from(String(body.photo_base64 ?? ''), 'base64')], { type: String(body.type || 'image/jpeg') }), String(body.name || 'photo.jpg'))
    r = await fetch(`${SUPABASE_URL}/functions/v1/intake-replace-closet-image`, { method: 'POST', headers: { Authorization: auth }, body: fd })
  } else {
    return res.status(400).json({ error: 'unknown action' })
  }
  const text = await r.text()
  res.setHeader('Content-Type', 'application/json')
  return res.status(r.status).send(text)
}
