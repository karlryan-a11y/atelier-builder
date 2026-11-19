/**
 * THE ORDER OF HER COLLECTION, AFTER RECENCY (Cynthia Dada for Chris Cadieux, 2026-11-18).
 *
 * "In Chris Cadieux's closet, we would like the suit sets to be next to each other on the same
 * line", and "I would also like the capability to drag". So, on top of the newest-first order
 * (lib/closetOrder.ts), two things decide where a piece sits:
 *
 * 1. A SUIT'S JACKET AND PANTS SIT SIDE BY SIDE, jacket first, on their own line: a pair always
 *    starts on an even place, so in a grid of 2 or 4 the two pieces share a row. A pair is a
 *    jacket and a pair of pants (or a skirt) that are both suit pieces (the word "suit" in the
 *    name, or filed under a suit category), from the same brand, whose shown names share the
 *    words that describe the cloth: "Medium Grey Subtle Windowpane Check" blazer and trousers,
 *    "Blue Silk Linen" jacket and pants. Words about the cut (two-button, notch lapel, straight
 *    leg, tailored) never count.
 * 2. A STYLIST'S ORDER WINS. Dragging a piece in Categorize > Collection saves the order of the
 *    whole closet in her own client row (gp_clients.raw.closet_order, a list of piece ids). From
 *    then on the saved order is the order, pairs or not, so a pair she split stays split. A piece
 *    added later is not in the list: it goes to the top (newest first, like today), or straight
 *    beside its suit partner when the partner is already placed. Nothing already placed moves.
 *
 * Every view is the same order narrowed: Suits, a home, page 2. The builder grid and her lookbook
 * both call arrangeCloset on the same newest-first list, so the stylist and the client see the
 * same order. This file is the same byte for byte in atelier-builder and atelier-looks
 * (scripts/check-closet-arrangement.mjs).
 */

export type ArrangeRow = {
  id: string
  name?: string | null
  name_override?: string | null
  brand?: string | null
  category?: string | null
  custom_categories?: string[] | null
}

/** Where the stylist's order lives: her own gp_clients.raw, one list of piece ids. */
export const CLOSET_ORDER_KEY = 'closet_order'

export function savedClosetOrder(raw: unknown): string[] {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[CLOSET_ORDER_KEY] : null
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
}

/** Her raw with the order set (or taken off with null), every other key kept. */
export function withClosetOrder(raw: unknown, ids: string[] | null): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}) }
  if (ids && ids.length) next[CLOSET_ORDER_KEY] = [...new Set(ids)]
  else delete next[CLOSET_ORDER_KEY]
  return next
}

const TOPS = new Set(['jacket', 'jackets', 'blazer', 'blazers', 'coat', 'sportcoat'])
const BOTTOMS = new Set(['pants', 'pant', 'trousers', 'trouser', 'skirt'])
const SUIT_WORDS = new Set(['suit', 'suits', 'tuxedo', 'tux'])
// The cut, the make and the garment itself: never what tells one suit from another.
const NOT_CLOTH = new Set([
  ...TOPS, ...BOTTOMS, ...SUIT_WORDS, 'sport', 'two', 'three', 'piece', 'button', 'single', 'double',
  'breasted', 'notch', 'peak', 'shawl', 'lapel', 'straight', 'leg', 'slim', 'regular', 'wide', 'fit',
  'tailored', 'dress', 'made', 'to', 'measure', 'mtm', 'm', 'w', 'h', 'parts', '2parts', 'half', 'fully',
  'lined', 'unlined', 'flat', 'front', 'pleated', 'classic', 'standard', 'the', 'and', 'with', 'in', 'of', 'a',
])

const wordsOf = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => (w === 'gray' ? 'grey' : w))
const shownName = (r: ArrangeRow) => (r.name_override ?? '').trim() || (r.name ?? '').trim()
const SUIT_SLUG = /(^|-)(suit|suits|tuxedo|tuxedos)(-|$)/

/** 'top' (the jacket) or 'bottom' (the pants or skirt) of a suit, or null for anything else. */
export function suitPart(r: ArrangeRow): 'top' | 'bottom' | null {
  const words = wordsOf(shownName(r))
  const slugs = [r.category ?? '', ...(r.custom_categories ?? [])].map((s) => String(s).trim().toLowerCase().replace(/\s+/g, '-'))
  if (!words.some((w) => SUIT_WORDS.has(w)) && !slugs.some((s) => SUIT_SLUG.test(s))) return null
  const top = words.some((w) => TOPS.has(w))
  const bottom = words.some((w) => BOTTOMS.has(w))
  return top === bottom ? null : top ? 'top' : 'bottom'
}

const clothWords = (r: ArrangeRow) => new Set(wordsOf(shownName(r)).filter((w) => !NOT_CLOTH.has(w)))

/** Each suit piece's partner, both ways (id -> id). Best matches are taken first; a piece has one partner. */
export function suitPairs(rows: ArrangeRow[]): Map<string, string> {
  const tops = rows.filter((r) => suitPart(r) === 'top')
  const bottoms = rows.filter((r) => suitPart(r) === 'bottom')
  const options: { top: string; bottom: string; shared: number; share: number }[] = []
  for (const t of tops) {
    const tw = clothWords(t)
    for (const b of bottoms) {
      const tb = (t.brand ?? '').trim().toLowerCase()
      const bb = (b.brand ?? '').trim().toLowerCase()
      if (tb && bb && tb !== bb) continue
      const bw = clothWords(b)
      const shared = [...tw].filter((w) => bw.has(w)).length
      const share = shared / Math.max(1, Math.min(tw.size, bw.size))
      if (shared >= 2 && share >= 0.75) options.push({ top: t.id, bottom: b.id, shared, share })
    }
  }
  options.sort((a, b) => b.shared - a.shared || b.share - a.share || (a.top + a.bottom < b.top + b.bottom ? -1 : 1))
  const partner = new Map<string, string>()
  for (const o of options) {
    if (partner.has(o.top) || partner.has(o.bottom)) continue
    partner.set(o.top, o.bottom)
    partner.set(o.bottom, o.top)
  }
  return partner
}

/** The list with each pair brought together where its first piece is, jacket first. */
function pairUp<T extends ArrangeRow>(rows: T[], partner: Map<string, string>): T[] {
  const here = new Map(rows.map((r) => [r.id, r]))
  const done = new Set<string>()
  const out: T[] = []
  for (const r of rows) {
    if (done.has(r.id)) continue
    const p = partner.get(r.id)
    const mate = p ? here.get(p) : undefined
    if (mate && !done.has(mate.id)) {
      const [first, second] = suitPart(r) === 'top' ? [r, mate] : [mate, r]
      out.push(first, second)
      done.add(first.id).add(second.id)
    } else {
      out.push(r)
      done.add(r.id)
    }
  }
  return out
}

/** Every pair starts on an even place (a new row of 2 or 4): the next single piece steps in ahead of it. */
function onTheirOwnLine<T extends ArrangeRow>(rows: T[], partner: Map<string, string>): T[] {
  const rest = [...rows]
  const out: T[] = []
  const pairedAt = (k: number) => {
    const p = partner.get(rest[k].id)
    return !!p && (p === rest[k - 1]?.id || p === rest[k + 1]?.id)
  }
  while (rest.length) {
    const isPair = rest.length > 1 && partner.get(rest[0].id) === rest[1].id
    if (isPair && out.length % 2 === 1) {
      let j = -1
      for (let k = 2; k < rest.length; k++) if (!pairedAt(k)) { j = k; break }
      if (j > 0) { out.push(rest.splice(j, 1)[0]); continue }
    }
    out.push(...rest.splice(0, isPair ? 2 : 1))
  }
  return out
}

/**
 * The order she sees, from the pieces of one view in newest-first order. `saved` is the stylist's
 * order (savedClosetOrder); empty means Atelier's own: newest first with each suit's pieces together.
 */
export function arrangeCloset<T extends ArrangeRow>(rows: T[], saved: string[]): T[] {
  const partner = suitPairs(rows)
  if (!saved.length) return onTheirOwnLine(pairUp(rows, partner), partner)
  const place = new Map(saved.map((id, i) => [id, i]))
  const placed = rows.filter((r) => place.has(r.id)).sort((a, b) => place.get(a.id)! - place.get(b.id)!)
  const fresh: T[] = []
  for (const r of rows) {
    if (place.has(r.id)) continue
    const p = partner.get(r.id)
    const at = p && place.has(p) ? placed.findIndex((x) => x.id === p) : -1
    if (at < 0) { fresh.push(r); continue }
    placed.splice(suitPart(r) === 'top' ? at : at + 1, 0, r)
  }
  return [...pairUp(fresh, partner), ...placed]
}

/**
 * The whole closet's new order after a drag in one view. `full` is the closet's order now (every
 * piece, arrangeCloset over all of them), `view` the order on screen. The dragged piece goes before
 * (or after) the one it was dropped on, and the view's pieces are put back into the places they
 * held in the whole closet, so every other piece stays exactly where it was.
 */
export function movedOrder(full: string[], view: string[], dragged: string, target: string, after: boolean): string[] {
  if (dragged === target || !view.includes(dragged)) return full
  const next = view.filter((id) => id !== dragged)
  const at = next.indexOf(target)
  if (at < 0) return full
  next.splice(after ? at + 1 : at, 0, dragged)
  const inView = new Set(view)
  let k = 0
  return full.map((id) => (inView.has(id) ? next[k++] : id))
}
