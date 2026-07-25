// Vercel serverless (Node) — convert ONE HEIC photo to a downscaled JPEG.
//
// The browser converter (heic2any) is unreliable on some HEIC variants (notably the
// Drive-downloaded files stylists upload), and the Supabase Edge runtime can't convert HEIC
// either (a 12MP decode OOMs — WORKER_RESOURCE_LIMIT). Node can, reliably.
//
// TWO input modes:
//   (1) raw body  (application/octet-stream): the browser posts HEIC bytes directly. Capped at
//       Vercel's ~4.5MB request-body limit — fine for the common small-HEIC case.
//   (2) JSON { url }: the Edge uploader stores the raw HEIC to R2 and passes a short-lived signed
//       URL. We FETCH the bytes server-to-server, which has NO request-body size limit — so HEICs
//       of ANY size convert here. This is the path that fixes the >4.5MB 413 and the flaky-browser
//       failures that were stranding whole batches.
//
// Output is ALWAYS downscaled to <=1600px on the long edge, matching the client invariant so the
// downstream Edge generation step never has to decode a full-res image (which would OOM).

import convert from 'heic-convert'
import sharp from 'sharp'

const MAX_DIM = 1600
const QUALITY = 82

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

async function readRaw(req: any): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body
  if (req.body instanceof Uint8Array) return Buffer.from(req.body)
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

export default async function handler(req: any, res: any) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v as string))
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  try {
    // --- Resolve the source HEIC bytes from whichever mode was used ---
    let heicBuf: Buffer | null = null
    const ctype = String(req.headers['content-type'] || '')

    // Mode 2a: @vercel/node already parsed a JSON body into req.body
    let urlFromJson: string | null = null
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) &&
        !(req.body instanceof Uint8Array) && typeof req.body.url === 'string') {
      urlFromJson = req.body.url
    }
    if (!urlFromJson && ctype.includes('application/json')) {
      // Mode 2b: JSON arrived unparsed as a stream
      const raw = await readRaw(req)
      try { urlFromJson = JSON.parse(raw.toString('utf8'))?.url ?? null } catch { /* fall through */ }
    }

    if (urlFromJson) {
      const r = await fetch(urlFromJson)
      if (!r.ok) return res.status(400).json({ error: `source fetch failed: ${r.status}` })
      heicBuf = Buffer.from(await r.arrayBuffer())
    } else {
      // Mode 1: raw HEIC bytes in the request body
      heicBuf = await readRaw(req)
    }

    if (!heicBuf || heicBuf.byteLength === 0) return res.status(400).json({ error: 'empty body' })

    // --- Convert HEIC -> JPEG (Node, reliable) then downscale to <=1600px ---
    const fullJpeg = Buffer.from(
      await convert({ buffer: heicBuf as unknown as ArrayBuffer, format: 'JPEG', quality: 0.85 }),
    )
    const out = await sharp(fullJpeg)
      .rotate() // honor EXIF orientation before stripping it
      .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: QUALITY })
      .toBuffer()

    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(out)
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'HEIC conversion failed' })
  }
}
