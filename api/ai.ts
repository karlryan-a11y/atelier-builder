// Server-side Claude call for the builder.
//
// The browser used to talk to Anthropic directly (src/lib/compose.ts held an Anthropic client with
// dangerouslyAllowBrowser and VITE_ANTHROPIC_API_KEY). A VITE_ value is compiled INTO the bundle,
// so the key shipped to every visitor of /style in plain text and could be read with a text search.
// Browser code is public by definition, so the key moves here and the browser asks us instead.
//
// This endpoint is NOT an open relay: the caller must be a signed-in team member, the model is
// restricted to the two we use, and max_tokens is capped, so a leaked URL cannot become free AI.

import { requireStaff } from './_staff.js'

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || ''
const ALLOWED_MODELS = new Set(['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'])
const MAX_TOKENS_CAP = 4096

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

  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'server not configured' })

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
    const model = String(body.model || 'claude-haiku-4-5-20251001')
    if (!ALLOWED_MODELS.has(model)) return res.status(400).json({ error: 'model not allowed' })

    const max_tokens = Math.min(Number(body.max_tokens) || 1024, MAX_TOKENS_CAP)
    const messages = Array.isArray(body.messages) ? body.messages : null
    if (!messages || messages.length === 0) return res.status(400).json({ error: 'messages required' })

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens,
        ...(body.system ? { system: String(body.system) } : {}),
        messages,
      }),
    })

    const text = await upstream.text()
    if (!upstream.ok) {
      // Never pass an upstream body through untouched: it can echo request headers.
      return res.status(upstream.status === 401 ? 500 : upstream.status).json({
        error: 'ai request failed',
        status: upstream.status,
      })
    }
    res.setHeader('Content-Type', 'application/json')
    return res.status(200).send(text)
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'failed' })
  }
}
