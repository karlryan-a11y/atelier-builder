import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { styleKeys } from '@/lib/queryClient'
import { residencesFrom, MIN_RESIDENCES } from '@/lib/residences'

/**
 * Her homes, as the stylist named them (ADR-0111 `look_categories.is_residence`), so the Canvas
 * piece chips can put them first. Cynthia, 2026-10-08, Keil Cadieux: "When I'm styling on the back
 * end, how do I know what garments belong to what residence?" The pieces were already filed
 * (custom_categories), but Creekside sat behind "Show all 45 categories". Empty for a client with
 * fewer than two homes, so every other client's chips are unchanged.
 */
export function useHomes(clientId: string | null): Map<string, string> {
  const q = useQuery({
    queryKey: styleKeys.homes(clientId),
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase.from('look_categories')
        .select('slug, label, is_residence, season').eq('client_id', clientId!).eq('is_residence', true).eq('is_hidden', false)
      if (error) { console.error('useHomes:', error.message); return [] }
      return residencesFrom(data ?? [])
    },
  })
  // One Map per read, not per render: callers put it in useMemo dependencies.
  return useMemo(() => {
    const rows = (q.data ?? []).length >= MIN_RESIDENCES ? q.data ?? [] : []
    return new Map(rows.map((r) => [r.slug, (r.label ?? '').trim() || r.slug]))
  }, [q.data])
}
