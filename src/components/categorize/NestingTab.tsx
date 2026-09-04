import { useMemo, useState } from 'react'
import { CornerDownRight, Loader2 } from 'lucide-react'
import { useClosetItems } from '@/hooks/useClosetItems'
import { useClientCategories } from '@/hooks/useClientCategories'
import { categoriesOf, labelForCategory } from '@/lib/garmentCategory'
import { buildTree, wouldCycle } from '@/lib/categoryNesting'

/**
 * The "Nesting" tab — where a stylist says which category sits under which. (ADR-0113)
 *
 * Julia asked for Outerwear as a heading with Jackets and Coats under it, and for the
 * same in jewellery. Danielle York's Collection currently offers 37 custom filters in
 * one flat alphabetical list, and her Jewelry filter returns 41 of her 251 pieces
 * because nothing records that Earrings belong to Jewelry.
 *
 * THE STYLIST ASSIGNS EVERY RELATIONSHIP. Karl's decision, and the reason nothing on
 * this screen is pre-selected, suggested, or inferred. The data would support a good
 * guess — 58 of 58 of Danielle's outerwear pieces already carry a child category, so
 * the tree could be proposed — and we do not, deliberately. Every dropdown starts on
 * "Main category" and only a person moves it.
 *
 * Counts are shown because they are facts about her closet, not opinions about where a
 * category belongs: a stylist placing "Sleeveless" should be able to see it holds 64
 * pieces and "Bolero" holds 1.
 */

export function NestingTab({ clientId, clientName }: { clientId: string | null; clientName?: string }) {
  const { items, tagNameById, loading: itemsLoading } = useClosetItems(clientId)
  const { parentBySlug, loading: treeLoading, error, setParent } = useClientCategories(clientId)
  const [saving, setSaving] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  /**
   * Every category this client actually has pieces in, with a count.
   *
   * Deliberately built WITHOUT the nesting tree — this screen shows what is filed
   * directly under each name, so a stylist can see that Jewelry itself holds 41 while
   * she is deciding what to put under it. The rollup is what the client sees; this is
   * the workbench.
   */
  const present = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) {
      const tagNames = (item.content_tag_ids ?? [])
        .map((id: string) => tagNameById.get(id))
        .filter((n): n is string => !!n)
      for (const c of categoriesOf(item, tagNames)) counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([slug, count]) => ({ slug, label: labelForCategory(slug), count }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [items, tagNameById])


  /** What the client's sidebar will look like once this is saved — the rolled-up view. */
  const preview = useMemo(() => {
    const rolled = new Map<string, number>()
    for (const item of items) {
      const tagNames = (item.content_tag_ids ?? [])
        .map((id: string) => tagNameById.get(id))
        .filter((n): n is string => !!n)
      for (const c of categoriesOf(item, tagNames, parentBySlug)) rolled.set(c, (rolled.get(c) ?? 0) + 1)
    }
    return buildTree(rolled, parentBySlug, labelForCategory)
  }, [items, tagNameById, parentBySlug])

  async function choose(slug: string, label: string, parent: string | null) {
    setProblem(null)
    setSaving(slug)
    const res = await setParent(slug, parent, label)
    setSaving(null)
    if (!res.ok) setProblem(res.message)
  }

  const who = clientName ? clientName.split(' ')[0] : 'this client'
  const nested = present.filter((c) => parentBySlug.has(c.slug)).length

  if (!clientId) return <p className="text-[#888] text-sm">Pick a client first.</p>

  return (
    <div className="flex flex-col gap-6 max-w-[1100px]">
      <div className="flex flex-col gap-2">
        <h2 className="text-[15px] tracking-[0.06em]">Nesting</h2>
        <p className="text-[13px] text-[#666] leading-relaxed max-w-[62ch]">
          Put a category underneath another one. On {who}'s Collection, the one on top becomes a
          heading she can tap, and it returns everything underneath it as well as its own pieces.
        </p>
        <p className="text-[13px] text-[#666] leading-relaxed max-w-[62ch]">
          Anything left as a main category stays exactly where it is today. Nothing is filled in for you.
        </p>
      </div>

      {error && (
        <div className="border border-[#C9A0A0] bg-[#FBF3F3] px-4 py-3 text-[13px]">
          {who}'s categories could not be loaded, so nothing here is safe to change yet. {error}
        </div>
      )}
      {problem && (
        <div className="border border-[#C9A0A0] bg-[#FBF3F3] px-4 py-3 text-[13px]">{problem}</div>
      )}

      {itemsLoading || treeLoading ? (
        <p className="text-[#888] text-sm">Loading…</p>
      ) : present.length === 0 ? (
        <p className="text-[#888] text-sm">{who} has no categories with pieces in them yet.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8 items-start">
          {/* ── the assignment list ─────────────────────────────────────────── */}
          <div className="border border-[#E8E4DF] bg-white">
            <div className="grid grid-cols-[minmax(0,1fr)_86px_240px] gap-4 px-4 py-2.5 border-b border-[#E8E4DF] bg-[#FAF9F7] text-[10px] tracking-[0.14em] uppercase text-[#999]">
              <span>Category</span>
              <span className="text-right">Pieces</span>
              <span>Sits under</span>
            </div>
            {present.map((cat) => {
              const current = parentBySlug.get(cat.slug) ?? ''
              return (
                <div
                  key={cat.slug}
                  className="grid grid-cols-[minmax(0,1fr)_86px_240px] gap-4 px-4 py-2.5 border-b border-[#F0EDE9] last:border-b-0 items-center"
                >
                  <span className="text-[13px] truncate">{cat.label}</span>
                  <span className="text-[12px] text-[#888] text-right tabular-nums">{cat.count}</span>
                  <div className="flex items-center gap-2">
                    <select
                      value={current}
                      disabled={saving === cat.slug}
                      onChange={(e) => choose(cat.slug, cat.label, e.target.value || null)}
                      className="flex-1 min-w-0 border border-[#E8E4DF] px-2 py-1.5 text-[12px] bg-white disabled:opacity-50"
                    >
                      <option value="">Main category</option>
                      {present
                        .filter((other) => other.slug !== cat.slug)
                        // A category cannot go under one of its own descendants. Left out of the
                        // list rather than shown and rejected on save, so the stylist never picks
                        // something the resolver would quietly ignore.
                        .filter((other) => !wouldCycle(cat.slug, other.slug, parentBySlug))
                        .map((other) => (
                          <option key={other.slug} value={other.slug}>{other.label}</option>
                        ))}
                    </select>
                    {saving === cat.slug && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#888] shrink-0" />}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── what she will see ───────────────────────────────────────────── */}
          <div className="border border-[#E8E4DF] bg-white">
            <div className="px-4 py-2.5 border-b border-[#E8E4DF] bg-[#FAF9F7] text-[10px] tracking-[0.14em] uppercase text-[#999]">
              {who}'s Collection filters
            </div>
            <div className="p-4 flex flex-col gap-1.5">
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
              {nested === 0
                ? 'Nothing nested yet, so this is her Collection as it is today.'
                : `${nested} of ${present.length} categories nested. A heading's number includes everything under it.`}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
