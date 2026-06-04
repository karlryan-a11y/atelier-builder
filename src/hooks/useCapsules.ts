import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

export interface CapsuleRow {
  id: string
  client_id: string
  name: string
  description: string | null
  closet_item_ids: string[] | null
  look_ids: string[]  // stored in raw.look_ids — not a native column
  raw: Record<string, unknown>
  source: string
  created_at: string
}

function generateBoardId(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16)
  return Array.from({ length: 24 }, hex).join('')
}

export function useCapsules(clientId: string | null) {
  const [capsules, setCapsules] = useState<CapsuleRow[]>([])
  const [loading, setLoading] = useState(false)

  const fetchCapsules = useCallback(async () => {
    if (!clientId) {
      setCapsules([])
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('gp_boards')
      .select('id, client_id, name, description, closet_item_ids, raw, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })

    if (!error && data) {
      setCapsules(data.map((b: any) => ({
        ...b,
        look_ids: b.raw?.look_ids ?? [],
        source: b.raw?.source ?? 'unknown',
      })))
    }
    setLoading(false)
  }, [clientId])

  useEffect(() => {
    fetchCapsules()
  }, [fetchCapsules])

  const saveCapsule = useCallback(async (opts: {
    clientId: string
    name: string
    description?: string
    lookIds: string[]
    closetItemIds: string[]
    imageBase64?: string  // PNG base64 for the capsule hero
  }) => {
    const id = generateBoardId()

    // Upload capsule composite image to R2
    let imageR2Key: string | null = null
    if (opts.imageBase64) {
      try {
        const key = `capsules/${id}/image-${Date.now()}.png`
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
          imageR2Key = key
        }
      } catch (err) {
        console.error('Failed to upload capsule image:', err)
      }
    }

    const row = {
      id,
      client_id: opts.clientId,
      name: opts.name,
      description: opts.description ?? '',
      closet_item_ids: opts.closetItemIds,
      is_deleted: false,
      is_owned: true,
      sort_order: 0,
      raw: {
        source: 'builder',
        look_ids: opts.lookIds,
        ...(imageR2Key ? {
          image_r2_key: imageR2Key,
          image_url: `https://images.atelierbywatson.com/${imageR2Key}`,
        } : {}),
      },
    }

    const { data, error } = await supabase
      .from('gp_boards')
      .insert(row)
      .select()
      .single()

    if (error) {
      console.error('Save capsule error:', error)
      return { error, data: null }
    }

    await fetchCapsules()
    return { error: null, data }
  }, [fetchCapsules])

  const deleteCapsule = useCallback(async (id: string) => {
    const { error } = await supabase.from('gp_boards').delete().eq('id', id)
    if (!error) {
      setCapsules(prev => prev.filter(c => c.id !== id))
    }
    return { error }
  }, [])

  return { capsules, loading, fetchCapsules, saveCapsule, deleteCapsule }
}
