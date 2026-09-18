#!/usr/bin/env node
// Dump the builder's conversion of N stored GoodPix layouts to JSON, for the by-hand visual
// fidelity check (scripts/ops/check_goodpix_layout_fidelity.py). Uses the SHIPPED converter.
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const { convertGoodPixLayout, piecesInLayout } = await import('../src/lib/goodpixLayout.ts')
const env = { ...process.env }
for (const f of ['../.env.local', '../.env']) { try { for (const l of readFileSync(new URL(f, import.meta.url), 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '') } } catch {} }
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const N = Number(process.argv[2] ?? 40), OUT = process.argv[3] ?? '/tmp/gp_conv.json'
const { data: looks, error } = await sb.from('gp_looks').select('id, name, closet_item_ids, gp_layout').not('gp_layout', 'is', null).limit(N)
if (error) throw error
const out = []
for (const l of looks) {
  const lay = l.gp_layout
  const ids = [...new Set([...(l.closet_item_ids ?? []), ...(lay.pool ?? []).map((p) => p.id)])]
  const { data: rows } = await sb.from('gp_closet_items').select('id, raw').in('id', ids)
  const extra = new Map((rows ?? []).map((r) => [r.id, [r.raw?.image, r.raw?.processed_image, ...(r.raw?.images ?? [])].filter((u) => typeof u === 'string')]))
  const conv = convertGoodPixLayout(lay, { keep: () => true, extraUrls: extra, mirrorUrl: (k) => `${env.VITE_SUPABASE_URL}/functions/v1/image-proxy?key=${encodeURIComponent(k)}` })
  // The url each closet node would load: the piece's processed image (what resolveClosetImageUrls picks).
  const rowById = new Map((rows ?? []).map((r) => [r.id, r]))
  const urls = {}
  for (const n of conv.canvas.nodes) if (n.type === 'closet_item') { const r = rowById.get(n.closet_item_id); urls[n.id] = r?.raw?.processed_image ?? r?.raw?.image ?? null }
  out.push({ id: l.id, name: l.name, preview: lay.preview_url, canvas: conv.canvas, urls, placed: conv.placed.length, pictures: conv.pictures, texts: conv.texts, skipped: conv.skipped, inPicture: piecesInLayout(lay, extra).length })
}
writeFileSync(OUT, JSON.stringify(out))
console.log(`dumped ${out.length} conversions -> ${OUT}`)
