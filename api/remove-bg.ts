// Vercel serverless: Remove BG on one piece, checked before it is kept, and its one-tap undo.
//
// WHY. Remove BG (the intake-remove-bg-item function: Photoroom, then a colour strip) saves its
// result straight onto the piece, which replaces the photo in the builder, the lookbook and every
// look. On Mr. C's white pinstripe Dior shirt (Cynthia, 10/14) it kept only the stripes, and the
// only fix was to upload a new photo. Every Remove BG in the builder (Edit dialog, bulk, canvas,
// Reconciliation) now comes through here:
//   { action: 'remove', item_id, image_url }  runs the remover, looks at the result with
//       lib/cutoutCheck.mjs, and if it cut into the piece puts the earlier photo straight back
//       (within seconds; nothing re-bakes a look in between, since heroes refresh only on success)
//       and answers { ok: false, damaged: true, reason } in plain words. The photo is unchanged.
//   { action: 'undo', item_id }  puts back the photo from right before the last Remove BG
//       (raw.bg_backup, set here after every kept cutout) and keeps the cutout in bg_undone.
//
// Reads and writes go out with the CALLER's sign-in, so the database's own rules decide which
// pieces she may touch: a stylist limited to some clients cannot reach anyone else's piece.

import { requireStaff } from './_staff.js'
import { judgeCutout, DAMAGED_REASON } from '../lib/cutoutCheck.mjs'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const PROXY = '/functions/v1/image-proxy'
const NOBG = 'closet/nobg/'
const COLS = 'id,client_id,name,name_override,category,raw,primary_image_hash,processed_image_hash'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// The remover can take 20 s on a large photo; the check adds about one.
export const config = { maxDuration: 60 }

const proxyUrl = (key: string) => `${SUPABASE_URL}${PROXY}?key=${encodeURIComponent(key)}`

function bearer(req: any): string {
  const m = /^Bearer\s+(.+)$/i.exec(String(req?.headers?.authorization || ''))
  return m ? m[1].trim() : ''
}

/** The piece as the caller is allowed to see it, or null. */
async function readItem(token: string, id: string): Promise<any | null> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gp_closet_items?select=${COLS}&id=eq.${encodeURIComponent(id)}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  })
  if (!r.ok) throw new Error(`read piece: HTTP ${r.status}`)
  const rows = await r.json()
  return Array.isArray(rows) && rows.length ? rows[0] : null
}

/** Write the piece's photo fields as the caller. A write the rules decline comes back empty. */
async function writeItem(token: string, id: string, patch: Record<string, unknown>): Promise<boolean> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gp_closet_items?id=eq.${encodeURIComponent(id)}&select=id`, {
    method: 'PATCH',
    headers: {
      apikey: ANON_KEY, Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  })
  if (!r.ok) return false
  const rows = await r.json().catch(() => [])
  return Array.isArray(rows) && rows.length === 1
}

async function bytes(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null
  try {
    const r = await fetch(url)
    return r.ok ? Buffer.from(await r.arrayBuffer()) : null
  } catch {
    return null
  }
}

/** The photo fields exactly as they are now (what the remover overwrites; raw.image it leaves). */
const photoOf = (item: any) => ({
  image: item.raw?.image ?? null,
  processed_image: item.raw?.processed_image ?? null,
  primary_image_hash: item.primary_image_hash ?? null,
  processed_image_hash: item.processed_image_hash ?? null,
})

/** A patch that puts `photo` on the piece, keeping `backup` in raw.bg_backup (none: no backup). */
function patchFor(item: any, photo: ReturnType<typeof photoOf>, backup: unknown) {
  const raw = { ...(item.raw || {}), bg_backup: backup }
  if (!backup) delete raw.bg_backup
  if (photo.processed_image) raw.processed_image = photo.processed_image
  else delete raw.processed_image
  return { raw, primary_image_hash: photo.primary_image_hash, processed_image_hash: photo.processed_image_hash }
}

/**
 * Branch previews only, never live: { practice_cutout: 'closet/nobg/...' } stands in a damaged
 * cutout the remover really made (it does so when Photoroom is unavailable and its colour method
 * takes over, which a test cannot cause), so the refusal can be walked end to end before GO.
 */
const practiceCutout = (body: any): string | null =>
  process.env.VERCEL_ENV === 'preview' && typeof body?.practice_cutout === 'string' && body.practice_cutout.startsWith(NOBG)
    ? body.practice_cutout : null

async function removeBg(token: string, item: any, imageUrl: string, res: any, practice: string | null) {
  const before = photoOf(item)
  // The stored photo, never an address from the browser.
  const beforeBytes = await bytes(before.processed_image_hash ? proxyUrl(before.processed_image_hash) : before.processed_image || before.image)

  const r = await fetch(`${SUPABASE_URL}/functions/v1/intake-remove-bg-item`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: item.id, image_url: imageUrl }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d?.ok) return res.status(200).json({ ok: false, reason: d?.reason || d?.error || 'Could not remove the background.' })
  if (practice) {
    const saved = await readItem(token, item.id)
    const raw = { ...(saved?.raw || {}), processed_image: proxyUrl(practice) }
    await writeItem(token, item.id, { raw, primary_image_hash: practice, processed_image_hash: practice })
    d.url = proxyUrl(practice)
  }

  const after = await readItem(token, item.id)
  const afterBytes = await bytes(d.url) ?? await bytes(after?.processed_image_hash ? proxyUrl(after.processed_image_hash) : null)
  const verdict = afterBytes
    ? await judgeCutout(afterBytes, beforeBytes, { category: item.category, name: item.name_override || item.name || item.raw?.item_name })
    : { ok: false, reason: DAMAGED_REASON, holes: null, drop: null, area: null, thin: false }
  console.log('[remove-bg]', item.id, JSON.stringify({ ...verdict, reason: undefined }))
  if (verdict.ok) {
    // Undo goes back exactly one step. The remover writes bg_backup only when the piece has none,
    // so after a Replace photo (or an earlier Undo) its backup is an older photo: record the photo
    // from right before this Remove BG instead, keeping the remover's first one in bg_original.
    if (after) {
      const raw = { ...(after.raw || {}), bg_backup: before }
      if (after.raw?.bg_backup && !after.raw?.bg_original) raw.bg_original = after.raw.bg_backup
      await writeItem(token, item.id, { raw })
    }
    return res.status(200).json({ ...d, ok: true, check: verdict })
  }

  // It cut into the piece: put the photo from before straight back, with the backup it had, so the
  // piece is exactly as it was (its own Undo, if it had one, still goes to the right photo).
  const restored = await writeItem(token, item.id, patchFor(after || item, before, item.raw?.bg_backup ?? null))
  // `cutout` is the refused picture, for the team to look at; it is no longer on the piece.
  return res.status(200).json({ ok: false, damaged: true, restored, reason: DAMAGED_REASON, check: verdict, cutout: d.url ?? null })
}

async function undo(token: string, item: any, res: any) {
  const backup = item.raw?.bg_backup
  if (!backup || !String(item.processed_image_hash || '').startsWith(NOBG)) {
    return res.status(200).json({ ok: false, reason: 'There is no earlier photo to put back.' })
  }
  const previous = {
    image: item.raw?.image ?? null, // the remover never changes raw.image
    processed_image: backup.processed_image ?? null,
    primary_image_hash: backup.primary_image_hash ?? null,
    processed_image_hash: backup.processed_image_hash ?? null,
  }
  // The backup is used up (a second tap has nothing earlier to go to); the cutout it replaces is
  // kept in bg_undone, so nothing is lost.
  const patch = patchFor(item, previous, null)
  patch.raw.bg_undone = photoOf(item)
  const ok = await writeItem(token, item.id, patch)
  if (!ok) return res.status(200).json({ ok: false, reason: 'Could not put the earlier photo back. Try again.' })
  return res.status(200).json({ ok: true })
}

export default async function handler(req: any, res: any) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  if (!SUPABASE_URL || !ANON_KEY) return res.status(500).json({ error: 'server not configured' })

  const caller = await requireStaff(req, res)
  if (!caller) return

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
    const id = typeof body.item_id === 'string' ? body.item_id : ''
    if (!id) return res.status(400).json({ error: 'item_id required' })
    const token = bearer(req)
    const item = await readItem(token, id)
    if (!item) return res.status(404).json({ ok: false, reason: 'This piece could not be found.' })
    if (body.action === 'undo') return await undo(token, item, res)
    return await removeBg(token, item, typeof body.image_url === 'string' ? body.image_url : '', res, practiceCutout(body))
  } catch (e) {
    return res.status(500).json({ ok: false, reason: 'Could not remove the background. Try again.', error: e instanceof Error ? e.message : 'failed' })
  }
}
