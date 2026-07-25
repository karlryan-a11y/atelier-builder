import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { ReconRow } from '@/lib/reconcile'
import type { UploadedFingerprint } from '@/lib/driveReconcile'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const proxy = (key: string) =>
  `${SUPABASE_URL}/functions/v1/image-proxy?key=${encodeURIComponent(key)}`

export interface IngestedPhoto {
  r2_key: string
  /** The original filename as uploaded (intake_photos.original_filename) — preserved through
   *  HEIC→JPEG conversion, so it's the RELIABLE key to match a Drive folder against. */
  filename: string | null
  size: number | null
  driveFileId: string | null
  status: 'approved' | 'pending' | 'rejected' | 'unused'
  /** The intake_item this photo belongs to (best-status item if it serves several) — so the
   *  audit can count DISTINCT items, not photos (each item has multiple photos). */
  itemId: string | null
}

// The RELIABLE record for the missing-photo audit: every photo ever ingested for this client
// (intake_photos — 100% populated with original_filename), tagged with whether its item made it
// into the collection. We deliberately do NOT use the closet items' garment/tag keys: early
// uploads (pre-confirm-board) were mis-paired, and many items have no tag key. intake_photos is
// the ground truth — independent of pairing/labeling/approval.
// PostgREST caps any single query at 1000 rows, so a batch chunk that holds >1000 photos
// silently truncates — and every dropped photo's filename then reads as "never uploaded".
// We page through each chunk with .range() until it's exhausted, so we get EVERY row.
async function fetchAllByBatch<T>(table: string, columns: string, batchIds: string[]): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let i = 0; i < batchIds.length; i += 40) {
    const chunk = batchIds.slice(i, i + 40)
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from(table).select(columns).in('batch_id', chunk).range(from, from + PAGE - 1)
      if (error) { console.error(`fetchAllByBatch ${table}:`, error.message); break }
      out.push(...((data ?? []) as T[]))
      if (!data || data.length < PAGE) break
    }
  }
  return out
}

export async function fetchIngestedPhotos(clientId: string): Promise<IngestedPhoto[]> {
  const { data: batches } = await supabase.from('intake_batches').select('id').eq('client_id', clientId)
  const batchIds = (batches ?? []).map((b: { id: string }) => b.id)
  if (batchIds.length === 0) return []

  const photoStatus = new Map<string, string>() // intake_photo id → best item status it belongs to
  const photoItem = new Map<string, string>()   // intake_photo id → that best-status item's id
  const rank = (s: string) => (s === 'approved' ? 3 : s === 'rejected_final' ? 1 : s ? 2 : 0)

  const [ph, items] = await Promise.all([
    fetchAllByBatch<any>('intake_photos', 'id, r2_key, original_filename, file_size_bytes, drive_file_id', batchIds),
    fetchAllByBatch<any>('intake_items', 'id, garment_photo_id, tag_photo_id, status', batchIds),
  ])
  const photos = ph
    .filter((p) => p.r2_key)
    .map((p) => ({ id: p.id, r2_key: p.r2_key, filename: p.original_filename ?? null, size: p.file_size_bytes ?? null, driveFileId: p.drive_file_id ?? null }))
  for (const it of items) {
    const s = it.status as string
    for (const pid of [it.garment_photo_id, it.tag_photo_id]) {
      if (!pid) continue
      const cur = photoStatus.get(pid)
      if (cur === undefined || rank(s) > rank(cur)) { photoStatus.set(pid, s); photoItem.set(pid, it.id) }
    }
  }
  const norm = (s?: string): IngestedPhoto['status'] =>
    s === 'approved' ? 'approved' : s === 'rejected_final' ? 'rejected' : s ? 'pending' : 'unused'
  return photos.map((p) => ({ r2_key: p.r2_key, filename: p.filename, size: p.size, driveFileId: p.driveFileId, status: norm(photoStatus.get(p.id)), itemId: photoItem.get(p.id) ?? null }))
}

// Every photo this client ever had ingested — filename + byte-size + EXIF capture time —
// for the Google Drive drop-check to diff a Drive folder against. Spans ALL their batches
// (every folder they were uploaded from), so a Drive file matches if it was ingested at
// any point, regardless of which batch.
export async function fetchUploadedFingerprints(clientId: string): Promise<UploadedFingerprint[]> {
  const { data: batches } = await supabase
    .from('intake_batches').select('id').eq('client_id', clientId)
  const batchIds = (batches ?? []).map((b: { id: string }) => b.id)
  if (batchIds.length === 0) return []

  // Paginated read (PostgREST caps at 1000 rows/query) so we get EVERY photo, not a truncated
  // 1000 — a truncated set silently flags real uploads as "never uploaded".
  const rows = await fetchAllByBatch<any>('intake_photos', 'original_filename, file_size_bytes, exif_timestamp, drive_file_id', batchIds)
  return rows.map((p) => ({
    driveFileId: p.drive_file_id ?? null,
    filename: p.original_filename ?? null,
    size: p.file_size_bytes ?? null,
    captureTime: p.exif_timestamp ?? null,
  }))
}

// Loads a client's LIVE collection with the full provenance needed to reconcile:
// the original uploaded photo (original_garment_photo_r2_key — the Google Drive file)
// next to the AI photo that's live on the lookbook (processed_image_hash), plus the
// intake_item_id link used for duplicate detection + metadata recovery.
//
// GoodPix items carry no R2 keys — their image lives in raw.image. They have no
// "uploaded original" (they came from the client's GoodPix wardrobe, not our upload),
// so originalUrl is null and they surface as source='goodpix' in the audit.
export function useReconciliation(clientId: string | null) {
  const [rows, setRows] = useState<ReconRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  // A refetch() after an edit/confirm/merge is a BACKGROUND refresh — it must NOT flip
  // `loading`, or the panel swaps to its "Loading…" state, the list unmounts/remounts, and
  // the stylist gets bounced to the top mid-categorizing (same bug we fixed for the inbox).
  const bg = useRef(false)

  useEffect(() => {
    if (!clientId) { setRows([]); return }
    let cancelled = false
    const background = bg.current
    bg.current = false
    if (!background) setLoading(true)
    setError(null)

    async function load() {
      const { data, error: qErr } = await supabase
        .from('gp_closet_items')
        .select('id, client_id, name, name_override, brand, category, color, style_note, source, raw, primary_image_hash, processed_image_hash, original_garment_photo_r2_key, original_tag_photo_r2_key, intake_item_id, added_at')
        .eq('client_id', clientId)
        .eq('is_deleted', false)
        .order('added_at', { ascending: false, nullsFirst: false })

      if (cancelled) return
      if (qErr) {
        // Never collapse a failed query into "clean / empty" — surface it (ADR-0036 lesson).
        console.error('useReconciliation: query failed —', qErr.message)
        setError(qErr.message); setRows([]); setLoading(false); return
      }

      const mapped: ReconRow[] = (data ?? []).map((d: any) => {
        const raw = (d.raw ?? {}) as Record<string, unknown>
        // raw.description is NOT reliably a string: GoodPix items store it as an array
        // (often empty). Coerce to string-or-null so nothing downstream calls .trim on a
        // non-string (that crash white-screened the Audit tab, 2026-06-26).
        const rawDesc = raw.description
        const description =
          typeof rawDesc === 'string' ? rawDesc
          : Array.isArray(rawDesc) ? (rawDesc.filter((x) => typeof x === 'string').join(' ').trim() || null)
          : null
        // Original = the uploaded Drive photo. Prefer the explicit original key; for older
        // intake rows that only kept primary_image_hash, fall back to it.
        const origKey = d.original_garment_photo_r2_key ?? (d.source === 'intake_pipeline' ? d.primary_image_hash : null)
        const originalUrl = origKey ? proxy(origKey) : null
        // Live = what the lookbook renders now. Intake → proxied AI photo; GoodPix → raw.image.
        const liveKey = d.processed_image_hash ?? d.primary_image_hash
        const liveUrl = d.source === 'intake_pipeline' && liveKey
          ? proxy(liveKey)
          : (raw.processed_image as string) ?? (raw.image as string) ?? (Array.isArray(raw.images) ? (raw.images[0] as string) : null) ?? null
        return {
          id: d.id,
          client_id: d.client_id,
          name: d.name ?? '',
          name_override: d.name_override ?? null,
          brand: d.brand ?? null,
          category: d.category ?? null,
          color: d.color ?? null,
          style_note: typeof d.style_note === 'string' ? d.style_note : null,
          description,
          source: d.source ?? null,
          intake_item_id: d.intake_item_id ?? null,
          original_garment_photo_r2_key: d.original_garment_photo_r2_key ?? null,
          original_tag_photo_r2_key: d.original_tag_photo_r2_key ?? null,
          primary_image_hash: d.primary_image_hash ?? null,
          processed_image_hash: d.processed_image_hash ?? null,
          raw,
          added_at: d.added_at ?? null,
          reconciled_at: (raw.reconciled_at as string) ?? null,
          originalUrl,
          liveUrl,
        }
      })

      if (!cancelled) { setRows(mapped); setLoading(false) }
    }

    load()
    return () => { cancelled = true }
  }, [clientId, tick])

  return { rows, loading, error, refetch: () => { bg.current = true; setTick((t) => t + 1) } }
}
