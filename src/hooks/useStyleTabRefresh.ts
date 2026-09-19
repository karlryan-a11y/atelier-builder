import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { useQueryClient } from '@tanstack/react-query'
import { styleKeys } from '@/lib/queryClient'

/**
 * Freshness for the Style tabs now that they stay mounted.
 *
 * When Canvas and Categorize unmounted on every switch, each switch re-read everything, which
 * was slow but meant one tab always saw what the other had just done: a look saved on the
 * canvas appeared in Categorize, a look renamed or archived in Categorize appeared in the
 * canvas gallery, a rebuilt look left the Transitions queue.
 *
 * Now the switch is instant (nothing remounts, the closet is never re-read) and the SMALL lists
 * the other tab can change are re-read in the background when a tab comes back into view:
 *   - Canvas shown:      its looks gallery + capsules (React Query, invalidated).
 *   - Categorize shown:  looks/capsules/categories (React Query, invalidated), plus the lists
 *                        that are not in the shared cache yet and listen to `categorizeEpoch`:
 *                        the Transitions queue, "styled in N looks" usage and residence review.
 * No spinner and no remount: what is on screen stays until the fresh copy replaces it.
 * Coming back into Style from Digitize or Shop re-reads everything, the closet included, in the
 * background: Digitize adds pieces.
 * On a tab SWITCH the closet is not re-read: every closet edit in either tab goes through the one shared
 * cache (hooks/useClosetItems.ts), so both tabs already show it.
 */
interface StyleRefreshState {
  /** Bumped each time Categorize comes back into view. */
  categorizeEpoch: number
  bumpCategorize: () => void
}

export const useStyleRefreshStore = create<StyleRefreshState>((set) => ({
  categorizeEpoch: 0,
  bumpCategorize: () => set((s) => ({ categorizeEpoch: s.categorizeEpoch + 1 })),
}))

/** Call once, from App, with the Style tab being shown (null when Style is not the view). */
export function useRefreshStyleListsOnShow(tab: 'canvas' | 'categorize' | null, clientId: string | null) {
  const qc = useQueryClient()
  const prev = useRef(tab)
  useEffect(() => {
    const was = prev.current
    prev.current = tab
    if (!clientId || was === tab || tab === null) return
    // Coming INTO Style from Digitize or Shop: the panels mount again, but the cache would hand
    // them the copy from before, and Digitize is exactly where new pieces come from. Re-read all
    // four in the background (what is cached shows at once; the fresh copy replaces it).
    if (was === null) {
      for (const key of [styleKeys.closet, styleKeys.looks, styleKeys.capsules, styleKeys.lookCategories]) {
        void qc.invalidateQueries({ queryKey: key(clientId) })
      }
      return
    }
    if (tab === 'canvas') {
      void qc.invalidateQueries({ queryKey: styleKeys.looks(clientId) })
      void qc.invalidateQueries({ queryKey: styleKeys.capsules(clientId) })
    } else {
      void qc.invalidateQueries({ queryKey: styleKeys.lookCategories(clientId) })
      useStyleRefreshStore.getState().bumpCategorize()
    }
  }, [tab, clientId, qc])
}
