// Shopping session persistence — durable record of a shopping session, its
// shopping list (slots), and the Cowork-sourced product options, against the
// migration-004 shopping_* tables.

import { supabase } from '@/lib/supabase'
import type { ShoppingSession } from '@/stores/shoppingStore'
import type { BoardSlot, BoardOption } from '@/stores/boardStore'
import type { ParsedSlot, ParsedOption } from '@/lib/cowork-parser'
import { detectCategory } from '@/lib/categorize'

// The auto-upload / rehost ingest endpoint (Vercel serverless function).
export const INGEST_URL = '/api/shopping-ingest'

// Map compose categories → client_brand_sizing enum (top|bottom|dress|outerwear|
// shoe|intimates|accessory). Returns null for categories with no sizing bucket.
const SIZING_CATEGORY: Record<string, string> = {
  top: 'top',
  bottom: 'bottom',
  dress: 'dress',
  outerwear: 'outerwear',
  shoes: 'shoe',
  bag: 'accessory',
  jewelry: 'accessory',
  belt: 'accessory',
  scarf: 'accessory',
  hat: 'accessory',
  accessory: 'accessory',
}

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

function optionKey(slotDesc: string, productName: string, brand: string): string {
  return `${norm(slotDesc)}|${norm(productName)}|${norm(brand)}`
}

/**
 * Resolve persisted shopping_options ids for a session, keyed by
 * slotDescription|productName|brand. Lets us attach reviews/tryon to options
 * without tracking DB ids through the transient board store.
 */
async function fetchOptionIdMap(sessionId: string): Promise<Map<string, string>> {
  const [optRes, slotRes] = await Promise.all([
    supabase
      .from('shopping_options')
      .select('id, slot_id, product_name, brand')
      .eq('session_id', sessionId),
    supabase.from('shopping_slots').select('id, description').eq('session_id', sessionId),
  ])
  const slotDescById = new Map<string, string>()
  for (const s of slotRes.data ?? []) slotDescById.set(s.id, s.description)

  const map = new Map<string, string>()
  for (const o of optRes.data ?? []) {
    const desc = slotDescById.get(o.slot_id) ?? ''
    map.set(optionKey(desc, o.product_name ?? '', o.brand ?? ''), o.id)
  }
  return map
}

const REVIEW_ACTION: Record<string, 'approve' | 'reject' | 'swap'> = {
  approved: 'approve',
  rejected: 'reject',
  swapped: 'swap',
}

/**
 * Persist the stylist's review decisions (approve/reject/swap + reasons) for a
 * session. Idempotent: clears prior reviews for the session first. This is the
 * moat signal — why options were accepted or rejected.
 */
export async function persistReviews(
  sessionId: string,
  boardSlots: BoardSlot[],
  reviewerId: string | null
): Promise<void> {
  const idMap = await fetchOptionIdMap(sessionId)

  const rows = boardSlots.flatMap((slot) =>
    slot.options
      .filter((o) => o.status !== 'pending')
      .map((o) => {
        const optionId = idMap.get(optionKey(slot.description, o.product_name, o.brand))
        if (!optionId) return null
        return {
          option_id: optionId,
          session_id: sessionId,
          action: REVIEW_ACTION[o.status],
          round: 1,
          rejection_reasons: o.rejection_reasons?.length ? o.rejection_reasons : null,
          feedback_note: o.feedback_note || null,
          size_override: o.size_override || null,
          color_override: o.color_override || null,
          reviewed_by: reviewerId,
        }
      })
      .filter(Boolean)
  )

  await supabase.from('shopping_reviews').delete().eq('session_id', sessionId)
  if (rows.length > 0) {
    const { error } = await supabase.from('shopping_reviews').insert(rows as Record<string, unknown>[])
    if (error) throw new Error(`review save failed: ${error.message}`)
  }
}

/**
 * Persist try-on outcomes (kept/returned/exchanged + closet link). Idempotent:
 * clears prior tryon rows for the session first.
 */
export async function persistTryon(
  sessionId: string,
  boardSlots: BoardSlot[],
  reviewerId: string | null
): Promise<void> {
  const idMap = await fetchOptionIdMap(sessionId)

  const rows = boardSlots.flatMap((slot) =>
    slot.options
      .filter((o) => o.tryon_status === 'kept' || o.tryon_status === 'returned' || o.tryon_status === 'exchanged')
      .map((o) => {
        const optionId = idMap.get(optionKey(slot.description, o.product_name, o.brand))
        if (!optionId) return null
        return {
          option_id: optionId,
          session_id: sessionId,
          result: o.tryon_status,
          reason: o.tryon_status === 'returned' ? o.exchange_notes || null : null,
          exchange_details: o.tryon_status === 'exchanged' ? o.exchange_notes || null : null,
          closet_item_id: o.closet_item_id || null,
          reviewed_by: reviewerId,
        }
      })
      .filter(Boolean)
  )

  await supabase.from('shopping_tryon').delete().eq('session_id', sessionId)
  if (rows.length > 0) {
    const { error } = await supabase.from('shopping_tryon').insert(rows as Record<string, unknown>[])
    if (error) throw new Error(`tryon save failed: ${error.message}`)
  }
}

/**
 * Send raw Cowork output (or pre-parsed options) to the ingest function, which
 * parses, rehosts every image into permanent storage, and persists slots +
 * options. Used by the in-app importer so the manual path also gets rehosting.
 */
export async function ingestResults(sessionId: string, raw: string): Promise<{ ok: boolean; rehosted: number; options: number }> {
  const resp = await fetch(INGEST_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, raw }),
  })
  const json = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(json?.error || `ingest failed (${resp.status})`)
  return { ok: !!json.ok, rehosted: json.rehosted ?? 0, options: json.options ?? 0 }
}

/** Most recent shopping session id for a client (to resume from a cold start). */
export async function getLatestSessionId(clientId: string): Promise<string | null> {
  if (!clientId) return null
  const { data } = await supabase
    .from('shopping_sessions')
    .select('id')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

/**
 * Load a session's persisted slots + options from the DB into the board shape
 * (ParsedSlot[]). The single source of truth for the board — used after an
 * import and to pull in results that Cowork auto-uploaded.
 */
export async function loadSessionBoard(sessionId: string, round: 1 | 2 = 1): Promise<ParsedSlot[]> {
  const [slotsRes, optsRes] = await Promise.all([
    supabase
      .from('shopping_slots')
      .select('id, description, display_order')
      .eq('session_id', sessionId)
      .order('display_order'),
    supabase
      .from('shopping_options')
      .select('*')
      .eq('session_id', sessionId)
      .eq('round', round),
  ])
  const slots = slotsRes.data ?? []
  const opts = (optsRes.data ?? []) as Record<string, any>[]
  if (slots.length === 0 || opts.length === 0) return []

  const bySlot = new Map<string, ParsedOption[]>()
  for (const o of opts) {
    const arr = bySlot.get(o.slot_id) ?? []
    const slotDesc = slots.find((s) => s.id === o.slot_id)?.description ?? ''
    arr.push({
      slot_description: slotDesc,
      option_number: arr.length + 1,
      product_name: o.product_name ?? '',
      brand: o.brand ?? '',
      retailer: o.retailer ?? '',
      price: o.price != null ? String(o.price) : '',
      url: o.product_url ?? '',
      sizes_available: Array.isArray(o.sizes_available) ? o.sizes_available.join(', ') : '',
      colors_available: Array.isArray(o.colors_available) ? o.colors_available.join(', ') : '',
      recommended_size: o.selected_size ?? '',
      recommended_color: o.selected_color ?? '',
      ship_timeline: o.ship_timeline ?? '',
      return_policy: o.return_policy ?? '',
      image_url: o.image_url ?? '',
      confidence: (['high', 'medium', 'low'].includes(o.confidence) ? o.confidence : 'low') as ParsedOption['confidence'],
    })
    bySlot.set(o.slot_id, arr)
  }

  return slots
    .filter((s) => bySlot.has(s.id))
    .map((s) => ({ description: s.description, options: bySlot.get(s.id)! }))
}

export interface ClientSessionSummary {
  id: string
  status: string
  created_at: string
  optionCount: number
}

/** List a client's shopping sessions (newest first) for the resume panel. */
export async function getClientSessions(clientId: string): Promise<ClientSessionSummary[]> {
  if (!clientId) return []
  const { data } = await supabase
    .from('shopping_sessions')
    .select('id, status, created_at, shopping_options(count)')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
  return (data ?? []).map((s: Record<string, any>) => ({
    id: s.id,
    status: s.status,
    created_at: s.created_at,
    optionCount: Array.isArray(s.shopping_options) ? s.shopping_options[0]?.count ?? 0 : 0,
  }))
}

const REVIEW_STATUS: Record<string, BoardOption['status']> = {
  approve: 'approved',
  reject: 'rejected',
  swap: 'swapped',
}

/**
 * Load a session's board from the DB WITH prior review + try-on decisions
 * applied, so resuming preserves what was approved/rejected and kept/returned.
 * Returns fully-formed BoardSlot[] (ids + statuses set) for boardStore.hydrate.
 */
export async function loadSessionBoardFull(sessionId: string, round: 1 | 2 = 1): Promise<BoardSlot[]> {
  const [slotsRes, optsRes, revRes, tryRes] = await Promise.all([
    supabase.from('shopping_slots').select('id, description, display_order').eq('session_id', sessionId).order('display_order'),
    supabase.from('shopping_options').select('*').eq('session_id', sessionId).eq('round', round),
    supabase.from('shopping_reviews').select('option_id, action, rejection_reasons, feedback_note, size_override, color_override').eq('session_id', sessionId),
    supabase.from('shopping_tryon').select('option_id, result, reason, exchange_details, closet_item_id').eq('session_id', sessionId),
  ])
  const slots = slotsRes.data ?? []
  const opts = (optsRes.data ?? []) as Record<string, any>[]
  if (slots.length === 0 || opts.length === 0) return []

  const reviewByOpt = new Map<string, Record<string, any>>()
  for (const r of revRes.data ?? []) reviewByOpt.set(r.option_id, r)
  const tryonByOpt = new Map<string, Record<string, any>>()
  for (const t of tryRes.data ?? []) tryonByOpt.set(t.option_id, t)

  const descById = new Map<string, string>()
  for (const s of slots) descById.set(s.id, s.description)

  const optsBySlot = new Map<string, BoardOption[]>()
  for (const o of opts) {
    const rv = reviewByOpt.get(o.id)
    const ty = tryonByOpt.get(o.id)
    const arr = optsBySlot.get(o.slot_id) ?? []
    arr.push({
      id: `opt_${o.id}`,
      slot_description: descById.get(o.slot_id) ?? '',
      option_number: arr.length + 1,
      product_name: o.product_name ?? '',
      brand: o.brand ?? '',
      retailer: o.retailer ?? '',
      price: o.price != null ? String(o.price) : '',
      url: o.product_url ?? '',
      sizes_available: Array.isArray(o.sizes_available) ? o.sizes_available.join(', ') : '',
      colors_available: Array.isArray(o.colors_available) ? o.colors_available.join(', ') : '',
      recommended_size: o.selected_size ?? '',
      recommended_color: o.selected_color ?? '',
      ship_timeline: o.ship_timeline ?? '',
      return_policy: o.return_policy ?? '',
      image_url: o.image_url ?? '',
      confidence: (['high', 'medium', 'low'].includes(o.confidence) ? o.confidence : 'low') as BoardOption['confidence'],
      status: rv ? REVIEW_STATUS[rv.action] ?? 'pending' : 'pending',
      rejection_reasons: rv?.rejection_reasons ?? [],
      feedback_note: rv?.feedback_note ?? '',
      size_override: rv?.size_override ?? '',
      color_override: rv?.color_override ?? '',
      tryon_status: ty ? (ty.result as BoardOption['tryon_status']) : null,
      exchange_notes: ty?.exchange_details ?? ty?.reason ?? '',
      closet_item_id: ty?.closet_item_id ?? null,
    })
    optsBySlot.set(o.slot_id, arr)
  }

  return slots
    .filter((s) => optsBySlot.has(s.id))
    .map((s) => {
      const options = optsBySlot.get(s.id)!
      const status: BoardSlot['status'] = options.some((o) => o.status === 'approved') ? 'approved' : 'pending'
      return { id: `slot_${s.id}`, description: s.description, status, options }
    })
}

/**
 * Learning loop: when a client KEEPS an item, record the proven brand+size into
 * client_brand_sizing at confirmed_keeper confidence. This is what makes future
 * briefs smarter. Best-effort, idempotent (upsert on client_id,brand,category).
 */
export async function recordKeptSizing(
  clientId: string,
  boardSlots: BoardSlot[]
): Promise<void> {
  if (!clientId || clientId.startsWith('new_')) return

  const seen = new Set<string>()
  const rows: Record<string, unknown>[] = []
  for (const slot of boardSlots) {
    for (const o of slot.options) {
      if (o.tryon_status !== 'kept') continue
      const brand = (o.brand || '').trim()
      const size = (o.size_override || o.recommended_size || '').trim()
      if (!brand || !size) continue
      // Detect category from the slot description first, then the product name
      const detected =
        detectCategory(slot.description) !== 'other'
          ? detectCategory(slot.description)
          : detectCategory(o.product_name || '')
      const category = SIZING_CATEGORY[detected]
      if (!category) continue
      const key = `${brand.toLowerCase()}|${category}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({
        client_id: clientId,
        brand,
        category,
        size,
        confidence: 'confirmed_keeper',
        last_updated: new Date().toISOString(),
      })
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from('client_brand_sizing')
      .upsert(rows, { onConflict: 'client_id,brand,category' })
    if (error) throw new Error(`kept sizing save failed: ${error.message}`)
  }
}
