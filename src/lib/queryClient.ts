import { QueryClient } from '@tanstack/react-query'

/**
 * ONE cache for the per-client Style data (closet, canvas looks, capsules, the Categorize
 * looks/capsules/categories), shared by every screen that shows it.
 *
 * Before this, each screen loaded the client's closet for itself: the canvas closet, Collection,
 * Colors, Review and Nesting each ran their own paged read of up to ~1,300 rows, and switching
 * the Style tab re-ran them. Now a screen asks for `styleKeys.closet(clientId)` and gets the copy
 * already in memory; an edit anywhere invalidates or patches that one copy, so every screen shows
 * it at once.
 *
 * staleTime: data younger than this is served from memory without a read. Edits inside the app
 * invalidate explicitly, so this only bounds how long another person's edit can go unseen, and
 * refetchOnWindowFocus closes most of that (coming back to the tab re-reads anything stale).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 3 * 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: true,
      // The old hooks never retried. One retry absorbs a dropped iPad connection without
      // delaying a real error by more than a second or two.
      retry: 1,
    },
  },
})

/** Query keys, one per client per list. Every reader of a list uses the SAME key. */
export const styleKeys = {
  closet: (clientId: string | null) => ['style', 'closet', clientId] as const,
  looks: (clientId: string | null) => ['style', 'looks', clientId] as const,
  capsules: (clientId: string | null) => ['style', 'capsules', clientId] as const,
  lookCategories: (clientId: string | null) => ['style', 'lookCategories', clientId] as const,
}
