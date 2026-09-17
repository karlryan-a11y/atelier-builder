// Server-side text embedding for the builder's search.
//
// src/lib/search.ts used to build an OpenAI client in the browser with dangerouslyAllowBrowser and
// VITE_OPENAI_API_KEY - the same mistake as the Anthropic key, which shipped in the public bundle.
// (That value happens to be unset in production today, so semantic search has been silently falling
// back to text search; fixing the key will also fix the feature.) Signed-in team members only.

import { requireStaff } from './_staff.js'

const OPENAI_KEY = process.env.OPENAI_API_KEY || ''
const MODEL = 'text-embedding-3-small'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export default async function handler(req: any, res: any) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v as string))
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const caller = await requireStaff(req, res)
  if (!caller) return

  // No key configured: say so plainly. The caller falls back to text search rather than breaking.
  if (!OPENAI_KEY) return res.status(501).json({ error: 'embeddings not configured' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
    const input = String(body.input || '').slice(0, 8000)
    if (!input) return res.status(400).json({ error: 'input required' })

    const upstream = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, input }),
    })
    if (!upstream.ok) return res.status(502).json({ error: 'embedding request failed', status: upstream.status })

    const json = await upstream.json()
    const embedding = json?.data?.[0]?.embedding
    if (!Array.isArray(embedding)) return res.status(502).json({ error: 'no embedding returned' })
    return res.status(200).json({ embedding })
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'failed' })
  }
}
