import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CATEGORY_LABELS } from '@/lib/categorize'
import { labelForCategory } from '@/lib/garmentCategory'
import { displayName, type ClosetItem } from '@/lib/images'
import type { NestingRow } from '@/lib/categoryNesting'

/**
 * HER CATEGORY MAP (ADR-0163). Stylists own it, one client at a time (Karl, 2026-10-02).
 *
 * The audit behind it, over all 88,480 live pieces: 13,045 (15%, on 404 clients) sat under no
 * standard category, so tapping Outerwear, Shoes or Handbags on her page left them out. Most were a
 * stylist's own spelling ("handbags", "jackets", "sweaters", "short") or a sub-type nobody had put
 * under its parent. For each of her categories that is not a standard one, the stylist picks:
 *
 *   Keep separate  her own grouping (Sets, Inspo, 49ers) stays a chip of its own
 *   Same as X      read as X: "handbags" counts, filters and searches as Handbags, and the
 *                  stylist's spelling no longer has a chip of its own
 *   Inside X       its own chip, and also under X: Jackets inside Outerwear
 *
 * Nothing on any piece is rewritten. It is one row per category in client_categories (same_as /
 * group_label), read wherever categories are resolved, so any choice is undone by changing it.
 *
 * Below it, the pieces and looks no map can place: pieces with no name or a screenshot's file name,
 * pieces the name reader files as Other, and published looks with none of their pieces left.
 */

const STANDARD = Object.entries(CATEGORY_LABELS)
  .filter(([slug]) => slug !== 'other')
  .map(([slug, label]) => ({ slug, label }))
const isStandard = (slug: string) => slug in CATEGORY_LABELS
const SCREENSHOT = /^(screen ?shot|screenshot|img[_ -]?\d|s-l\d)/i

export interface MapEntry { slug: string; label: string; count: number; samples: string[] }

export function CategoryMapPanel({ clientId, who, items, catsByItem, rows, setSameAs, setParent }: {
  clientId: string
  who: string
  items: ClosetItem[]
  /** Each piece's categories as resolved WITHOUT the map, so every spelling she has is listed. */
  catsByItem: Map<string, string[]>
  rows: NestingRow[]
  setSameAs: (slug: string, target: string | null, label?: string) => Promise<{ ok: boolean; message?: string }>
  setParent: (slug: string, parent: string | null, label?: string) => Promise<{ ok: boolean; message?: string }>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ slug: string; text: string; bad?: boolean } | null>(null)

  const entries = useMemo<MapEntry[]>(() => {
    const by = new Map<string, MapEntry>()
    for (const item of items) {
      for (const slug of catsByItem.get(item.id) ?? []) {
        if (isStandard(slug)) continue
        const e = by.get(slug) ?? { slug, label: labelForCategory(slug), count: 0, samples: [] }
        e.count++
        if (e.samples.length < 3) e.samples.push(displayName(item))
        by.set(slug, e)
      }
    }
    return [...by.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }, [items, catsByItem])

  const rowBySlug = useMemo(() => new Map(rows.map((r) => [r.slug, r])), [rows])
  const valueOf = (slug: string) => {
    const r = rowBySlug.get(slug)
    if (r?.same_as) return `same:${r.same_as}`
    if (r?.parent_slug) return `in:${r.parent_slug}`
    return ''
  }

  async function choose(e: MapEntry, value: string) {
    setBusy(e.slug)
    setNote(null)
    const [kind, target] = value.split(':')
    const res = kind === 'same'
      ? await setSameAs(e.slug, target, e.label)
      : kind === 'in'
        ? await setParent(e.slug, target, e.label)
        : valueOf(e.slug).startsWith('same:')
          ? await setSameAs(e.slug, null, e.label)
          : await setParent(e.slug, null, e.label)
    setBusy(null)
    setNote(res.ok
      ? { slug: e.slug, text: kind ? `${e.label} now reads ${kind === 'same' ? 'as' : 'inside'} ${labelForCategory(target)} for ${who}.` : `${e.label} is its own category again.` }
      : { slug: e.slug, text: res.message ?? 'That did not save.', bad: true })
  }

  // ── What no map can place ────────────────────────────────────────────────────────────────
  const unnamed = useMemo(
    () => items.filter((i) => { const n = displayName(i).trim(); return !n || SCREENSHOT.test(n) }),
    [items],
  )
  const inOther = useMemo(
    () => items.filter((i) => (catsByItem.get(i.id) ?? ['other'])[0] === 'other'),
    [items, catsByItem],
  )
  const [emptyLooks, setEmptyLooks] = useState<{ id: string; name: string }[] | null>(null)
  useEffect(() => {
    let live = true
    setEmptyLooks(null)
    void (async () => {
      const PAGE = 1000
      const all: { id: string; name: string | null; closet_item_ids: string[] | null }[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('gp_looks')
          .select('id, name, closet_item_ids')
          .eq('client_id', clientId)
          .eq('published', true)
          .is('transitioned_at', null)
          .order('id')
          .range(from, from + PAGE - 1)
        if (error) { console.error('CategoryMapPanel: looks read failed —', error.message); return }
        all.push(...((data ?? []) as any[]))
        if (!data || data.length < PAGE) break
      }
      const liveIds = new Set(items.map((i) => i.id))
      if (live) setEmptyLooks(all.filter((l) => !(l.closet_item_ids ?? []).some((id) => liveIds.has(id))).map((l) => ({ id: l.id, name: l.name ?? 'Untitled look' })))
    })()
    return () => { live = false }
  }, [clientId, items])

  const list = (xs: string[]) => xs.slice(0, 6).join(' · ') + (xs.length > 6 ? ` · and ${xs.length - 6} more` : '')

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[13px] tracking-[0.12em] uppercase">Category map</h3>
        <p className="text-[13px] text-[#666] leading-relaxed max-w-[70ch]">
          Every category {who} has that is not one of the standard ones. Choose how each should read on her
          page. Same as merges it into a standard one. Inside keeps it and also shows it under a standard
          one. Nothing on any piece changes, and you can change it back at any time.
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="text-[13px] text-[#888]">Every category {who} has is a standard one.</p>
      ) : (
        <div className="flex flex-col divide-y divide-[#EEE] border border-[#E8E4DF] rounded-sm">
          {entries.map((e) => (
            <div key={e.slug} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5">
              <div className="min-w-[180px] flex-1">
                <p className="text-[13px] text-[#1A1A1A]">{e.label} <span className="text-[#aaa]">· {e.count} piece{e.count === 1 ? '' : 's'}</span></p>
                <p className="text-[11px] text-[#999] truncate max-w-[420px]">{e.samples.join(' · ')}</p>
              </div>
              <select
                aria-label={`How ${e.label} reads for ${who}`}
                value={valueOf(e.slug)}
                disabled={busy === e.slug}
                onChange={(ev) => void choose(e, ev.target.value)}
                className="text-[12px] border border-[#E8E4DF] rounded-sm px-2 py-1.5 bg-white min-w-[200px]"
              >
                <option value="">Keep separate</option>
                <optgroup label="Same as">
                  {STANDARD.map((c) => <option key={`same:${c.slug}`} value={`same:${c.slug}`}>Same as {c.label}</option>)}
                </optgroup>
                <optgroup label="Inside">
                  {STANDARD.map((c) => <option key={`in:${c.slug}`} value={`in:${c.slug}`}>Inside {c.label}</option>)}
                </optgroup>
              </select>
              {note?.slug === e.slug && (
                <p role="status" className={`basis-full text-[11px] ${note.bad ? 'text-[#b4463c]' : 'text-[#3f7d55]'}`}>{note.text}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 mt-2">
        <h3 className="text-[13px] tracking-[0.12em] uppercase">Needs attention</h3>
        <p className="text-[12px] text-[#666]">
          <span className="text-[#1A1A1A]">{unnamed.length}</span> piece{unnamed.length === 1 ? '' : 's'} with no name or a screenshot file name
          {unnamed.length ? `: ${list(unnamed.map((i) => displayName(i) || '(no name)'))}` : '.'}
        </p>
        <p className="text-[12px] text-[#666]">
          <span className="text-[#1A1A1A]">{inOther.length}</span> piece{inOther.length === 1 ? '' : 's'} filed as Other, under no category
          {inOther.length ? `: ${list(inOther.map((i) => displayName(i) || '(no name)'))}` : '.'}
        </p>
        <p className="text-[12px] text-[#666]">
          {emptyLooks === null
            ? 'Checking published looks…'
            : <><span className="text-[#1A1A1A]">{emptyLooks.length}</span> published look{emptyLooks.length === 1 ? '' : 's'} with none of {who}'s pieces left{emptyLooks.length ? `: ${list(emptyLooks.map((l) => l.name))}` : '.'}</>}
        </p>
      </div>
    </section>
  )
}
