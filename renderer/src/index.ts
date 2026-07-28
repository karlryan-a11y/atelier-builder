// The always-on renderer box. Exposes POST /regenerate — the builder pings it after a stylist
// swaps an item photo, and it re-bakes every affected look + capsule hero via a headless browser.
import express, { type Request, type Response } from 'express'
import { env } from './env.js'
import { verifyCaller } from './supabase.js'
import { regenerate } from './regenerate.js'
import { warmUp, shutdown } from './browser.js'

const app = express()
app.use(express.json({ limit: '2mb' }))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.post('/regenerate', async (req: Request, res: Response) => {
  // Auth: a trusted server may present the shared secret; otherwise require a valid builder JWT.
  const secret = req.header('x-renderer-secret')
  const trusted = !!env.RENDERER_SHARED_SECRET && secret === env.RENDERER_SHARED_SECRET
  if (!trusted) {
    const auth = req.header('authorization') ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const userId = token ? await verifyCaller(token) : null
    if (!userId) return res.status(401).json({ ok: false, error: 'unauthorized' })
  }

  const body = req.body as { item_ids?: unknown; item_id?: unknown }
  const ids = Array.isArray(body.item_ids)
    ? body.item_ids.filter((x): x is string => typeof x === 'string')
    : typeof body.item_id === 'string'
      ? [body.item_id]
      : []
  if (ids.length === 0) return res.status(400).json({ ok: false, error: 'item_ids required' })

  try {
    const summary = await regenerate(ids)
    return res.json({ ok: true, ...summary })
  } catch (err) {
    console.error('[regenerate] fatal', err)
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'render failed' })
  }
})

const server = app.listen(env.PORT, () => {
  console.log(`atelier-renderer listening on :${env.PORT} → ${env.ATELIER_RENDER_URL}`)
  // Warm the browser + render page so the first real request isn't a cold start.
  warmUp().catch((err) => console.warn('warmUp failed (will retry lazily):', err))
})

async function stop(signal: string) {
  console.log(`\n${signal} — shutting down`)
  server.close()
  await shutdown()
  process.exit(0)
}
process.on('SIGTERM', () => void stop('SIGTERM'))
process.on('SIGINT', () => void stop('SIGINT'))
