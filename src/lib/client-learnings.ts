// Client learnings — the feed-forward half of the moat. Reads what past WSG
// shopping sessions taught us about this client (what was kept and proven, what
// was declined and why) and renders a compact block injected into the next
// Cowork brief, so every shop gets smarter.

import { supabase } from '@/lib/supabase'

interface OptionRef {
  brand: string | null
  product_name: string | null
  selected_size?: string | null
}

export interface ClientLearnings {
  hasHistory: boolean
  kept: { brand: string; product: string; size: string }[]
  declined: { brand: string; product: string; reasons: string }[]
}

const MAX = 12

export async function loadClientLearnings(clientId: string): Promise<ClientLearnings> {
  const empty: ClientLearnings = { hasHistory: false, kept: [], declined: [] }
  if (!clientId) return empty

  // All shopping sessions for this client
  const { data: sessions } = await supabase
    .from('shopping_sessions')
    .select('id')
    .eq('client_id', clientId)
  const ids = (sessions ?? []).map((s: { id: string }) => s.id)
  if (ids.length === 0) return empty

  const [keptRes, rejRes] = await Promise.all([
    supabase
      .from('shopping_tryon')
      .select('result, shopping_options(brand, product_name, selected_size)')
      .eq('result', 'kept')
      .in('session_id', ids),
    supabase
      .from('shopping_reviews')
      .select('rejection_reasons, feedback_note, shopping_options(brand, product_name)')
      .eq('action', 'reject')
      .in('session_id', ids),
  ])

  const kept = (keptRes.data ?? [])
    .map((r: { shopping_options: OptionRef | OptionRef[] | null }) => {
      const o = Array.isArray(r.shopping_options) ? r.shopping_options[0] : r.shopping_options
      if (!o) return null
      return {
        brand: o.brand || 'Unknown',
        product: o.product_name || '',
        size: o.selected_size || '',
      }
    })
    .filter(Boolean)
    .slice(0, MAX) as ClientLearnings['kept']

  const declined = (rejRes.data ?? [])
    .map(
      (r: {
        rejection_reasons: string[] | null
        feedback_note: string | null
        shopping_options: OptionRef | OptionRef[] | null
      }) => {
        const o = Array.isArray(r.shopping_options) ? r.shopping_options[0] : r.shopping_options
        if (!o) return null
        const reasons = [
          ...(r.rejection_reasons ?? []),
          ...(r.feedback_note ? [r.feedback_note] : []),
        ].join('; ')
        return { brand: o.brand || 'Unknown', product: o.product_name || '', reasons }
      }
    )
    .filter(Boolean)
    .slice(0, MAX) as ClientLearnings['declined']

  return { hasHistory: kept.length > 0 || declined.length > 0, kept, declined }
}

/** Render the learnings as a Markdown block for the Cowork brief. '' if none. */
export function formatLearnings(l: ClientLearnings): string {
  if (!l.hasHistory) return ''
  const lines: string[] = []
  if (l.kept.length > 0) {
    const items = l.kept
      .map((k) => `${k.brand}${k.product ? ` ${k.product}` : ''}${k.size ? ` — size ${k.size}` : ''}`)
      .join('; ')
    lines.push(`- **Kept / proven:** ${items}`)
  }
  if (l.declined.length > 0) {
    const items = l.declined
      .map((d) => `${d.brand}${d.reasons ? ` (${d.reasons})` : ''}`)
      .join('; ')
    lines.push(`- **Previously declined:** ${items}`)
  }
  lines.push(
    `- Favor repeats of what was kept (and the proven sizes above); avoid repeating declined brands or the issues noted.`
  )
  return lines.join('\n')
}
