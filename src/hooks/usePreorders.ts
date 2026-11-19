import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { styleKeys } from '@/lib/queryClient'
import { uploadPicture } from '@/lib/addPicture'
import { requestDerivatives } from '@/lib/requestDerivatives'
import { newPreorderRow, keepPatch, returnPatch, preorderPhotoKeys, PREORDER_WAITING } from '@/lib/preorders'

// A client's pre-orders (lib/preorders.ts): the pieces waiting on her Pre-orders tab, and the three
// things a stylist does with one. Add, Keep and Return each ask for the row back, because a write
// that RLS declines comes back as an empty success (hard rule, ADR-0108).

export interface Preorder {
  id: string
  name: string
  brand: string | null
  price: string | null
  description: string | null
  category: string | null
  photoKeys: string[]
  addedAt: string | null
  raw: any
}

export interface NewPreorder {
  name: string
  brand: string
  price: string
  description: string
  category: string
  files: File[]
}

const COLS = 'id, name, name_override, brand, price, description, category, raw, primary_image_hash, processed_image_hash, added_at'

async function whoAmI(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user?.email ?? null
}

export function usePreorders(clientId: string | null) {
  const [items, setItems] = useState<Preorder[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const qc = useQueryClient()

  useEffect(() => {
    if (!clientId) { setItems([]); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      const { data, error: e } = await supabase
        .from('gp_closet_items')
        .select(COLS)
        .eq('client_id', clientId)
        .eq('is_deleted', true)
        .eq('deleted_reason', PREORDER_WAITING)
        .order('added_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true })
        .limit(500)
      if (cancelled) return
      if (e) { setError(e.message); setLoading(false); return }
      setItems((data ?? []).map((r: any) => ({
        id: r.id,
        name: (r.name_override?.trim() || r.name) ?? 'Untitled piece',
        brand: r.brand ?? null,
        price: r.price ?? null,
        description: r.description ?? null,
        category: r.category ?? null,
        photoKeys: preorderPhotoKeys(r),
        addedAt: r.added_at ?? null,
        raw: r.raw ?? {},
      })))
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [clientId, tick])

  const refetch = useCallback(() => setTick((t) => t + 1), [])

  /** Upload every photo, then write the hidden piece. Nothing is written if a photo fails. */
  const add = useCallback(async (p: NewPreorder) => {
    if (!clientId) throw new Error('Pick a client first.')
    if (!p.name.trim()) throw new Error('Give the piece a name.')
    if (!p.files.length) throw new Error('Add at least one photo.')
    const keys: string[] = []
    for (const f of p.files) keys.push((await uploadPicture(f, clientId)).key)
    const row = newPreorderRow({
      id: crypto.randomUUID(), clientId, name: p.name, brand: p.brand, price: p.price,
      description: p.description, category: p.category, photoKeys: keys,
      by: await whoAmI(), at: new Date().toISOString(),
    })
    const { data, error: e } = await supabase.from('gp_closet_items').insert(row).select('id')
    if (e) throw new Error(e.message)
    if (!data?.length) throw new Error('The pre-order did not save. Refresh and try again.')
    void requestDerivatives({ item_ids: [row.id] })
    refetch()
    return row.id
  }, [clientId, refetch])

  const decide = useCallback(async (item: Preorder, how: 'keep' | 'return') => {
    if (!clientId) return
    const at = new Date().toISOString()
    const by = await whoAmI()
    const patch = how === 'keep' ? keepPatch(item.raw, at, by) : returnPatch(item.raw, at, by)
    const { data, error: e } = await supabase.from('gp_closet_items')
      .update(patch)
      .eq('id', item.id).eq('client_id', clientId)
      .eq('is_deleted', true).eq('deleted_reason', PREORDER_WAITING)
      .select('id')
    if (e) throw new Error(e.message)
    if (!data?.length) throw new Error('Someone already kept or returned this one. Refresh to see.')
    setItems((cur) => cur.filter((i) => i.id !== item.id))
    // A kept piece is in her Collection now: every closet screen re-reads it.
    if (how === 'keep') void qc.invalidateQueries({ queryKey: styleKeys.closet(clientId) })
  }, [clientId, qc])

  const keep = useCallback((item: Preorder) => decide(item, 'keep'), [decide])
  const giveBack = useCallback((item: Preorder) => decide(item, 'return'), [decide])

  return { items, loading, error, refetch, add, keep, giveBack }
}
