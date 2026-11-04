import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { savedCustomHeading, withCustomHeading } from '@/lib/customHeading'

/**
 * The per-client name for the "Custom" heading on her Collection (lib/customHeading.ts).
 *
 * `name` is null until the read lands, and '' when she still gets "Custom". The write reads her
 * raw fresh and changes only this one key, then asks for the row back: a write RLS declines is
 * HTTP 200 with an empty body (ADR-0108), so an empty answer is reported, never shown as saved.
 */
export function useCustomHeading(clientId: string | null) {
  const [state, setState] = useState<{ id: string | null; name: string | null; error: string | null }>({ id: null, name: null, error: null })

  useEffect(() => {
    let live = true
    if (!clientId) return
    supabase.from('gp_clients').select('raw').eq('id', clientId).maybeSingle()
      .then(({ data, error: e }) => {
        if (!live) return
        setState(e
          ? { id: clientId, name: null, error: e.message }
          : { id: clientId, name: savedCustomHeading((data as { raw?: unknown } | null)?.raw), error: null })
      })
    return () => { live = false }
  }, [clientId])

  const save = useCallback(async (next: string): Promise<boolean> => {
    if (!clientId) return false
    const { data: row, error: rErr } = await supabase.from('gp_clients').select('raw').eq('id', clientId).single()
    if (rErr || !row) {
      setState((s) => ({ ...s, error: rErr?.message ?? 'The change was not saved.' }))
      return false
    }
    const { data, error: e } = await supabase.from('gp_clients')
      .update({ raw: withCustomHeading(row.raw, next) }).eq('id', clientId).select('raw')
    if (e || !data || data.length === 0) {
      setState((s) => ({ ...s, error: e?.message ?? 'The change was not saved.' }))
      return false
    }
    setState({ id: clientId, name: savedCustomHeading((data[0] as { raw?: unknown }).raw), error: null })
    return true
  }, [clientId])

  const current = state.id === clientId
  return { name: current ? state.name : null, save, error: current ? state.error : null }
}
