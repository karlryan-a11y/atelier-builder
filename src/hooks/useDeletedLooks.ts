import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { proxyImageUrl } from '@/lib/images'
import { lookImageUrl } from '@/lib/lookImage'
import { deletedLooks, withCleared, withRestored, type DeletedLook } from '@/lib/deletedLooks'

// Review > Deleted looks: the looks a client deleted from her lookbook, with her note. See
// lib/deletedLooks.ts. Reads and writes run under the stylist's own sign-in, so a stylist only
// ever sees (and restores) the clients she can already open.

export interface DeletedLookCard extends DeletedLook {
  name: string
  image: string | null
}

export function useDeletedLooks(clientId: string | null, stylistName: string | null) {
  const [waiting, setWaiting] = useState<DeletedLookCard[]>([])
  const [cleared, setCleared] = useState<DeletedLookCard[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!clientId) { setWaiting([]); setCleared([]); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      const [marksRes, clientRes] = await Promise.all([
        supabase.from('client_marks').select('target_id, created_at')
          .eq('client_id', clientId).eq('mark', 'archived').eq('target_type', 'look')
          .order('created_at', { ascending: false }).limit(1000),
        supabase.from('gp_clients').select('raw').eq('id', clientId).single(),
      ])
      if (cancelled) return
      if (marksRes.error || clientRes.error) {
        setError(marksRes.error?.message ?? clientRes.error?.message ?? 'load failed'); setLoading(false); return
      }
      const split = deletedLooks(marksRes.data ?? [], clientRes.data?.raw)
      const ids = [...split.waiting, ...split.cleared].map((d) => d.lookId)
      const byId = new Map<string, { name: string; image: string | null }>()
      if (ids.length) {
        // The picture comes from raw.main_image_url, the one source every look screen uses (lib/lookImage.ts).
        const { data, error: e } = await supabase.from('gp_looks').select('id, name, raw').in('id', ids)
        if (cancelled) return
        if (e) { setError(e.message); setLoading(false); return }
        for (const l of data ?? []) {
          const img = lookImageUrl(l.raw)
          byId.set(l.id, { name: l.name ?? 'Untitled Look', image: img ? proxyImageUrl(img) : null })
        }
      }
      const card = (d: DeletedLook): DeletedLookCard => ({ ...d, name: byId.get(d.lookId)?.name ?? 'Untitled Look', image: byId.get(d.lookId)?.image ?? null })
      setWaiting(split.waiting.map(card))
      setCleared(split.cleared.map(card))
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [clientId, tick])

  /** Her client row's raw, read fresh and written back with one change, or an error. */
  const stampRaw = useCallback(async (change: (raw: unknown) => Record<string, unknown>) => {
    const { data, error: rErr } = await supabase.from('gp_clients').select('raw').eq('id', clientId!).single()
    if (rErr || !data) throw new Error(rErr?.message ?? 'client not found')
    const { data: saved, error: wErr } = await supabase.from('gp_clients')
      .update({ raw: change(data.raw) }).eq('id', clientId!).select('id')
    if (wErr) throw wErr
    // A refused write is a 200 with no rows (hard rules): say so rather than pretend it saved.
    if (!saved?.length) throw new Error('not allowed to change this client')
  }, [clientId])

  /** Back on her site where it was: her mark goes. Her note stays on record. */
  const restore = useCallback(async (lookId: string) => {
    if (!clientId) return
    const { data, error: e } = await supabase.from('client_marks').delete()
      .eq('client_id', clientId).eq('target_type', 'look').eq('target_id', lookId).eq('mark', 'archived')
      .select('target_id')
    if (e) throw e
    if (!data?.length) throw new Error('not allowed to change this client')
    await stampRaw((raw) => withRestored(raw, lookId, stylistName, new Date().toISOString()))
    setTick((t) => t + 1)
  }, [clientId, stylistName, stampRaw])

  /** Off this list; the look stays off her site. */
  const clear = useCallback(async (lookId: string) => {
    if (!clientId) return
    await stampRaw((raw) => withCleared(raw, lookId, stylistName, new Date().toISOString()))
    setTick((t) => t + 1)
  }, [clientId, stylistName, stampRaw])

  return { waiting, cleared, loading, error, restore, clear }
}
