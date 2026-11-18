// Vercel serverless: Remove BG for a piece whose photo is still on a store's own site.
//
// WHY. Cynthia Dada, 2026-11-18: Peyton's new Jacquemus pieces said "couldn't fetch the item image
// (403)". GoodPix brought them in with the photo on jacquemus.com, and that site refuses the
// background remover's own download while it answers an ordinary server. So this reads the photo
// the way a browser would, keeps a copy in our storage, and hands the remover (intake-remove-bg-item,
// the same one every other piece uses) that copy, with the caller's own sign-in.
//
// Only for a signed-in team member, only for a piece her own sign-in can read under the client she
// names, and only for a photo that piece really has. On a branch preview, only for the demo clients.

import { requireStaff } from './_staff.js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const BUCKET = 'shopping-images'
const DEMO = new Set(['de301700a2026ba7b1ede1ce', '67d07083e2ef5b4561d5e846', 'wsg_1a117e2a7186d7ab4'])
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export default async function handler(req: any, res: any) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  if (!SUPABASE_URL || !ANON || !SERVICE_KEY) return res.status(500).json({ error: 'server not configured' })
  const caller = await requireStaff(req, res)
  if (!caller) return

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})
  const itemId = String(body.item_id ?? '')
  const clientId = String(body.client_id ?? '')
  const imageUrl = String(body.image_url ?? '')
  if (!itemId || !clientId || !/^https?:\/\//i.test(imageUrl)) return res.status(400).json({ error: 'item, client and photo needed' })
  if (process.env.VERCEL_ENV === 'preview' && !DEMO.has(clientId)) return res.status(403).json({ error: 'On a test copy, Remove BG works on the demo clients only.' })

  // The piece, read with her own sign-in: a stylist who can't see this client gets nothing back.
  const auth = String(req.headers.authorization ?? '')
  const look = await fetch(
    `${SUPABASE_URL}/rest/v1/gp_closet_items?id=eq.${encodeURIComponent(itemId)}&client_id=eq.${encodeURIComponent(clientId)}&select=id,raw->image,raw->images,raw->processed_image`,
    { headers: { apikey: ANON, Authorization: auth } })
  const rows = look.ok ? await look.json() : []
  if (!Array.isArray(rows) || rows.length === 0) return res.status(404).json({ error: 'That piece was not found for this client.' })
  const own = [rows[0].image, rows[0].processed_image, ...(Array.isArray(rows[0].images) ? rows[0].images : [])]
  if (!own.includes(imageUrl)) return res.status(400).json({ error: "That photo isn't this piece's photo." })

  // Read the photo the way a browser does, and keep a copy in our storage.
  let copyUrl = ''
  try {
    const r = await fetch(imageUrl, { headers: { 'user-agent': UA, accept: 'image/jpeg,image/png;q=0.9,image/webp;q=0.8,*/*;q=0.5' } })
    const ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!r.ok || !EXT[ct]) return res.status(200).json({ ok: false, reason: `The store's site wouldn't hand over this photo (${r.status}). Try Replace photo with a saved copy.` })
    const bytes = new Uint8Array(await r.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > 15_000_000) return res.status(200).json({ ok: false, reason: 'This photo is empty or too big to clean.' })
    const path = `closet-originals/${clientId.replace(/[^A-Za-z0-9_-]/g, '')}/${itemId.replace(/[^A-Za-z0-9_-]/g, '')}-${Date.now()}.${EXT[ct]}`
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': ct, 'x-upsert': 'true' },
      body: bytes,
    })
    if (!up.ok) return res.status(500).json({ error: `Couldn't keep a copy of the photo (${up.status}).` })
    copyUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "The store's site didn't answer. Try again in a minute." })
  }

  // The same remover every other piece uses, given our copy.
  const r = await fetch(`${SUPABASE_URL}/functions/v1/intake-remove-bg-item`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ item_id: itemId, image_url: copyUrl }),
  })
  const text = await r.text()
  res.setHeader('Content-Type', 'application/json')
  return res.status(r.status).send(text)
}
