import { useMemo, useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { useClosetItems } from '@/hooks/useClosetItems'
import { useClientCategories } from '@/hooks/useClientCategories'
import { categoriesOf, labelForCategory } from '@/lib/garmentCategory'
import { wouldCycle } from '@/lib/categoryNesting'
import { pairingsFrom } from '@/lib/categoryPairings'

/**
 * The "Nesting" tab — a stylist builds groups. (ADR-0113)
 *
 * THIRD SHAPE, and the first two were wrong in the same way: they made the 50 categories
 * the subject of the screen when the 6 GROUPS are the subject. A stylist is not auditing
 * a taxonomy, she is saying "Outerwear holds Jackets and Coats" five or six times.
 *
 * Karl, on the second version: "it's still confusing." So the screen is now shaped like
 * Julia's spreadsheet, which is how she already wrote this down by hand: the group name,
 * then what is in it. Groups on top, an "everything else" pool underneath. Two clicks to
 * make a group: press the category that is the group, tick what goes in it.
 *
 * Ordering inside the picker is her own tagging counted back, best first, so Outerwear
 * opens with Jackets "all 44" and Coats "all 16" at the front. Nothing is ticked for her.
 */

export function NestingTab({ clientId, clientName }: { clientId: string | null; clientName?: string }) {
  const { items, tagNameById, loading: itemsLoading } = useClosetItems(clientId)
  const { parentBySlug, loading: treeLoading, error, setParent } = useClientCategories(clientId)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [problem, setProblem] = useState<string | null>(null)
  const [openFor, setOpenFor] = useState<string | null>(null)
  const [draft, setDraft] = useState<Set<string>>(new Set())

  const tagsFor = (item: (typeof items)[number]) =>
    (item.content_tag_ids ?? []).map((id: string) => tagNameById.get(id)).filter((n): n is string => !!n)

  const itemCatSets = useMemo(() => items.map((item) => categoriesOf(item, tagsFor(item))), [items, tagNameById])
  const pairings = useMemo(() => pairingsFrom(itemCatSets), [itemCatSets])

  const all = useMemo(
    () => [...pairings.entries()]
      .map(([slug, p]) => ({ slug, label: labelForCategory(slug), count: p.of }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    [pairings],
  )
  const bySlug = useMemo(() => new Map(all.map((c) => [c.slug, c])), [all])

  /** group slug -> its members, biggest first. */
  const members = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const [child, parent] of parentBySlug) {
      if (!bySlug.has(child)) continue
      m.set(parent, [...(m.get(parent) ?? []), child])
    }
    for (const [k, v] of m) m.set(k, v.sort((a, b) => (bySlug.get(b)?.count ?? 0) - (bySlug.get(a)?.count ?? 0)))
    return m
  }, [parentBySlug, bySlug])

  const groups = all.filter((c) => (members.get(c.slug)?.length ?? 0) > 0)
  const loose = all.filter((c) => !parentBySlug.has(c.slug) && !(members.get(c.slug)?.length))

  /**
   * What the client's chip for this group will read: its own pieces plus its members'.
   * Counted per piece rather than by summing, because a piece can be in the group AND in
   * one of its members and must not be counted twice.
   */
  const groupTotal = (slug: string) => {
    const kids = members.get(slug) ?? []
    let n = 0
    for (const cats of itemCatSets) if (cats.includes(slug) || kids.some((k) => cats.includes(k))) n++
    return n
  }

  const mark = (slug: string, on: boolean) =>
    setBusy((s) => { const n = new Set(s); if (on) n.add(slug); else n.delete(slug); return n })

  async function move(child: string, parent: string | null) {
    mark(child, true)
    const res = await setParent(child, parent, bySlug.get(child)?.label ?? child)
    mark(child, false)
    if (!res.ok) setProblem(res.message)
    return res.ok
  }

  async function savePicked(group: string) {
    setProblem(null)
    const failed: string[] = []
    for (const slug of draft) if (!(await move(slug, group))) failed.push(bySlug.get(slug)?.label ?? slug)
    setDraft(new Set())
    setOpenFor(null)
    if (failed.length) setProblem(`Could not move ${failed.join(', ')}. Everything else was saved.`)
  }

  /** What can go in this group, most-already-tagged-together first. */
  function candidates(group: string) {
    const co = new Map((pairings.get(group)?.with ?? []).map((p) => [p.slug, p.count]))
    return all
      .filter((c) => c.slug !== group)
      .filter((c) => parentBySlug.get(c.slug) !== group)
      .filter((c) => !(members.get(c.slug)?.length))
      .filter((c) => !wouldCycle(c.slug, group, parentBySlug))
      .map((c) => ({ ...c, shared: co.get(c.slug) ?? 0 }))
      .sort((a, b) => b.shared / b.count - a.shared / a.count || b.shared - a.shared || a.label.localeCompare(b.label))
  }

  const who = clientName ? clientName.split(' ')[0] : 'this client'
  if (!clientId) return <p className="text-[#888] text-sm">Pick a client first.</p>

  const Picker = ({ group, label }: { group: string; label: string }) => (
    <div className="mt-3 border border-[#1A1A1A] bg-[#FAF9F7] px-4 py-3 flex flex-col gap-3">
      <p className="text-[12px]">
        What goes inside <strong>{label}</strong>? Tap to choose. The ones already tagged on the
        same pieces come first.
      </p>
      <div className="flex flex-wrap gap-1.5 max-h-[240px] overflow-y-auto">
        {candidates(group).map((c) => {
          const on = draft.has(c.slug)
          const strong = c.shared > 0 && c.shared === c.count
          return (
            <button
              key={c.slug}
              onClick={() => setDraft((d) => { const n = new Set(d); if (on) n.delete(c.slug); else n.add(c.slug); return n })}
              className={`px-2.5 py-1 text-[12px] border transition-colors ${on ? 'border-[#1A1A1A] bg-[#1A1A1A] text-white' : 'border-[#E8E4DF] bg-white hover:border-[#1A1A1A]'}`}
            >
              {c.label}
              <span className={`ml-1.5 ${on ? 'text-white/70' : strong ? 'text-[#1A1A1A]' : 'text-[#BBB]'}`}>
                {strong ? `all ${c.count}` : c.shared > 0 ? `${c.shared} of ${c.count}` : c.count}
              </span>
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => savePicked(group)}
          disabled={draft.size === 0 || busy.size > 0}
          className="px-4 py-1.5 text-[12px] tracking-[0.1em] uppercase bg-[#1A1A1A] text-white disabled:opacity-40"
        >
          {busy.size > 0 ? 'Saving…' : draft.size ? `Put ${draft.size} in ${label}` : `Put in ${label}`}
        </button>
        <button onClick={() => { setOpenFor(null); setDraft(new Set()) }} className="text-[12px] text-[#888] hover:text-[#1A1A1A]">
          Cancel
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col gap-7 max-w-[900px]">
      <div className="flex flex-col gap-2">
        <h2 className="text-[15px] tracking-[0.06em]">Groups</h2>
        <p className="text-[13px] text-[#666] leading-relaxed max-w-[70ch]">
          Outerwear on top, Jackets and Coats inside it. On {who}'s Collection the group becomes a
          heading she can tap, and it returns everything inside it.
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
      ) : all.length === 0 ? (
        <p className="text-[#888] text-sm">{who} has no categories with pieces in them yet.</p>
      ) : (
        <>
          {groups.length > 0 && (
            <div className="flex flex-col gap-4">
              {groups.map((g) => (
                <div key={g.slug} className="border border-[#E8E4DF] bg-white px-4 py-3.5">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-[13px] tracking-[0.14em] uppercase">{g.label}</span>
                    <span className="text-[12px] text-[#888] tabular-nums">{groupTotal(g.slug)} pieces</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                    {(members.get(g.slug) ?? []).map((k) => (
                      <span key={k} className="inline-flex items-center gap-1.5 border border-[#E8E4DF] bg-[#FAF9F7] pl-2.5 pr-1 py-1 text-[12px]">
                        {labelForCategory(k)}
                        <span className="text-[#BBB] tabular-nums">{bySlug.get(k)?.count}</span>
                        <button
                          onClick={() => move(k, null)}
                          disabled={busy.has(k)}
                          title={`Take ${labelForCategory(k)} out of ${g.label}`}
                          className="text-[#BBB] hover:text-[#1A1A1A] disabled:opacity-40"
                        >
                          {busy.has(k) ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                        </button>
                      </span>
                    ))}
                    <button
                      onClick={() => { setOpenFor(openFor === g.slug ? null : g.slug); setDraft(new Set()) }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] border border-dashed border-[#CFC9C2] text-[#888] hover:text-[#1A1A1A] hover:border-[#1A1A1A]"
                    >
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  </div>
                  {openFor === g.slug && <Picker group={g.slug} label={g.label} />}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <div className="flex items-baseline gap-3">
              <p className="text-[11px] tracking-[0.28em] uppercase text-[#999]">
                {groups.length ? 'Not in a group' : 'Her categories'}
              </p>
              <span className="text-[12px] text-[#BBB] tabular-nums">{loose.length}</span>
            </div>
            <p className="text-[12px] text-[#888] max-w-[70ch]">
              Tap the one that should be the group, then choose what goes inside it. Anything left
              here stays exactly where it is on her Collection today.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {loose.map((c) => (
                <button
                  key={c.slug}
                  onClick={() => { setOpenFor(openFor === c.slug ? null : c.slug); setDraft(new Set()) }}
                  className={`px-2.5 py-1 text-[12px] border transition-colors ${openFor === c.slug ? 'border-[#1A1A1A] bg-[#1A1A1A] text-white' : 'border-[#E8E4DF] bg-white hover:border-[#1A1A1A]'}`}
                >
                  {c.label}
                  <span className={`ml-1.5 tabular-nums ${openFor === c.slug ? 'text-white/70' : 'text-[#BBB]'}`}>{c.count}</span>
                </button>
              ))}
            </div>
            {openFor && !groups.some((g) => g.slug === openFor) && (
              <Picker group={openFor} label={bySlug.get(openFor)?.label ?? openFor} />
            )}
          </div>
        </>
      )}
    </div>
  )
}
