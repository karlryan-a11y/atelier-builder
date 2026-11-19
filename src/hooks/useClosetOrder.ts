import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { savedClosetOrder, withClosetOrder } from '@/lib/closetArrangement'

/**
 * The order the stylist dragged her Collection into (lib/closetArrangement.ts), kept in her own
 * gp_clients.raw.closet_order, which her lookbook reads too.
 *
 * `order` is [] until she drags (Atelier's own order: newest first, each suit's pieces together).
 * A drag shows at once; the write reads her raw fresh, changes only this one key and asks for the
 * row back: a write RLS declines is HTTP 200 with an empty body (ADR-0108), so an empty answer puts
 * the old order back and says so, never shows as saved.
 */
export function useClosetOrder(clientId: string | null) {
  const [state, setState] = useState<{ id: string | null; order: string[]; error: string | null }>({ id: null, order: [], error: null })

  useEffect(() => {
    let live = true
    if (!clientId) return
    supabase.from('gp_clients').select('order:raw->closet_order').eq('id', clientId).maybeSingle()
      .then(({ data, error: e }) => {
        if (!live) return
        setState({ id: clientId, order: e ? [] : savedClosetOrder({ closet_order: (data as { order?: unknown } | null)?.order }), error: e ? e.message : null })
      })
    return () => { live = false }
  }, [clientId])

  const save = useCallback(async (next: string[] | null): Promise<boolean> => {
    if (!clientId) return false
    const before = state.id === clientId ? state.order : []
    setState({ id: clientId, order: next ?? [], error: null })
    const { data: row, error: rErr } = await supabase.from('gp_clients').select('raw').eq('id', clientId).single()
    const { data, error: e } = rErr || !row
      ? { data: null, error: rErr }
      : await supabase.from('gp_clients').update({ raw: withClosetOrder(row.raw, next) }).eq('id', clientId).select('order:raw->closet_order')
    if (e || !data || data.length === 0) {
      setState({ id: clientId, order: before, error: "That order didn't save. Try again." })
      return false
    }
    setState({ id: clientId, order: savedClosetOrder({ closet_order: (data[0] as { order?: unknown }).order }), error: null })
    return true
  }, [clientId, state])

  const current = state.id === clientId
  return { order: current ? state.order : [], save, error: current ? state.error : null }
}
