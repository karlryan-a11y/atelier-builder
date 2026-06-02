// Vercel serverless — store ONE product image permanently and return its URL.
//
// Accepts either:
//   - a base64 data URI (data:image/...;base64,...) — the reliable path: Cowork
//     downloads the real image in its browser and embeds the bytes, so we never
//     have to re-fetch from a bot-blocked retailer. We just decode + store.
//   - a plain image URL — we fetch it (with referer + og:image fallback) and
//     store it if the retailer allows.
//
// Called once per option from the importer, so each request stays small (well
// under the serverless body limit, unlike one giant batch).

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const BUCKET = 'shopping-images'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

async function uploadBytes(bytes: Uint8Array, ct: string, key: string): Promise<string | null> {
  const ext = EXT[ct] || 'jpg'
  const path = `${key}.${ext}`
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': ct,
      'x-upsert': 'true',
    },
    body: bytes,
  })
  if (!up.ok) return null
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
}

async function ogImage(pageUrl: string): Promise<string | null> {
  try {
    const r = await fetch(pageUrl, { headers: { 'user-agent': UA, accept: 'text/html,*/*' } })
    if (!r.ok) return null
    const html = (await r.text()).slice(0, 300000)
    for (const p of [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i,
    ]) {
      const m = html.match(p)
      if (m) return m[1]
    }
  } catch {
    /* ignore */
  }
  return null
}

async function fetchAndStore(src: string, key: string, referer?: string): Promise<string | null> {
  try {
    const headers: Record<string, string> = {
      'user-agent': UA,
      accept: 'image/avif,image/webp,image/png,image/*,*/*;q=0.8',
    }
    if (referer) {
      try {
        const u = new URL(referer)
        headers.referer = `${u.protocol}//${u.host}/`
      } catch {
        /* ignore */
      }
    }
    const r = await fetch(src, { headers })
    if (!r.ok) return null
    const ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!ct.startsWith('image/')) return null
    const bytes = new Uint8Array(await r.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > 8_000_000) return null
    return uploadBytes(bytes, ct, key)
  } catch {
    return null
  }
}

function randKey(prefix: string): string {
  return `${prefix}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export default async function handler(req: any, res: any) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'server not configured' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
    const image: string = body.image || ''
    const referer: string | undefined = body.referer || undefined
    const key = randKey(body.session_id || 'misc')
    if (!image) return res.status(400).json({ error: 'image required' })

    // 1) base64 data URI — decode + store directly (the 100% path)
    const dataMatch = image.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i)
    if (dataMatch) {
      const ct = dataMatch[1].toLowerCase()
      const bytes = new Uint8Array(Buffer.from(dataMatch[2], 'base64'))
      if (bytes.byteLength === 0 || bytes.byteLength > 8_000_000)
        return res.status(200).json({ url: null, stored: false })
      const url = await uploadBytes(bytes, ct, key)
      return res.status(200).json({ url, stored: !!url })
    }

    // 2) plain URL — fetch + store, with og:image fallback
    if (/^https?:\/\//i.test(image)) {
      let url = await fetchAndStore(image, key, referer)
      if (!url && referer) {
        const og = await ogImage(referer)
        if (og) url = await fetchAndStore(og, key, referer)
      }
      // Couldn't store — hand back the original URL so the browser can still try
      return res.status(200).json({ url: url || image, stored: !!url })
    }

    return res.status(400).json({ error: 'unsupported image value' })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'store failed' })
  }
}
