// Vercel serverless (Node) — convert ONE HEIC photo to JPEG.
//
// The browser converter (heic2any) is unreliable on some HEIC variants (notably the
// Drive-downloaded files stylists upload), which strands whole batches. The Supabase Edge
// runtime can't convert HEIC either (a 12MP decode OOMs — WORKER_RESOURCE_LIMIT). Node can,
// reliably — so the uploader posts each HEIC here and gets back a JPEG. Same-origin with the
// builder, one photo per request (stays under the serverless body limit).

import convert from 'heic-convert'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default async function handler(req: any, res: any) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v as string))
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  try {
    // Raw HEIC bytes arrive in the request body (sent as application/octet-stream).
    let buf: Buffer
    if (Buffer.isBuffer(req.body)) {
      buf = req.body
    } else if (req.body instanceof Uint8Array) {
      buf = Buffer.from(req.body)
    } else {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      buf = Buffer.concat(chunks)
    }
    if (!buf || buf.byteLength === 0) return res.status(400).json({ error: 'empty body' })

    const jpeg = await convert({ buffer: buf as unknown as ArrayBuffer, format: 'JPEG', quality: 0.85 })
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(Buffer.from(jpeg))
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'HEIC conversion failed' })
  }
}
