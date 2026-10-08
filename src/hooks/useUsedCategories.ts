import { useMemo } from 'react'
import { useClosetItems } from '@/hooks/useClosetItems'
import { useClientStore } from '@/stores/clientStore'
import { categoriesOf } from '@/lib/garmentCategory'

/**
 * Every category the active client's pieces are in (stored, or read from tags/name the way her
 * Collection reads it), for ordering category dropdowns (lib/categoryChoices.ts). Read from the
 * shared closet cache every collection screen already holds, so it costs no extra request.
 */
export function useUsedCategories(): Set<string> | null {
  const clientId = useClientStore((s) => s.activeClient?.id ?? null)
  const { items, tagNameById } = useClosetItems(clientId)
  return useMemo(() => {
    if (!items || items.length === 0) return null
    const used = new Set<string>()
    for (const it of items) {
      const tags = (it.content_tag_ids ?? []).map((id) => tagNameById.get(id)).filter((t): t is string => !!t)
      for (const slug of categoriesOf(it, tags)) used.add(slug)
    }
    return used
  }, [items, tagNameById])
}
