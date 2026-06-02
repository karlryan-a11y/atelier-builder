// Vercel serverless function — Cowork auto-upload + permanent image rehost.
//
// Cowork (or the in-app importer) POSTs sourced results here, scoped to a
// session by its uuid. The function parses the results, fetches each product
// image server-side and stores it permanently in Supabase Storage (so the board
// never shows a broken/hotlink-blocked retailer URL), then writes the slots +
// options. Returns the final options so the client can render them immediately.
//
// Auth model: the session_id (a v4 uuid) is the capability token — unguessable,
// and the function only ever writes shopping_slots/options for that one session.
// Uses the service-role key (server-side only) for the storage upload + writes.

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const BUCKET = 'shopping-images'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

interface IngestOption {
  slot_description: string
  product_name?: string
  brand?: string
  retailer?: string
  price?: string | number
  url?: string
  image_url?: string
  sizes_available?: string
  colors_available?: string
  recommended_size?: string
  recommended_color?: string
  ship_timeline?: string
  return_policy?: string
  confidence?: string
}

// ---- tiny PostgREST helpers ------------------------------------------------

function db(path: string, init: RequestInit = {}) {
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

function parseNum(v: unknown): number | null {
  if (v == null) return null
  const cleaned = String(v).replace(/[^0-9.]/g, '')
  if (!cleaned) return null
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}
function splitCsv(v: unknown): string[] {
  return String(v || '')
    .split(/[,/]/)
    .map((s) => s.trim())
    .filter(Boolean)
}
function norm(s: string): string {
  return (s || '').trim().toLowerCase()
}

// ---- markdown parser (mirrors src/lib/cowork-parser.ts) --------------------

function field(block: string, label: string): string {
  for (const re of [
    new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`, 'i'),
    new RegExp(`- \\*\\*${label}:\\*\\*\\s*(.+)`, 'i'),
    new RegExp(`${label}:\\s*(.+)`, 'i'),
  ]) {
    const m = block.match(re)
    if (m) return m[1].trim()
  }
  return ''
}
function cleanUrl(u: string): string {
  return (u || '').replace(/\\([_*()\[\]~`.#-])/g, '$1').trim()
}
function imageFrom(block: string): string {
  const cand = cleanUrl(field(block, 'Image')) || block
  let m = cand.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/)
  if (m) return cleanUrl(m[1])
  // Leftmost URL, stopping at whitespace + markdown delimiters ( ) [ ] " \
  m = cand.match(/https?:\/\/[^\s)\]["[(\\]+\.(?:png|jpe?g|webp|gif|avif)[^\s)\]["[(\\]*/i)
  if (m) return cleanUrl(m[0])
  m = cand.match(/https?:\/\/[^\s)\]["[(\\]+/i)
  if (m) return cleanUrl(m[0])
  return ''
}
function parseRaw(raw: string): IngestOption[] {
  const out: IngestOption[] = []
  const sections = raw.split(/^## Slot:/m).filter((s) => s.trim())
  for (const section of sections) {
    const desc = (section.trim().match(/^(.+?)(?:\n|$)/)?.[1] || 'Unknown item').trim()
    const blocks = section.split(/^### Option \d+/m).filter((_, i) => i > 0)
    for (const block of blocks) {
      out.push({
        slot_description: desc,
        product_name: field(block, 'Product'),
        brand: field(block, 'Brand'),
        retailer: field(block, 'Retailer'),
        price: field(block, 'Price'),
        url: cleanUrl(field(block, 'URL')),
        sizes_available: field(block, 'Sizes Available'),
        colors_available: field(block, 'Colors Available'),
        recommended_size: field(block, 'Recommended Size'),
        recommended_color: field(block, 'Recommended Color'),
        ship_timeline: field(block, 'Ship Timeline'),
        return_policy: field(block, 'Return Policy'),
        image_url: imageFrom(block),
        confidence: /high/i.test(field(block, 'Confidence'))
          ? 'high'
          : /medium/i.test(field(block, 'Confidence'))
          ? 'medium'
          : 'low',
      })
    }
  }
  return out
}

// ---- image rehost ----------------------------------------------------------

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// Retailer share image from a product page — fallback when the given image URL
// is wrong/404s. og:image / twitter:image usually sits on a permissive CDN.
async function ogImage(pageUrl: string): Promise<string | null> {
  try {
    const r = await fetch(pageUrl, { headers: { 'user-agent': UA, accept: 'text/html,*/*' } })
    if (!r.ok) return null
    const html = (await r.text()).slice(0, 300000)
    const pats = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i,
    ]
    for (const p of pats) {
      const m = html.match(p)
      if (m) return m[1]
    }
  } catch {
    /* ignore */
  }
  return null
}

async function rehostImage(srcUrl: string, key: string, referer?: string): Promise<string | null> {
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
    const r = await fetch(srcUrl, { headers })
    if (!r.ok) return null
    const ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!ct.startsWith('image/')) return null
    const ext = EXT[ct] || 'jpg'
    const bytes = new Uint8Array(await r.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > 8_000_000) return null
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
  } catch {
    return null
  }
}

// ---- handler ---------------------------------------------------------------

export default async function handler(req: any, res: any) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  if (!SUPABASE_URL || !SERVICE_KEY)
    return res.status(500).json({ error: 'server not configured' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
    const sessionId: string = body.session_id
    const round: number = body.round === 2 ? 2 : 1
    if (!sessionId) return res.status(400).json({ error: 'session_id required' })

    let options: IngestOption[] = Array.isArray(body.options) ? body.options : []
    if (options.length === 0 && typeof body.raw === 'string') options = parseRaw(body.raw)
    if (options.length === 0) return res.status(400).json({ error: 'no options or raw provided' })

    // Validate the session exists (capability check)
    const sess = await db(`shopping_sessions?id=eq.${sessionId}&select=id`).then((r) => r.json())
    if (!Array.isArray(sess) || sess.length === 0)
      return res.status(404).json({ error: 'session not found' })

    // Resolve / create slots by description
    const existing = await db(
      `shopping_slots?session_id=eq.${sessionId}&select=id,description`
    ).then((r) => r.json())
    const slotIdByDesc = new Map<string, string>()
    for (const s of existing || []) slotIdByDesc.set(norm(s.description), s.id)

    const descs = [...new Set(options.map((o) => o.slot_description))]
    const missing = descs.filter((d) => !slotIdByDesc.has(norm(d)))
    if (missing.length > 0) {
      const created = await db(`shopping_slots`, {
        method: 'POST',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify(
          missing.map((d, i) => ({
            session_id: sessionId,
            description: d,
            display_order: (existing?.length || 0) + i,
          }))
        ),
      }).then((r) => r.json())
      for (const s of created || []) slotIdByDesc.set(norm(s.description), s.id)
    }

    // Clear prior options for this session+round
    await db(`shopping_options?session_id=eq.${sessionId}&round=eq.${round}`, { method: 'DELETE' })

    // Rehost images (in parallel) + build rows
    const rows = await Promise.all(
      options.map(async (o, i) => {
        const slotId = slotIdByDesc.get(norm(o.slot_description))
        if (!slotId) return null
        let image_url = o.image_url || null
        let image_r2_key: string | null = null
        const key = `${sessionId}/r${round}-${i}`
        const productUrl = o.url || undefined
        if (image_url) {
          const stored = await rehostImage(image_url, key, productUrl)
          if (stored) {
            image_r2_key = key
            image_url = stored
          }
        }
        // Fallback: the given image URL was wrong/blocked — try the product
        // page's share image (og:image) and re-host that instead.
        if (!image_r2_key && productUrl) {
          const og = await ogImage(productUrl)
          if (og) {
            const stored = await rehostImage(og, key, productUrl)
            if (stored) {
              image_r2_key = key
              image_url = stored
            }
          }
        }
        return {
          slot_id: slotId,
          session_id: sessionId,
          round,
          product_name: o.product_name || null,
          brand: o.brand || null,
          retailer: o.retailer || null,
          price: parseNum(o.price),
          product_url: o.url || null,
          image_url,
          image_r2_key,
          sizes_available: splitCsv(o.sizes_available),
          colors_available: splitCsv(o.colors_available),
          selected_size: o.recommended_size || null,
          selected_color: o.recommended_color || null,
          ship_timeline: o.ship_timeline || null,
          return_policy: o.return_policy || null,
          confidence: ['high', 'medium', 'low'].includes(String(o.confidence)) ? o.confidence : 'low',
        }
      })
    )
    const insertRows = rows.filter(Boolean)

    let inserted: any[] = []
    if (insertRows.length > 0) {
      inserted = await db(`shopping_options`, {
        method: 'POST',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify(insertRows),
      }).then((r) => r.json())
    }

    return res.status(200).json({
      ok: true,
      slots: slotIdByDesc.size,
      options: insertRows.length,
      rehosted: insertRows.filter((r: any) => r.image_r2_key).length,
      data: inserted,
    })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'ingest failed' })
  }
}
