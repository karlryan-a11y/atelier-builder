import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { LookCanvasState } from '@/types/canvas'

export interface LookRow {
  id: string
  client_id: string
  name: string
  canvas_state: LookCanvasState | null
  thumbnail_url: string | null
  tags: string[] | null
  notes_internal: string | null
  notes_client: string | null
  created_by: string | null
  source: string
  created_at: string
  updated_at: string
}

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
    const { data, error } = await supabase
      .from('looks')
      .select('id, client_id, name, canvas_state, thumbnail_url, tags, notes_internal, notes_client, created_by, source, created_at, updated_at')
      .eq('client_id', clientId)
      .eq('source', 'builder')
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
    clientId: string
    name: string
    canvasState: LookCanvasState
    tags?: string[]
    notesInternal?: string
    notesClient?: string
    thumbnailUrl?: string
    createdBy?: string
  }) => {
    const isNew = !opts.id
    const id = opts.id || generateLookId()

    const row = {
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
      ...(isNew ? {
        created_by: opts.createdBy ?? null,
        raw: {},
        closet_item_ids: opts.canvasState.nodes
          .filter((n) => n.type === 'closet_item')
          .map((n) => (n as { closet_item_id: string }).closet_item_id),
        description: '',
        archived: false,
        total_comments: 0,
      } : {
        closet_item_ids: opts.canvasState.nodes
          .filter((n) => n.type === 'closet_item')
          .map((n) => (n as { closet_item_id: string }).closet_item_id),
      }),
    }

    const { data, error } = isNew
      ? await supabase.from('looks').insert(row).select().single()
      : await supabase.from('looks').update(row).eq('id', id).select().single()

    if (error) {
      console.error('Save look error:', error.message, error.code, error.details, error.hint)
      return { error, data: null }
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
