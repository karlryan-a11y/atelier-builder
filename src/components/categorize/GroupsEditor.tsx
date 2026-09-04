import { useMemo, useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { wouldCycle } from '@/lib/categoryNesting'

/**
 * Building groups: a main category with other categories inside it. (ADR-0113)
 *
 * Presentational and taxonomy-agnostic, because this is needed twice and the screen
 * should not be explained twice. PIECES use it for the closet (Julia, on Danielle
 * York: Outerwear with Jackets and Coats inside). LOOKS use it for outfit categories
 * (Cynthia, on Janet Foutty: Office Casual holding SS Office Casual and FW Office
 * Casual, so the group returns both and a child returns one season).
 *
 * Shaped like the spreadsheets the stylists already write by hand: the group name,
 * then what is in it. Groups on top, everything else in a pool underneath. Two clicks
 * to make one.
 *
 * `pairs` is how often two categories are ALREADY tagged on the same thing, and it
 * orders the picker so the obvious members come first. It COUNTS, it does not
 * CONCLUDE — nothing is ever ticked for her.
 */

export interface GroupEntry {
  slug: string
  label: string
  /** How many pieces (or looks) carry this category. */
  count: number
  /** Other categories on those same pieces/looks, most frequent first. */
  pairs: { slug: string; count: number }[]
}

export interface GroupsEditorProps {
  entries: GroupEntry[]
  parentBySlug: Map<string, string>
  /** Returns false (with a message) when the write did not land. */
  setParent: (slug: string, parent: string | null) => Promise<{ ok: boolean; message?: string }>
  /** "pieces" / "looks" — the noun in the counts. */
  unit: string
  /** The client's first name, for copy. */
  who: string
  loading?: boolean
  error?: string | null
  /** How many of each group's own + members' things there are. */
  totalFor: (slug: string, members: string[]) => number
}

export function GroupsEditor({ entries, parentBySlug, setParent, unit, who, loading, error, totalFor }: GroupsEditorProps) {
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [problem, setProblem] = useState<string | null>(null)
  const [openFor, setOpenFor] = useState<string | null>(null)
  const [draft, setDraft] = useState<Set<string>>(new Set())

  const bySlug = useMemo(() => new Map(entries.map((c) => [c.slug, c])), [entries])
  const pairsOf = useMemo(() => new Map(entries.map((c) => [c.slug, new Map(c.pairs.map((p) => [p.slug, p.count]))])), [entries])

  const members = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const [child, parent] of parentBySlug) {
      if (!bySlug.has(child)) continue
      m.set(parent, [...(m.get(parent) ?? []), child])
    }
    for (const [k, v] of m) m.set(k, v.sort((a, b) => (bySlug.get(b)?.count ?? 0) - (bySlug.get(a)?.count ?? 0)))
    return m
  }, [parentBySlug, bySlug])

  const groups = entries.filter((c) => (members.get(c.slug)?.length ?? 0) > 0)
  const loose = entries.filter((c) => !parentBySlug.has(c.slug) && !(members.get(c.slug)?.length))

  const mark = (slug: string, on: boolean) =>
    setBusy((s) => { const n = new Set(s); if (on) n.add(slug); else n.delete(slug); return n })

  async function move(child: string, parent: string | null) {
    mark(child, true)
    const res = await setParent(child, parent)
    mark(child, false)
    if (!res.ok) setProblem(res.message ?? 'That did not save.')
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
    const co = pairsOf.get(group) ?? new Map<string, number>()
    return entries
      .filter((c) => c.slug !== group)
      .filter((c) => parentBySlug.get(c.slug) !== group)
      .filter((c) => !(members.get(c.slug)?.length))
      .filter((c) => !wouldCycle(c.slug, group, parentBySlug))
      .map((c) => ({ ...c, shared: co.get(c.slug) ?? 0 }))
      .sort((a, b) => b.shared / b.count - a.shared / a.count || b.shared - a.shared || a.label.localeCompare(b.label))
  }

  const Picker = ({ group, label }: { group: string; label: string }) => (
    <div className="mt-3 border border-[#1A1A1A] bg-[#FAF9F7] px-4 py-3 flex flex-col gap-3">
      <p className="text-[12px]">
        What goes inside <strong>{label}</strong>? Tap to choose. The ones already tagged on the
        same {unit} come first.
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

  if (loading) return <p className="text-[#888] text-sm">Loading…</p>
  if (error) {
    return (
      <div className="border border-[#C9A0A0] bg-[#FBF3F3] px-4 py-3 text-[13px]">
        {who}'s categories could not be loaded, so nothing here is safe to change yet. {error}
      </div>
    )
  }
  if (entries.length === 0) return <p className="text-[#888] text-sm">{who} has no categories with {unit} in them yet.</p>

  return (
    <div className="flex flex-col gap-7">
      {problem && <div className="border border-[#C9A0A0] bg-[#FBF3F3] px-4 py-3 text-[13px]">{problem}</div>}

      {groups.length > 0 && (
        <div className="flex flex-col gap-4">
          {groups.map((g) => {
            const kids = members.get(g.slug) ?? []
            return (
              <div key={g.slug} className="border border-[#E8E4DF] bg-white px-4 py-3.5">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[13px] tracking-[0.14em] uppercase">{g.label}</span>
                  <span className="text-[12px] text-[#888] tabular-nums">{totalFor(g.slug, kids)} {unit}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                  {kids.map((k) => (
                    <span key={k} className="inline-flex items-center gap-1.5 border border-[#E8E4DF] bg-[#FAF9F7] pl-2.5 pr-1 py-1 text-[12px]">
                      {bySlug.get(k)?.label ?? k}
                      <span className="text-[#BBB] tabular-nums">{bySlug.get(k)?.count}</span>
                      <button
                        onClick={() => move(k, null)}
                        disabled={busy.has(k)}
                        title={`Take ${bySlug.get(k)?.label ?? k} out of ${g.label}`}
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
            )
          })}
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
          Tap the one that should be the group, then choose what goes inside it. Anything left here
          stays exactly where it is on her site today.
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
    </div>
  )
}
