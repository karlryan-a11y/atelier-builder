// Shopping session persistence — durable record of a shopping session, its
// shopping list (slots), and the Cowork-sourced product options, against the
// migration-004 shopping_* tables.

import { supabase } from '@/lib/supabase'
import type { ShoppingSession } from '@/stores/shoppingStore'
import type { BoardSlot } from '@/stores/boardStore'

function parseNum(v: string | null | undefined): number | null {
  if (!v) return null
  const cleaned = String(v).replace(/[^0-9.]/g, '')
  if (!cleaned) return null
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

function splitCsv(v: string | null | undefined): string[] {
  return (v || '')
    .split(/[,/]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// shopping_sessions.status check constraint has no 'intake' — map it to 'draft'.
function mapStatus(status: ShoppingSession['status']): string {
  return status === 'intake' ? 'draft' : status
}

function shipTo(session: ShoppingSession): Record<string, unknown> | null {
  const addr = session.profile.ship_to_address?.trim()
  return addr ? { address: addr } : null
}

/**
 * Persist the brief: upsert the shopping_sessions row and replace its
 * shopping_slots from the current shopping list. Returns the session id.
 * Call this at brief generation — before any options exist (it replaces slots,
 * which would cascade-delete options).
 */
export async function saveBrief(
  session: ShoppingSession,
  stylistId: string | null
): Promise<string> {
  const row = {
    client_id: session.profile.client_id,
    stylist_id: stylistId,
    status: mapStatus(session.status),
    budget_total: parseNum(session.profile.budget_total),
    deliver_by: session.profile.deliver_by || null,
    ship_to: shipTo(session),
    cowork_prompt_md: session.cowork_prompt,
    cowork_output_raw: session.cowork_output,
    updated_at: new Date().toISOString(),
  }

  let sessionId = session.id
  if (sessionId) {
    const { error } = await supabase.from('shopping_sessions').update(row).eq('id', sessionId)
    if (error) throw new Error(`session update failed: ${error.message}`)
  } else {
    const { data, error } = await supabase
      .from('shopping_sessions')
      .insert(row)
      .select('id')
      .single()
    if (error || !data) throw new Error(`session create failed: ${error?.message}`)
    sessionId = data.id
  }

  // Replace the slot list for this session
  const { error: delErr } = await supabase.from('shopping_slots').delete().eq('session_id', sessionId)
  if (delErr) throw new Error(`slot clear failed: ${delErr.message}`)

  const slotRows = session.slots
    .filter((s) => s.description.trim())
    .map((s, i) => ({
      session_id: sessionId,
      description: s.description.trim(),
      category: s.category || null,
      quality_bar: s.quality_bar,
      budget_guidance: parseNum(s.budget_guidance),
      slot_notes: s.notes || null,
      display_order: i,
    }))
  if (slotRows.length > 0) {
    const { error } = await supabase.from('shopping_slots').insert(slotRows)
    if (error) throw new Error(`slot save failed: ${error.message}`)
  }

  return sessionId as string
}

/** Lightweight session metadata update (status, cowork output, timestamps). */
export async function updateSessionMeta(
  sessionId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from('shopping_sessions')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
  if (error) throw new Error(`session meta update failed: ${error.message}`)
}

function norm(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * Persist Cowork-sourced options. Matches each board slot to an existing
 * shopping_slot by description (creating one if missing), clears prior options
 * for the session, and inserts the current options. Round defaults to 1.
 */
export async function saveCoworkOptions(
  sessionId: string,
  boardSlots: BoardSlot[],
  round: 1 | 2 = 1
): Promise<void> {
  // Existing slots for this session
  const { data: existing, error: exErr } = await supabase
    .from('shopping_slots')
    .select('id, description')
    .eq('session_id', sessionId)
  if (exErr) throw new Error(`slot lookup failed: ${exErr.message}`)

  const slotIdByDesc = new Map<string, string>()
  for (const s of existing ?? []) slotIdByDesc.set(norm(s.description), s.id)

  // Create any slots that exist on the board but not yet in the DB
  const missing = boardSlots.filter((bs) => !slotIdByDesc.has(norm(bs.description)))
  if (missing.length > 0) {
    const { data: inserted, error } = await supabase
      .from('shopping_slots')
      .insert(
        missing.map((bs, i) => ({
          session_id: sessionId,
          description: bs.description,
          display_order: (existing?.length ?? 0) + i,
        }))
      )
      .select('id, description')
    if (error || !inserted) throw new Error(`slot create failed: ${error?.message}`)
    for (const s of inserted) slotIdByDesc.set(norm(s.description), s.id)
  }

  // Replace options for this session+round
  const { error: delErr } = await supabase
    .from('shopping_options')
    .delete()
    .eq('session_id', sessionId)
    .eq('round', round)
  if (delErr) throw new Error(`option clear failed: ${delErr.message}`)

  const optionRows = boardSlots.flatMap((bs) => {
    const slotId = slotIdByDesc.get(norm(bs.description))
    if (!slotId) return []
    return bs.options.map((o) => ({
      slot_id: slotId,
      session_id: sessionId,
      round,
      product_name: o.product_name || null,
      brand: o.brand || null,
      retailer: o.retailer || null,
      price: parseNum(o.price),
      product_url: o.url || null,
      image_url: o.image_url || null,
      sizes_available: splitCsv(o.sizes_available),
      colors_available: splitCsv(o.colors_available),
      selected_size: o.size_override || o.recommended_size || null,
      selected_color: o.color_override || o.recommended_color || null,
      ship_timeline: o.ship_timeline || null,
      return_policy: o.return_policy || null,
      confidence: o.confidence || 'low',
    }))
  })

  if (optionRows.length > 0) {
    const { error } = await supabase.from('shopping_options').insert(optionRows)
    if (error) throw new Error(`option save failed: ${error.message}`)
  }
}
