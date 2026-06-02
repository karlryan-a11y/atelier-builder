import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export interface IntakeItem {
  id: string
  batch_id: string
  client_id: string
  pair_index: number
  status: string
  extracted_brand: string | null
  extracted_name: string | null
  extracted_color: string | null
  extracted_category: string | null
  extracted_material: string | null
  extracted_metadata: Record<string, unknown> | null
  ai_image_primary_r2_key: string | null
  ai_image_generated_at: string | null
  metadata_extracted_at: string | null
  qc_score: number | null
  qc_issues: string[] | null
  qc_notes: string | null
  qc_checked_at: string | null
  qc_attempt: number
  auto_restyle_instructions: string | null
  created_at: string
  // Joined fields
  garment_photo?: { id: string; r2_key: string }
  tag_photo?: { id: string; r2_key: string }
  batch?: { batch_label: string | null; client_id: string }
  client_name?: string
}

interface UseIntakeItemsResult {
  items: IntakeItem[]
  loading: boolean
  error: string | null
  refresh: () => void
  counts: { qc_passed: number; pending: number; approved: number; rejected: number }
}

export function useIntakeItems(
  filter: 'qc_passed' | 'pending_review' | 'approved' | 'rejected_final' | 'all' = 'qc_passed',
  clientId?: string | null,
): UseIntakeItemsResult {
  const [items, setItems] = useState<IntakeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [counts, setCounts] = useState({ qc_passed: 0, pending: 0, approved: 0, rejected: 0 })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Fetch items with garment and tag photo joins
      let query = supabase
        .from('intake_items')
        .select(`
          id, batch_id, client_id, pair_index, status,
          extracted_brand, extracted_name, extracted_color,
          extracted_category, extracted_material, extracted_metadata,
          ai_image_primary_r2_key, ai_image_generated_at,
          metadata_extracted_at, created_at,
          qc_score, qc_issues, qc_notes, qc_checked_at, qc_attempt, auto_restyle_instructions,
          garment_photo:intake_photos!garment_photo_id(id, r2_key),
          tag_photo:intake_photos!tag_photo_id(id, r2_key)
        `)
        .order('created_at', { ascending: false })

      if (filter !== 'all') {
        query = query.eq('status', filter)
      }

      // Filter by client if specified
      if (clientId) {
        query = query.eq('client_id', clientId)
      }

      const { data, error: fetchError } = await query

      if (fetchError) {
        setError(fetchError.message)
        return
      }

      // Get client names for display
      const clientIds = [...new Set((data ?? []).map((d: any) => d.client_id))]
      let clientMap: Record<string, string> = {}

      if (clientIds.length > 0) {
        const { data: clients } = await supabase
          .from('gp_clients')
          .select('id, name')
          .in('id', clientIds)

        clientMap = Object.fromEntries((clients ?? []).map((c: any) => [c.id, c.name]))
      }

      const items = (data ?? []).map((item: any) => ({
        ...item,
        garment_photo: item.garment_photo?.[0] || item.garment_photo || null,
        tag_photo: item.tag_photo?.[0] || item.tag_photo || null,
        client_name: clientMap[item.client_id] || 'Unknown Client',
      }))

      setItems(items)

      // Get counts — also filtered by client if specified
      const buildCountQuery = (status: string) => {
        let q = supabase.from('intake_items').select('id', { count: 'exact', head: true }).eq('status', status)
        if (clientId) q = q.eq('client_id', clientId)
        return q
      }

      const [qcPassedRes, pendingRes, approvedRes, rejectedRes] = await Promise.all([
        buildCountQuery('qc_passed'),
        buildCountQuery('pending_review'),
        buildCountQuery('approved'),
        buildCountQuery('rejected_final'),
      ])

      setCounts({
        qc_passed: qcPassedRes.count ?? 0,
        pending: pendingRes.count ?? 0,
        approved: approvedRes.count ?? 0,
        rejected: rejectedRes.count ?? 0,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load items')
    } finally {
      setLoading(false)
    }
  }, [filter, clientId])

  useEffect(() => {
    load()
  }, [load])

  return { items, loading, error, refresh: load, counts }
}
