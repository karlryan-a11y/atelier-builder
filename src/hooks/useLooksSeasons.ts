import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * The per-client "Seasons on her Looks page" switch. ADR-0154.
 *
 * Read on its own rather than widened into the client store's SELECT: a column left out of a
 * SELECT answers with undefined (ADR-0103), and this is the only surface that needs it.
 *
 * `on` is null until the read lands, so the switch never shows a confident "Off" it has not
 * checked. The write asks for its row back: a write RLS declines is HTTP 200 with an empty body
 * and no error (ADR-0108), and a switch that silently did not switch is the worst kind.
 */
export function useLooksSeasons(clientId: string | null) {
  // Keyed by client, so switching clients shows "…" (null) until THAT client's read lands,
  // without resetting state inside the effect.
  const [state, setState] = useState<{ id: string | null; on: boolean | null; error: string | null }>({ id: null, on: null, error: null })

  useEffect(() => {
    let live = true
    if (!clientId) return
    supabase.from('gp_clients').select('looks_seasons_on').eq('id', clientId).maybeSingle()
      .then(({ data, error: e }) => {
        if (!live) return
        setState(e
          ? { id: clientId, on: null, error: e.message }
          : { id: clientId, on: !!(data as { looks_seasons_on?: boolean } | null)?.looks_seasons_on, error: null })
      })
    return () => { live = false }
  }, [clientId])

  const setOn = useCallback(async (next: boolean): Promise<boolean> => {
    if (!clientId) return false
    const { data, error: e } = await supabase.from('gp_clients')
      .update({ looks_seasons_on: next }).eq('id', clientId).select('looks_seasons_on')
    if (e || !data || data.length === 0) {
      setState((s) => ({ ...s, error: e?.message ?? 'The change was not saved.' }))
      return false
    }
    setState({ id: clientId, on: !!(data[0] as { looks_seasons_on: boolean }).looks_seasons_on, error: null })
    return true
  }, [clientId])

  const current = state.id === clientId
  return { on: current ? state.on : null, setOn, error: current ? state.error : null }
}
