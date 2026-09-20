// Vercel serverless — make the small copy of a picture the moment it exists.
//
// WHY. A tile asks for derived/w<width>q82/<key>.jpg. Until today that copy was made only by a
// batch script run by hand, which skipped drafts and small sources: 24% of look pictures and 10% of
// pieces had none (measured 2026-09-19), so each of those tiles paid a 404 and then pulled the
// full original (up to 7.6 MB). Now the builder calls this right after:
//   - Save of a look                      { look_ids: [id] }
//   - Digitize approve (single + bulk)    { intake_item_ids: [...] }
//   - replace / rotate / remove-bg        { item_ids: [...] }   (via requestHeroRefresh)
// The row is resolved HERE, server-side, with the same rule the lookbook uses to ask for the copy,
// so the key written is the key read. Sizes, quality and key come from lib/derivative.mjs, the one
// definition the backfill and the old generator share (scripts/check-image-urls.mjs keeps them equal).
//
// Never overwrites: a copy that already exists is left alone. Writes go through the intake
// pipeline's upload-image function (the same path Save uses for the full picture), so this
// function holds no R2 credentials. Best effort: the caller never waits on it and a failure here
// only means the tile keeps using the original until the backfill runs.

import { requireStaff } from './_staff.js'
import { derivedKey, makeDerivative, LOOK_WIDTH, ITEM_WIDTH } from '../lib/derivative.mjs'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const PROXY = '/functions/v1/image-proxy' // server-side READ of R2; never shown on a screen
const GOODPIX = 'https://goodpix-co.s3.amazonaws.com/'
const MAX_IDS = 50

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

/** The R2 key in a stored image-proxy URL, or null. */
function keyFromProxyUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.includes(PROXY)) return null
  try {
    const k = new URL(url).searchParams.get('key')
    return k ? decodeURIComponent(k) : null
  } catch {
    return null
  }
}

/**
 * Where the copy comes from and what it is called, for one stored picture URL or R2 key.
 * Mirrors atelier-looks derivedKeyFor and scripts/generate-look-derivatives.mjs.
 */
function planFor(key: string | null, url: unknown, width: number): { dk: string; source: string } | null {
  const k = key ?? keyFromProxyUrl(url)
  if (k) {
    if (k.startsWith('derived/')) return null
    return { dk: derivedKey(k, width), source: `r2:${k}` }
  }
  if (typeof url === 'string' && url.startsWith(GOODPIX)) {
    const file = new URL(url).pathname.replace(/^\/+/, '')
    return file ? { dk: derivedKey(`goodpix/${file}`, width), source: url } : null
  }
  return null
}

async function rest(path: string): Promise<any[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (!r.ok) throw new Error(`read ${path.split('?')[0]}: HTTP ${r.status}`)
  return r.json()
}

const inList = (ids: string[]) => `(${ids.map((i) => `"${i.replace(/"/g, '')}"`).join(',')})`

async function resolveTargets(body: any): Promise<{ id: string; dk: string; source: string; width: number }[]> {
  const out: { id: string; dk: string; source: string; width: number }[] = []
  const clean = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x).slice(0, MAX_IDS) : [])
  const lookIds = clean(body.look_ids)
  const itemIds = clean(body.item_ids)
  const intakeIds = clean(body.intake_item_ids)

  if (lookIds.length) {
    const rows = await rest(`gp_looks?select=id,raw&id=in.${inList(lookIds)}`)
    for (const l of rows) {
      const p = planFor(l.raw?.main_image_r2_key ?? null, l.raw?.main_image_url, LOOK_WIDTH)
      if (p) out.push({ id: l.id, ...p, width: LOOK_WIDTH })
    }
  }
  const pieceRows: any[] = []
  const cols = 'id,source,raw,processed_image_hash,primary_image_hash'
  if (itemIds.length) pieceRows.push(...(await rest(`gp_closet_items?select=${cols}&id=in.${inList(itemIds)}`)))
  if (intakeIds.length) pieceRows.push(...(await rest(`gp_closet_items?select=${cols}&intake_item_id=in.${inList(intakeIds)}`)))
  for (const it of pieceRows) {
    // A digitized piece is drawn from its key COLUMNS, not raw (closet.astro), so derive that.
    const key = it.source === 'intake_pipeline' ? it.processed_image_hash ?? it.primary_image_hash ?? null : null
    const url = it.raw?.processed_image ?? it.raw?.image ?? it.raw?.images?.[0] ?? null
    const p = it.source === 'intake_pipeline' ? (key ? planFor(key, null, ITEM_WIDTH) : null) : planFor(null, url, ITEM_WIDTH)
    if (p) out.push({ id: it.id, ...p, width: ITEM_WIDTH })
  }
  const seen = new Set<string>()
  return out.filter((t) => (seen.has(t.dk) ? false : (seen.add(t.dk), true)))
}

const proxyUrl = (key: string) => `${SUPABASE_URL}${PROXY}?key=${encodeURIComponent(key)}`

/** true = the copy is already in R2. The image-proxy answers 404 for a key that is not there. */
async function exists(dk: string): Promise<boolean> {
  const r = await fetch(proxyUrl(dk))
  await r.arrayBuffer().catch(() => null)
  if (r.status === 404) return false
  if (r.ok) return true
  throw new Error(`probe ${dk}: HTTP ${r.status}`)
}

async function sourceBytes(source: string): Promise<Buffer> {
  const url = source.startsWith('r2:') ? proxyUrl(source.slice(3)) : source
  const r = await fetch(url)
  if (!r.ok) throw new Error(`source HTTP ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

async function put(dk: string, jpeg: Buffer): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/upload-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64: jpeg.toString('base64'), content_type: 'image/jpeg', key: dk }),
  })
  if (!r.ok) throw new Error(`upload HTTP ${r.status}`)
}

export default async function handler(req: any, res: any) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'server not configured' })

  const caller = await requireStaff(req, res)
  if (!caller) return

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
    const targets = await resolveTargets(body)
    const results: Record<string, string> = {}
    for (const t of targets) {
      try {
        if (await exists(t.dk)) { results[t.dk] = 'exists'; continue }
        const t0 = Date.now()
        const { buffer, resized } = await makeDerivative(await sourceBytes(t.source), t.width)
        if (await exists(t.dk)) { results[t.dk] = 'exists'; continue } // raced another writer
        await put(t.dk, buffer)
        results[t.dk] = `built ${Math.round(buffer.length / 1024)}KB ${resized ? 'resized' : 'same-size'} ${Date.now() - t0}ms`
      } catch (e) {
        results[t.dk] = `failed: ${e instanceof Error ? e.message : 'error'}`
      }
    }
    console.log('[derive-image]', caller.email, JSON.stringify(results))
    return res.status(200).json({ considered: targets.length, results })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'derive failed' })
  }
}
