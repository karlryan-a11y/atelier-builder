// Resume a shopping session from the DB into the live app — the client profile,
// the shopping list, the board (with prior review + try-on decisions), the right
// status/view. Powers the Session History panel and the #session=<id> deep link.

import { supabase } from '@/lib/supabase'
import { useShoppingStore, type ShoppingSlot, type ShoppingSession } from '@/stores/shoppingStore'
import { useBoardStore } from '@/stores/boardStore'
import { useViewStore } from '@/stores/viewStore'
import { loadClientData } from '@/lib/client-data'
import { loadSessionBoardFull } from '@/lib/shopping-persistence'

// Map a persisted shopping_sessions.status to the in-app session status so the
// correct surface renders (review board / checkout / try-on / intake).
function viewStatus(dbStatus: string, hasOptions: boolean): ShoppingSession['status'] {
  if (dbStatus === 'tryon' || dbStatus === 'delivered') return 'tryon'
  if (dbStatus === 'checkout' || dbStatus === 'ordered') return dbStatus as ShoppingSession['status']
  if (dbStatus === 'complete') return 'complete'
  if (hasOptions) return dbStatus.startsWith('review') ? (dbStatus as ShoppingSession['status']) : 'review_round_1'
  return 'intake'
}

export async function resumeSession(
  sessionId: string
): Promise<{ ok: boolean; reason?: string }> {
  const store = useShoppingStore.getState()
  store.setProfileLoading(true)
  try {
    const { data: sess } = await supabase
      .from('shopping_sessions')
      .select('id, client_id, status, budget_total, deliver_by, ship_to, cowork_prompt_md, cowork_output_raw')
      .eq('id', sessionId)
      .maybeSingle()
    if (!sess) {
      store.setProfileLoading(false)
      return { ok: false, reason: 'Session not found' }
    }

    const clientId: string = sess.client_id
    const { data: clientRow } = await supabase
      .from('clients')
      .select('name')
      .eq('id', clientId)
      .maybeSingle()
    const clientName = clientRow?.name ?? 'Client'

    // 1) Client identity + imported profile data
    store.setProfile({ client_id: clientId, client_name: clientName, is_new_client: false })
    const bundle = await loadClientData(clientId)
    store.hydrateClientData(bundle)

    // 2) Logistics carried on the session
    store.setProfile({
      budget_total: sess.budget_total != null ? String(sess.budget_total) : '',
      deliver_by: sess.deliver_by ?? '',
      ship_to_address: (sess.ship_to && (sess.ship_to as any).address) || '',
    })

    // 3) Shopping list (slots)
    const { data: slotRows } = await supabase
      .from('shopping_slots')
      .select('id, description, category, quality_bar, budget_guidance, slot_notes, display_order')
      .eq('session_id', sessionId)
      .order('display_order')
    const slots: ShoppingSlot[] = (slotRows ?? []).map((s: Record<string, any>) => ({
      id: `slot_${s.id}`,
      description: s.description ?? '',
      category: s.category ?? '',
      quality_bar: s.quality_bar === 'hero_piece' ? 'hero_piece' : 'daily_rotation',
      budget_guidance: s.budget_guidance != null ? String(s.budget_guidance) : '',
      notes: s.slot_notes ?? '',
    }))
    store.setSlots(slots)

    // 4) Board with prior decisions
    const board = await loadSessionBoardFull(sessionId, 1)
    useBoardStore.getState().hydrate(board, 1)

    // 5) Session id + status + view
    store.setSessionId(sessionId)
    store.setCoworkPrompt(sess.cowork_prompt_md ?? null)
    if (sess.cowork_output_raw) store.setCoworkOutput(sess.cowork_output_raw)
    store.setStatus(viewStatus(sess.status, board.length > 0))
    store.setProfileLoading(false)
    useViewStore.getState().setActiveView('shop')
    return { ok: true }
  } catch (e) {
    store.setProfileLoading(false)
    return { ok: false, reason: e instanceof Error ? e.message : 'Failed to resume session' }
  }
}
