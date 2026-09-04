import { useMemo, useState } from 'react'
import { CornerDownRight, Loader2 } from 'lucide-react'
import { useClosetItems } from '@/hooks/useClosetItems'
import { useClientCategories } from '@/hooks/useClientCategories'
import { categoriesOf, labelForCategory } from '@/lib/garmentCategory'
import { buildTree, wouldCycle } from '@/lib/categoryNesting'
import { pairingsFrom, describePairing } from '@/lib/categoryPairings'

/**
 * The "Nesting" tab — where a stylist says which category sits under which. (ADR-0113)
 *
 * Julia asked for Outerwear as a heading with Jackets and Coats under it. Danielle
 * York's Collection currently offers 37 filters in one flat alphabetical list, and her
 * Jewelry filter returns 41 of her 251 pieces.
 *
 * THIS SCREEN SHOWS HER OWN WORK BACK TO HER. The first version was 37 empty dropdowns
 * in alphabetical order, which made a stylist recall from memory what her closet already
 * records: 44 pieces carry BOTH Jackets and Outerwear, because a stylist put both there.
 * The "Already tagged together" column reports that. It counts, it does not conclude —
 * nothing is pre-selected and no dropdown moves without a person, which is the rule.
 *
 * Ordered by what needs attention: not nested yet, biggest first, so a 64-piece category
 * is the first thing she sees and a 1-piece one is not in her way. Checkboxes because
 * Sleeveless, Cropped, Shortsleeves, Longsleeves, Sweaters, Sweatshirts, Band Tees,
 * Graphic Tees, Button-Downs and Bodysuits all go under Tops, and that should be one
 * action rather than ten.
 */

export function NestingTab({ clientId, clientName }: { clientId: string | null; clientName?: string }) {
  const { items, tagNameById, loading: itemsLoading } = useClosetItems(clientId)
  const { parentBySlug, loading: treeLoading, error, setParent } = useClientCategories(clientId)
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [problem, setProblem] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [bulkParent, setBulkParent] = useState('')

  const tagsFor = (item: (typeof items)[number]) =>
    (item.content_tag_ids ?? []).map((id: string) => tagNameById.get(id)).filter((n): n is string => !!n)

  /** Each piece's categories exactly as tagged, with no nesting applied. */
  const rawSets = useMemo(
    () => items.map((item) => categoriesOf(item, tagsFor(item))),
    [items, tagNameById],
  )

  const pairings = useMemo(() => pairingsFrom(rawSets), [rawSets])

  /** Every category with pieces in it, biggest first. */
  const present = useMemo(
    () => [...pairings.entries()]
      .map(([slug, p]) => ({ slug, label: labelForCategory(slug), count: p.of, pairs: p.with }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    [pairings],
  )

  const unnested = present.filter((c) => !parentBySlug.has(c.slug))
  const nestedRows = present.filter((c) => parentBySlug.has(c.slug))

  /** What her Collection will read once this is saved, rolled up. */
  const preview = useMemo(() => {
    const rolled = new Map<string, number>()
    for (const item of items) {
      for (const c of categoriesOf(item, tagsFor(item), parentBySlug)) rolled.set(c, (rolled.get(c) ?? 0) + 1)
    }
    return buildTree(rolled, parentBySlug, labelForCategory)
  }, [items, tagNameById, parentBySlug])

  const mark = (slug: string, on: boolean) =>
    setSaving((s) => { const n = new Set(s); if (on) n.add(slug); else n.delete(slug); return n })

  async function choose(slug: string, label: string, parent: string | null) {
    setProblem(null)
    mark(slug, true)
    const res = await setParent(slug, parent, label)
    mark(slug, false)
    if (!res.ok) setProblem(res.message)
  }

  /** Nest everything ticked under one category, in one press. */
  async function applyBulk() {
    if (!bulkParent || picked.size === 0) return
    setProblem(null)
    const targets = present.filter((c) => picked.has(c.slug) && c.slug !== bulkParent)
    const failed: string[] = []
    for (const cat of targets) {
      mark(cat.slug, true)
      const res = await setParent(cat.slug, bulkParent, cat.label)
      mark(cat.slug, false)
      if (!res.ok) failed.push(cat.label)
    }
    setPicked(new Set())
    setBulkParent('')
    if (failed.length) setProblem(`Could not move ${failed.join(', ')}. Everything else was saved.`)
  }

  const who = clientName ? clientName.split(' ')[0] : 'this client'
  const GRID = 'grid grid-cols-[28px_minmax(0,1fr)_70px_minmax(0,1.1fr)_210px] gap-3 px-4 py-2.5'

  if (!clientId) return <p className="text-[#888] text-sm">Pick a client first.</p>

  const Head = () => (
    <div className={`${GRID} border-b border-[#E8E4DF] bg-[#FAF9F7] text-[10px] tracking-[0.14em] uppercase text-[#999]`}>
      <span />
      <span>Category</span>
      <span className="text-right">Pieces</span>
      <span>Already tagged together</span>
      <span>Sits under</span>
    </div>
  )

  const Row = ({ cat }: { cat: (typeof present)[number] }) => {
    const top = cat.pairs[0]
    const second = cat.pairs[1]
    return (
      <div className={`${GRID} border-b border-[#F0EDE9] last:border-b-0 items-center`}>
        <input
          type="checkbox"
          checked={picked.has(cat.slug)}
          onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(cat.slug); else n.delete(cat.slug); return n })}
          className="w-3.5 h-3.5 accent-[#1A1A1A]"
          aria-label={`Select ${cat.label}`}
        />
        <span className="text-[13px] truncate">{cat.label}</span>
        <span className="text-[12px] text-[#888] text-right tabular-nums">{cat.count}</span>
        <span className="text-[11.5px] text-[#888] truncate">
          {top ? (
            <>
              {labelForCategory(top.slug)}{' '}
              <span className={top.count === cat.count ? 'text-[#1A1A1A]' : 'text-[#AAA]'}>
                ({describePairing(top, cat.count)})
              </span>
              {second && <span className="text-[#BBB]">, {labelForCategory(second.slug)} ({second.count})</span>}
            </>
          ) : (
            <span className="text-[#BBB]">nothing else</span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <select
            value={parentBySlug.get(cat.slug) ?? ''}
            disabled={saving.has(cat.slug)}
            onChange={(e) => choose(cat.slug, cat.label, e.target.value || null)}
            className="flex-1 min-w-0 border border-[#E8E4DF] px-2 py-1.5 text-[12px] bg-white disabled:opacity-50"
          >
            <option value="">Main category</option>
            {present
              .filter((o) => o.slug !== cat.slug && !wouldCycle(cat.slug, o.slug, parentBySlug))
              .map((o) => <option key={o.slug} value={o.slug}>{o.label}</option>)}
          </select>
          {saving.has(cat.slug) && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#888] shrink-0" />}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 max-w-[1250px]">
      <div className="flex flex-col gap-2">
        <h2 className="text-[15px] tracking-[0.06em]">Nesting</h2>
        <p className="text-[13px] text-[#666] leading-relaxed max-w-[68ch]">
          Put a category underneath another one. On {who}'s Collection the one on top becomes a
          heading she can tap, and it returns everything underneath it as well as its own pieces.
        </p>
        <p className="text-[13px] text-[#666] leading-relaxed max-w-[68ch]">
          "Already tagged together" is what {who}'s pieces say right now. Jackets reading
          "Outerwear (all 44)" means every jacket in her closet is already tagged Outerwear too.
          One spread across several is probably fine where it is.
        </p>
      </div>

      {error && (
        <div className="border border-[#C9A0A0] bg-[#FBF3F3] px-4 py-3 text-[13px]">
          {who}'s categories could not be loaded, so nothing here is safe to change yet. {error}
        </div>
      )}
      {problem && <div className="border border-[#C9A0A0] bg-[#FBF3F3] px-4 py-3 text-[13px]">{problem}</div>}

      {itemsLoading || treeLoading ? (
        <p className="text-[#888] text-sm">Loading…</p>
      ) : present.length === 0 ? (
        <p className="text-[#888] text-sm">{who} has no categories with pieces in them yet.</p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-8 items-start">
          <div className="flex flex-col gap-6">
            {picked.size > 0 && (
              <div className="flex items-center gap-3 flex-wrap border border-[#1A1A1A] bg-[#FAF9F7] px-4 py-3">
                <span className="text-[13px]">{picked.size} selected</span>
                <span className="text-[13px] text-[#888]">put them all under</span>
                <select
                  value={bulkParent}
                  onChange={(e) => setBulkParent(e.target.value)}
                  className="border border-[#E8E4DF] px-2 py-1.5 text-[12px] bg-white min-w-[180px]"
                >
                  <option value="">Choose a category…</option>
                  {present
                    .filter((o) => !picked.has(o.slug))
                    .map((o) => <option key={o.slug} value={o.slug}>{o.label}</option>)}
                </select>
                <button
                  onClick={applyBulk}
                  disabled={!bulkParent || saving.size > 0}
                  className="px-4 py-1.5 text-[12px] tracking-[0.1em] uppercase bg-[#1A1A1A] text-white disabled:opacity-40"
                >
                  Nest them
                </button>
                <button onClick={() => { setPicked(new Set()); setBulkParent('') }} className="text-[12px] text-[#888] hover:text-[#1A1A1A]">
                  Clear
                </button>
              </div>
            )}

            <div className="border border-[#E8E4DF] bg-white">
              <div className="px-4 py-2.5 border-b border-[#E8E4DF] text-[12px] tracking-[0.1em] uppercase">
                Not nested yet
                <span className="ml-2 text-[#888] tracking-normal normal-case">{unnested.length}</span>
              </div>
              {unnested.length === 0 ? (
                <p className="px-4 py-4 text-[13px] text-[#888]">Everything has a place. Nothing left to do.</p>
              ) : (
                <>
                  <Head />
                  {unnested.map((cat) => <Row key={cat.slug} cat={cat} />)}
                </>
              )}
            </div>

            {nestedRows.length > 0 && (
              <div className="border border-[#E8E4DF] bg-white">
                <div className="px-4 py-2.5 border-b border-[#E8E4DF] text-[12px] tracking-[0.1em] uppercase">
                  Nested
                  <span className="ml-2 text-[#888] tracking-normal normal-case">{nestedRows.length}</span>
                </div>
                <Head />
                {nestedRows.map((cat) => <Row key={cat.slug} cat={cat} />)}
              </div>
            )}
          </div>

          <div className="border border-[#E8E4DF] bg-white xl:sticky xl:top-4">
            <div className="px-4 py-2.5 border-b border-[#E8E4DF] bg-[#FAF9F7] text-[10px] tracking-[0.14em] uppercase text-[#999]">
              {who}'s Collection filters
            </div>
            <div className="p-4 flex flex-col gap-1.5 max-h-[70vh] overflow-y-auto">
              {preview.map((node) => (
                <div key={node.slug} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12px] tracking-[0.1em] uppercase">{node.label}</span>
                    <span className="text-[11px] text-[#999] tabular-nums">{node.count}</span>
                  </div>
                  {node.children.map((child) => (
                    <div key={child.slug} className="flex items-baseline justify-between gap-3 pl-4">
                      <span className="text-[12px] text-[#666] flex items-center gap-1.5">
                        <CornerDownRight className="w-3 h-3 text-[#BBB] shrink-0" />
                        {child.label}
                      </span>
                      <span className="text-[11px] text-[#999] tabular-nums">{child.count}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="px-4 py-2.5 border-t border-[#E8E4DF] text-[11px] text-[#888]">
              {nestedRows.length === 0
                ? `${preview.length} filters, all main categories. This is her Collection as it is today.`
                : `${preview.length} main categories. A heading's number includes everything under it.`}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
