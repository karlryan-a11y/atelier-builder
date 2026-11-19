/**
 * PRE-ORDERS. Cynthia Dada, #watson-atelier, 2026-11-19: "a way to add preorder items with
 * pricing, photos and description into a client's atelier without adding it to their closet? A
 * separate tab from collection where the client can see what they preordered for next season and
 * haven't decided if they are keeping yet until they try it on." Keep moves it into her Collection
 * with one tap; Return takes it off Pre-orders.
 *
 * A pre-order IS a piece row from the start, so Keep moves nothing: the same row, with the same
 * photos, price and description, simply comes out of hiding. Until then it sits where Add Item's
 * draft sits (is_deleted = true), which every Collection, look, capsule, search and count already
 * leaves out, in both apps. deleted_reason says which kind of hidden it is:
 *
 *   'preorder'           waiting for her to try it on; her Pre-orders tab shows it
 *   'preorder-returned'  she sent it back; hidden for good, kept as the record (never deleted)
 *
 * raw.preorder holds the photos (every one, first is the main photo) and when each step happened.
 * Its twin is atelier-looks src/lib/preorders.ts; scripts/check-preorders.mjs keeps them in step.
 *
 * Kept free of React and Supabase so the check can load it.
 */

export const PREORDER_WAITING = 'preorder'
export const PREORDER_RETURNED = 'preorder-returned'
/** Every deleted_reason a pre-order can carry. The hidden-pieces list leaves these out. */
export const PREORDER_REASONS = [PREORDER_WAITING, PREORDER_RETURNED] as const

export type PreorderStatus = 'waiting' | 'kept' | 'returned'

export interface PreorderInput {
  id: string
  clientId: string
  name: string
  brand?: string | null
  price?: string | null
  description?: string | null
  category?: string | null
  /** Storage keys of her photos, in the order the stylist added them. The first is the main photo. */
  photoKeys: string[]
  by?: string | null
  at: string
}

const clean = (s: unknown, max: number) => String(s ?? '').trim().slice(0, max) || null

/** The new, hidden piece row for one pre-order. Throws a sentence a stylist can read. */
export function newPreorderRow(p: PreorderInput) {
  const name = clean(p.name, 200)
  if (!p.clientId) throw new Error('Pick a client first.')
  if (!name) throw new Error('Give the piece a name.')
  const photos = [...new Set(p.photoKeys.filter(Boolean))]
  if (!photos.length) throw new Error('Add at least one photo.')
  const brand = clean(p.brand, 120)
  const price = clean(p.price, 40)
  const description = clean(p.description, 2000)
  const category = clean(p.category, 80)?.toLowerCase() ?? null
  return {
    id: p.id,
    client_id: p.clientId,
    name,
    brand,
    price,
    description,
    category,
    type: 'owned',
    source: 'intake_pipeline',
    primary_image_hash: photos[0],
    is_deleted: true,
    deleted_reason: PREORDER_WAITING,
    display_order: 0,
    content_tag_ids: [],
    custom_categories: [],
    added_at: p.at,
    raw: {
      item_name: name, brand, category, description, manual_add: true,
      preorder: { status: 'waiting' as PreorderStatus, photos, added_at: p.at, added_by: p.by ?? null },
    },
  }
}

/** Every photo of a pre-order, main photo first. Falls back to the row's own photo. */
export function preorderPhotoKeys(row: { raw?: any; primary_image_hash?: string | null; processed_image_hash?: string | null }): string[] {
  const listed = Array.isArray(row?.raw?.preorder?.photos) ? row.raw.preorder.photos.filter((k: unknown) => typeof k === 'string' && k) : []
  const main = row?.processed_image_hash ?? row?.primary_image_hash ?? null
  return [...new Set([...(main ? [main] : []), ...listed])] as string[]
}

/** raw with the pre-order's status moved on, every other key kept as it was. */
function withStatus(raw: any, status: PreorderStatus, at: string, by: string | null | undefined) {
  const base = raw && typeof raw === 'object' ? raw : {}
  const pre = base.preorder && typeof base.preorder === 'object' ? base.preorder : {}
  const stamp = status === 'kept' ? { kept_at: at, kept_by: by ?? null } : status === 'returned' ? { returned_at: at, returned_by: by ?? null } : {}
  return { ...base, preorder: { ...pre, status, ...stamp } }
}

/**
 * KEEP: the same row comes out of hiding into her Collection. added_at moves to now so it reads as
 * new from her stylist. Only a waiting pre-order may be kept (the write also filters on that).
 */
export function keepPatch(raw: any, at: string, by?: string | null) {
  return {
    is_deleted: false,
    deleted_reason: null,
    deleted_at: null,
    deleted_by: null,
    added_at: at,
    raw: withStatus(raw, 'kept', at, by),
  }
}

/** RETURN: off her Pre-orders tab and never into her Collection. The row stays as the record. */
export function returnPatch(raw: any, at: string, by?: string | null) {
  return {
    deleted_reason: PREORDER_RETURNED,
    deleted_at: at,
    deleted_by: by ?? null,
    raw: withStatus(raw, 'returned', at, by),
  }
}

/** Her price as she should read it: a bare number gets a dollar sign, anything typed otherwise stays. */
export function shownPrice(price: string | null | undefined): string | null {
  const t = String(price ?? '').trim()
  if (!t) return null
  return /^\d[\d,]*(\.\d{1,2})?$/.test(t) ? `$${t}` : t
}
