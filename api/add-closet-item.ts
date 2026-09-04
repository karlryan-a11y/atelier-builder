// Vercel serverless — manual "Add Item" for a client's Collection, as a PROCESS-then-APPROVE flow.
//
// The stylist must SEE the real, processed result (Photoroom-cleaned image + AI metadata) BEFORE it
// goes live — it is not a straight upload. So we work through a hidden DRAFT row:
//
//   1) "prefill"      — base64 image → Claude vision → {name,brand,color,category,material} (best-effort).
//   2) "create-draft" — insert a HIDDEN gp_closet_items row (is_deleted=true) for the client; returns item_id.
//                       (The frontend then runs the EXISTING intake-replace-closet-image Edge fn on that
//                        item_id to Photoroom-clean + store the photo in R2 — identical to every other item.)
//   3) "publish"      — the stylist approved: set the final metadata and flip is_deleted=false → live.
//   4) "discard"      — the stylist cancelled: delete the hidden draft row.
//
// No filename matching anywhere, so it can never mix up; and nothing is visible on the lookbook until
// the stylist explicitly approves what they can see.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY || ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// Same fixed taxonomy the Collection/lookbook uses (categorize.ts) — so the AI only ever suggests a
// real, browsable category. Custom per-client categories are chosen in the UI.
// Canonical palette. Duplicated from src/lib/colorFamily.ts because a Vercel function does not
// share the app's module graph — scripts/check-color-palette.mjs asserts every copy agrees.
const COLOR_ORDER = [
  'Black', 'Grey', 'White', 'Ivory', 'Beige', 'Brown',
  'Red', 'Burgundy', 'Orange', 'Yellow', 'Gold', 'Silver',
  'Pink', 'Blush', 'Purple', 'Lavender',
  'Navy', 'Blue', 'Light Blue', 'Teal', 'Green', 'Olive',
  'Multicolor',
]

const FIXED_CATEGORIES = [
  'dresses', 'tops', 'skirts', 'pants', 'jeans', 'shorts', 'outerwear', 'swim',
  'activewear', 'shoes', 'bags', 'jewelry', 'belts', 'scarves', 'hats', 'sunglasses',
]

const rest = (path: string, init: any) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })

async function prefill(imageDataUri: string) {
  if (!ANTHROPIC_KEY) return {}
  const m = imageDataUri.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i)
  if (!m) return {}
  const media_type = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase()
  const data = m[2]
  const sys =
    'You are cataloguing a single fashion item from its photo for a luxury personal-styling client closet. ' +
    'Return concise, accurate product metadata. For "category" choose the single best-fit slug from ONLY this list: ' +
    FIXED_CATEGORIES.join(', ') + '. ' +
    'For "colors" list EVERY colour you can see, most dominant first, choosing ONLY from this list: ' +
    COLOR_ORDER.join(', ') + '. A print or a piece with several colours gets several entries — do not ' +
    'collapse it to "Multicolor" unless no individual colour reads clearly. "color" stays a free-text ' +
    'description of the exact shade; "colors" is what the client filters by. ' +
    'Respond ONLY as compact JSON: {"name":"<short product name>","brand":"<brand or empty if unreadable>","color":"<primary color>","colors":["<palette colour>"],"category":"<slug>","material":"<material or empty>"}.'
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 200, system: sys,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type, data } },
          { type: 'text', text: 'Extract this item\'s metadata.' },
        ] }],
      }),
    })
    if (!resp.ok) return {}
    const j = await resp.json()
    const txt: string = j?.content?.[0]?.text ?? ''
    const v = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1))
    return {
      name: typeof v.name === 'string' ? v.name.trim() : '',
      brand: typeof v.brand === 'string' ? v.brand.trim() : '',
      color: typeof v.color === 'string' ? v.color.trim() : '',
      // Only palette values survive — a colour no chip carries is a colour nothing can filter by.
      colors: Array.isArray(v.colors)
        ? [...new Set(v.colors.map((c: unknown) => String(c || '').trim()).filter((c: string) => COLOR_ORDER.includes(c)))]
        : [],
      category: typeof v.category === 'string' && FIXED_CATEGORIES.includes(v.category.trim().toLowerCase()) ? v.category.trim().toLowerCase() : '',
      material: typeof v.material === 'string' ? v.material.trim() : '',
    }
  } catch { return {} }
}

async function createDraft(body: any) {
  const clientId = String(body.client_id || '').trim()
  if (!clientId) throw new Error('client_id is required')
  const id = (globalThis.crypto as any).randomUUID()
  const row = {
    id, client_id: clientId, name: '(processing…)', type: 'owned',
    is_deleted: true, // HIDDEN until the stylist approves
    display_order: 0, content_tag_ids: [], custom_categories: [],
    source: 'intake_pipeline', raw: { manual_add: true, draft: true }, added_at: new Date().toISOString(),
  }
  const resp = await rest('gp_closet_items', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) })
  if (!resp.ok) throw new Error(`draft insert failed: ${await resp.text()}`)
  const [created] = await resp.json()
  return { item_id: created?.id ?? id }
}

async function publish(body: any) {
  const id = String(body.item_id || '').trim()
  const name = String(body.name || '').trim()
  if (!id) throw new Error('item_id is required')
  if (!name) throw new Error('name is required')
  const brand = String(body.brand || '').trim() || null
  const color = String(body.color || '').trim() || null
  const category = String(body.category || '').trim().toLowerCase() || null
  const styleNote = String(body.style_note || '').trim() || null
  // The colour SET (ADR-0115), primary first. Palette values only, deduped, empties dropped — the
  // same posture as "Also in" below.
  const colors: string[] = [...new Set(
    (Array.isArray(body.colors) ? body.colors : [])
      .map((c: unknown) => String(c || '').trim())
      .filter(Boolean),
  )] as string[]
  // "Also in" — additional categories beyond the primary garment one. Stored as slugs, deduped, and
  // never carrying the primary itself (garmentCategory.categoriesOf puts the primary first already).
  const customCategories = [...new Set(
    (Array.isArray(body.custom_categories) ? body.custom_categories : [])
      .map((c: unknown) => String(c || '').trim().toLowerCase())
      .filter((c: string) => c && c !== category),
  )]
  const patch = {
    name, brand, color, category, style_note: styleNote,
    custom_categories: customCategories,
    color_family: colors[0] ?? null,
    color_families: colors.slice(1),
    is_deleted: false, // now LIVE
    raw: { item_name: name, brand, color, colors, category, style_note: styleNote, custom_categories: customCategories, manual_add: true },
  }
  const resp = await rest(`gp_closet_items?id=eq.${id}&is_deleted=eq.true`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) })
  if (!resp.ok) throw new Error(`publish failed: ${await resp.text()}`)
  const rows = await resp.json()
  if (!rows.length) throw new Error('draft not found (already published or discarded)')
  return { item_id: id, live: true }
}

async function discard(body: any) {
  const id = String(body.item_id || '').trim()
  if (!id) throw new Error('item_id is required')
  // Only ever delete a still-hidden draft — never a live item.
  const resp = await rest(`gp_closet_items?id=eq.${id}&is_deleted=eq.true`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
  if (!resp.ok) throw new Error(`discard failed: ${await resp.text()}`)
  return { discarded: true }
}

export default async function handler(req: any, res: any) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v as string))
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'server not configured' })
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    switch (body.action) {
      case 'prefill':      return res.status(200).json({ ok: true, fields: await prefill(String(body.image || '')) })
      case 'create-draft': return res.status(200).json({ ok: true, ...(await createDraft(body)) })
      case 'publish':      return res.status(200).json({ ok: true, ...(await publish(body)) })
      case 'discard':      return res.status(200).json({ ok: true, ...(await discard(body)) })
      default:             return res.status(400).json({ error: 'unknown action' })
    }
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'failed' })
  }
}
