import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * The per-client "Seasons on her Collection page" switch (Cynthia Dada for Peyton Wheeler,
 * 2026-11-05). The Looks page has its own switch (useLooksSeasons, ADR-0154); this one is for her
 * pieces.
 *
 * Kept in `gp_clients.raw.collection_seasons_on`: nothing rewrites a client's raw after she is
 * created, so it needs no new column. The write keeps every other key in raw, and asks for its row
 * back: a write RLS declines is HTTP 200 with an empty body and no error (ADR-0108).
 *
 * `on` is null until the read lands, so the switch never shows a confident "Off" it has not checked.
 */
export function useCollectionSeasons(clientId: string | null) {
  const [state, setState] = useState<{ id: string | null; on: boolean | null; error: string | null }>({ id: null, on: null, error: null })

  useEffect(() => {
    let live = true
    if (!clientId) return
    supabase.from('gp_clients').select('on:raw->collection_seasons_on').eq('id', clientId).maybeSingle()
      .then(({ data, error: e }) => {
        if (!live) return
        setState(e
          ? { id: clientId, on: null, error: e.message }
          : { id: clientId, on: (data as { on?: unknown } | null)?.on === true, error: null })
      })
    return () => { live = false }
  }, [clientId])

  const setOn = useCallback(async (next: boolean): Promise<boolean> => {
    if (!clientId) return false
    const { data: cur, error: readErr } = await supabase.from('gp_clients').select('raw').eq('id', clientId).maybeSingle()
    if (readErr || !cur) {
      setState((s) => ({ ...s, error: readErr?.message ?? 'The change was not saved.' }))
      return false
    }
    const raw = { ...((cur as { raw?: Record<string, unknown> | null }).raw ?? {}), collection_seasons_on: next }
    const { data, error: e } = await supabase.from('gp_clients')
      .update({ raw }).eq('id', clientId).select('on:raw->collection_seasons_on')
    if (e || !data || data.length === 0) {
      setState((s) => ({ ...s, error: e?.message ?? 'The change was not saved.' }))
      return false
    }
    setState({ id: clientId, on: (data[0] as { on?: unknown }).on === true, error: null })
    return true
  }, [clientId])

  const current = state.id === clientId
  return { on: current ? state.on : null, setOn, error: current ? state.error : null }
}
