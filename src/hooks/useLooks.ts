import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { styleKeys } from '@/lib/queryClient'
import { supabase } from '@/lib/supabase'
import { clearTransitionBlock, replaceTransitionedLook } from '@/lib/lookTransitions'
import type { LookCanvasState } from '@/types/canvas'
import { storedProxyUrl } from '@/lib/imageUrls'
import { requestDerivatives } from '@/lib/requestDerivatives'
import { authHeader } from '@/lib/authHeader'

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
  to_try_at: string | null
  created_by: string | null
  source: string
  raw: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

function generateLookId(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16)
  return Array.from({ length: 24 }, hex).join('')
}

const NO_LOOKS: LookRow[] = []

export function useLooks(clientId: string | null) {
  // The canvas looks gallery, from the shared Style cache (lib/queryClient.ts). It survives
  // Canvas <-> Categorize switches instead of being re-read on each one. `loading` is only the
  // FIRST read for a client: a refresh after a save keeps the gallery on screen.
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: styleKeys.looks(clientId),
    enabled: !!clientId,
    queryFn: async () => {
      // Read gp_looks base (not the `looks` view) so we can exclude transitioned looks — the view
      // doesn't expose transitioned_at. Same columns; consistent with useLookCategories. (migration 014)
      const { data, error } = await supabase
        .from('gp_looks')
        .select('id, client_id, name, canvas_state, tags, notes_internal, notes_client, created_by, source, raw, created_at, updated_at')
        .eq('client_id', clientId!)
        .eq('source', 'builder')
        .is('transitioned_at', null)
        .order('updated_at', { ascending: false })
      if (error) {
        console.error('useLooks:', error.message)
        throw new Error(error.message || 'load failed')
      }
      return (data ?? []) as LookRow[]
    },
  })
  // A failed read keeps the looks already on screen for THIS client (the cache is per client, so
  // another client's looks can never show under this name) and reports the error, so the gallery
  // says "Couldn't load" with a Retry instead of "No saved looks yet".
  const looks = clientId ? query.data ?? NO_LOOKS : NO_LOOKS
  const loading = !!clientId && query.isLoading
  const error = clientId && query.isError ? (query.error instanceof Error ? query.error.message : 'load failed') : null

  const setLooks = useCallback((update: (prev: LookRow[]) => LookRow[]) => {
    qc.setQueryData<LookRow[]>(styleKeys.looks(clientId), (old) => (old ? update(old) : old))
  }, [qc, clientId])

  // Re-read this client's looks (and Categorize's copy, which lists the same looks) and resolve
  // once the gallery has the fresh list.
  const fetchLooks = useCallback(async () => {
    if (!clientId) return
    await Promise.all([
      qc.invalidateQueries({ queryKey: styleKeys.looks(clientId) }),
      qc.invalidateQueries({ queryKey: styleKeys.lookCategories(clientId) }),
    ])
  }, [qc, clientId])

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
    /** ADR-0153. true marks it as not-yet-tried; false clears it. Undefined leaves it alone. */
    toTry?: boolean
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
          // Signed in, always: upload-image writes any key it is given with the service-role
          // key. It answered anonymous callers until 2026-09-20, so anyone could overwrite any
          // client's photo. The function now refuses a caller it cannot identify.
          headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
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
      // thumbnail_url is no longer written (it held a 2160px base64 JPEG no screen reads). An
      // UPDATE leaves the old value in place; scripts/copy-look-thumbnails.mjs copies those to R2.
      source: 'builder',
      updated_at: new Date().toISOString(),
      closet_item_ids: closetItemIds,
    }

    // Store the R2 key in raw — the lookbook resolves it to a signed URL at render time
    // Also store a direct URL as fallback (works if R2 public domain is configured)
    if (r2ImageKey) {
      row.raw = {
        main_image_r2_key: r2ImageKey,
        main_image_url: storedProxyUrl(r2ImageKey),
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
      ? await supabase.from('looks').insert(row).select('id, client_id, name, canvas_state, tags, notes_internal, notes_client, created_by, source, raw, created_at, updated_at').single()
      : await supabase.from('looks').update(row).eq('id', id).select('id, client_id, name, canvas_state, tags, notes_internal, notes_client, created_by, source, raw, created_at, updated_at').single()

    if (error) {
      console.error('Save look error:', error.message, error.code, error.details, error.hint)
      return { error, data: null }
    }

    // ── To be tried (ADR-0153) ───────────────────────────────────────────────────────────
    // A SECOND, EXPLICIT WRITE TO gp_looks, for the same reason the transition columns need one:
    // useLooks saves through the `looks` VIEW and the view does not expose to_try_at (checked on
    // production 2026-09-24 — it carries notes_client but neither to_try_at nor transitioned_at).
    // Folding it into `row` above would silently drop it.
    //
    // Only written when the caller said something. `undefined` means "leave it alone", so a save
    // from a surface that has no opinion about this cannot clear a stylist's mark.
    if (opts.toTry !== undefined) {
      const { error: tErr } = await supabase
        .from('gp_looks')
        .update({ to_try_at: opts.toTry ? new Date().toISOString() : null })
        .eq('id', id)
        .eq('client_id', opts.clientId)
      if (tErr) console.error('to_try write failed (look saved):', tErr.message)
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

    // Make the small tile copy now (drafts included), not at the next backfill. Fire-and-forget.
    if (r2ImageKey) void requestDerivatives({ look_ids: [id] })

    await fetchLooks()
    return { error: null, data: data as LookRow }
  }, [fetchLooks])

  const deleteLook = useCallback(async (id: string) => {
    const { error } = await supabase.from('looks').delete().eq('id', id)
    if (!error) {
      setLooks((prev) => prev.filter((l) => l.id !== id))
    }
    return { error }
  }, [setLooks])

  return { looks, loading, error, fetchLooks, saveLook, deleteLook }
}
