import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { clearTransitionBlock, replaceTransitionedLook } from '@/lib/lookTransitions'
import type { LookCanvasState } from '@/types/canvas'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

export interface LookRow {
  id: string
  client_id: string
  name: string
  canvas_state: LookCanvasState | null
  // thumbnail_url is deliberately NOT here: it is a base64 2160x2160 JPEG, ~400 KB a look, and
  // selecting it made this list ~50 MB for Danielle York. Show a look with lookImageUrl(raw).
  tags: string[] | null
  notes_internal: string | null
  notes_client: string | null
  created_by: string | null
  source: string
  raw: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

/** Every column LookRow declares, and nothing else. Used by the list read AND the save's
 *  returned row, so the two can never disagree about what a LookRow carries. */
const LOOK_COLUMNS = 'id, client_id, name, canvas_state, tags, notes_internal, notes_client, created_by, source, raw, created_at, updated_at'

function generateLookId(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16)
  return Array.from({ length: 24 }, hex).join('')
}

export function useLooks(clientId: string | null) {
  const [looks, setLooks] = useState<LookRow[]>([])
  const [loading, setLoading] = useState(false)

  const fetchLooks = useCallback(async () => {
    if (!clientId) {
      setLooks([])
      return
    }
    setLoading(true)
    // Read gp_looks base (not the `looks` view) so we can exclude transitioned looks — the view
    // doesn't expose transitioned_at. Same columns; consistent with useLookCategories. (migration 014)
    const { data, error } = await supabase
      .from('gp_looks')
      .select(LOOK_COLUMNS)
      .eq('client_id', clientId)
      .eq('source', 'builder')
      .is('transitioned_at', null)
      .order('updated_at', { ascending: false })

    if (!error && data) {
      setLooks(data as LookRow[])
    }
    setLoading(false)
  }, [clientId])

  useEffect(() => {
    fetchLooks()
  }, [fetchLooks])

  const saveLook = useCallback(async (opts: {
    id?: string
    /**
     * Set when this save is a rebuilt replacement for a TRANSITIONED GoodPix look. The new row
     * takes the original's place (published state, order, filing) and the original is archived
     * out of the Transitions queue. See lib/lookTransitions.ts + ADR-0076.
     */
    replacesLookId?: string
    /**
     * The OTHER pulled looks this one rebuild also answers — duplicates of `replacesLookId` on
     * the same GoodPix board, shown to the stylist as a single card. They retire with it, or the
     * twin sits in her queue tomorrow asking for work she has already done.
     */
    replacesSiblingLookIds?: string[]
    clientId: string
    name: string
    canvasState: LookCanvasState
    tags?: string[]
    notesInternal?: string
    notesClient?: string
    thumbnailUrl?: string
    imageBase64?: string  // High-res canvas render (PNG base64, no data: prefix)
    createdBy?: string
  }) => {
    const isNew = !opts.id
    const id = opts.id || generateLookId()

    // Upload high-res look image to R2 if provided
    let r2ImageKey: string | null = null
    if (opts.imageBase64) {
      try {
        const key = `looks/${id}/image-${Date.now()}.png`
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/upload-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            base64: opts.imageBase64,
            content_type: 'image/png',
            key,
          }),
        })
        if (resp.ok) {
          r2ImageKey = key
        }
      } catch (err) {
        console.error('Failed to upload look image:', err)
      }
    }

    const closetItemIds = opts.canvasState.nodes
      .filter((n) => n.type === 'closet_item')
      .map((n) => (n as { closet_item_id: string }).closet_item_id)

    const row: Record<string, unknown> = {
      id,
      client_id: opts.clientId,
      name: opts.name,
      canvas_state: opts.canvasState,
      tags: opts.tags ?? [],
      notes_internal: opts.notesInternal ?? null,
      notes_client: opts.notesClient ?? null,
      thumbnail_url: opts.thumbnailUrl ?? null,
      source: 'builder',
      updated_at: new Date().toISOString(),
      closet_item_ids: closetItemIds,
    }

    // Store the R2 key in raw — the lookbook resolves it to a signed URL at render time
    // Also store a direct URL as fallback (works if R2 public domain is configured)
    if (r2ImageKey) {
      row.raw = {
        main_image_r2_key: r2ImageKey,
        main_image_url: `${SUPABASE_URL}/functions/v1/image-proxy?key=${encodeURIComponent(r2ImageKey)}`,
      }
    }

    if (isNew) {
      row.created_by = opts.createdBy ?? null
      if (!row.raw) row.raw = {}
      row.description = ''
      row.archived = false
      row.total_comments = 0
      // WHEN THIS LOOK WAS MADE. gp_looks.created_at has no database default and this insert
      // never set it, so every one of the 497 looks ever built in Atelier carried NULL --
      // measured on production 2026-09-10. The client's gallery breaks ties on this column, and
      // a null tiebreaker is worse than none on a paged page: an ambiguous total order makes
      // .range() skip and repeat rows between pages. The GoodPix scraper writes the real
      // GoodPix date here, so both sources now mean the same thing. (ADR-0121)
      row.created_at = new Date().toISOString()
    }

    const { data, error } = isNew
      ? await supabase.from('looks').insert(row).select(LOOK_COLUMNS).single()
      : await supabase.from('looks').update(row).eq('id', id).select(LOOK_COLUMNS).single()

    if (error) {
      console.error('Save look error:', error.message, error.code, error.details, error.hint)
      return { error, data: null }
    }

    // ── Bring the look back if this save fixed a transition (migration 014) ──────────────
    // Both writes go straight to gp_looks: the `looks` view we just saved through does not
    // expose transitioned_at. Never fatal — the look IS saved, and failing here must not read
    // to the stylist as a lost restyle. See lib/lookTransitions.ts.
    try {
      if (opts.replacesLookId) {
        // Rebuilt GoodPix look: the new row takes the original's place, the original retires.
        await replaceTransitionedLook(opts.replacesLookId, id, opts.clientId, opts.replacesSiblingLookIds ?? [])
      } else if (!isNew) {
        // Restyled builder look: drop any cause it no longer contains; returns on its own
        // once the last one is gone.
        await clearTransitionBlock(id, opts.clientId, closetItemIds)
      }
    } catch (e) {
      console.error('Transition republish failed (look saved):', e)
    }

    await fetchLooks()
    return { error: null, data: data as LookRow }
  }, [fetchLooks])

  const deleteLook = useCallback(async (id: string) => {
    const { error } = await supabase.from('looks').delete().eq('id', id)
    if (!error) {
      setLooks((prev) => prev.filter((l) => l.id !== id))
    }
    return { error }
  }, [])

  return { looks, loading, fetchLooks, saveLook, deleteLook }
}
