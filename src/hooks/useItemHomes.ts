import { useMemo } from 'react'
import { useLookCategories } from '@/hooks/useLookCategories'
import { homesByItem, residenceResolverFor, MIN_RESIDENCES } from '@/lib/residences'

/**
 * Her homes and which pieces are at each, matching her Collection page (lib/residences
 * homesByItem). Reads the shared Style cache (useLookCategories), so a Home ticked in Categorize
 * reaches the Canvas chips at once. Empty for a client with fewer than two homes.
 *
 * `withHomes(itemId, cats)` is the piece's categories as every builder filter should see them:
 * her home slugs added, and a free-text spelling of a home ("creekside closet") taken out so it
 * does not show as a garment category of its own.
 */
export function useItemHomes(
  clientId: string | null,
  items: { id: string; category?: string | null; custom_categories?: string[] | null }[],
) {
  const { categories, looks } = useLookCategories(clientId)
  const homeRows = useMemo(() => categories.filter((c) => c.is_residence === true && !c.is_hidden), [categories])
  const homes = useMemo(
    () => (homeRows.length >= MIN_RESIDENCES ? new Map(homeRows.map((c) => [c.slug, (c.label ?? '').trim() || c.slug])) : new Map<string, string>()),
    [homeRows],
  )
  const byItem = useMemo(() => homesByItem(items, looks, homeRows), [items, looks, homeRows])
  const slugOf = useMemo(() => residenceResolverFor(homes.size ? homeRows : []), [homes, homeRows])
  const withHomes = useMemo(() => (itemId: string, cats: string[]) => {
    if (homes.size === 0) return cats
    const kept = cats.filter((c) => !(slugOf(c) && !homes.has(c)))
    const at = byItem.get(itemId)
    if (!at) return kept.filter((c) => !homes.has(c))
    return [...new Set([...kept.filter((c) => !homes.has(c)), ...at])]
  }, [homes, slugOf, byItem])
  return { homes, homesByItem: byItem, withHomes }
}
