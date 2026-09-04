import { useMemo, useState } from 'react'
import { useClosetItems } from '@/hooks/useClosetItems'
import { useClientCategories } from '@/hooks/useClientCategories'
import { useLookCategories } from '@/hooks/useLookCategories'
import { categoriesOf, labelForCategory } from '@/lib/garmentCategory'
import { parentMapFrom } from '@/lib/categoryNesting'
import { pairingsFrom } from '@/lib/categoryPairings'
import { GroupsEditor, type GroupEntry } from './GroupsEditor'

/**
 * The "Groups" tab. One screen, two taxonomies. (ADR-0113)
 *
 * ADR-0099 says a piece has two kinds of category and every surface must say which, so
 * this one says which, out loud, with a switch:
 *
 *   PIECES — the garment categories in her closet. Julia, on Danielle York: Outerwear
 *   with Jackets and Coats inside it. Her Jewelry filter returned 41 of 251 pieces
 *   because nothing recorded that Earrings belong to Jewelry.
 *
 *   LOOKS — the outfit categories on her Looks page. Cynthia, on Janet Foutty: put
 *   SS Office Casual and FW Office Casual inside one Office Casual, and still pick a
 *   season within it. Nesting does that WITHOUT merging, so no look is re-tagged.
 *
 * The editor is shared, so a stylist learns this once.
 */

type Which = 'pieces' | 'looks'

export function NestingTab({ clientId, clientName }: { clientId: string | null; clientName?: string }) {
  const [which, setWhich] = useState<Which>('pieces')
  const who = clientName ? clientName.split(' ')[0] : 'this client'

  // ── PIECES ────────────────────────────────────────────────────────────────
  const { items, tagNameById, loading: itemsLoading } = useClosetItems(clientId)
  const closet = useClientCategories(clientId)

  const itemCatSets = useMemo(
    () => items.map((item) => categoriesOf(
      item,
      (item.content_tag_ids ?? []).map((id: string) => tagNameById.get(id)).filter((n): n is string => !!n),
    )),
    [items, tagNameById],
  )
  const pieceEntries = useMemo<GroupEntry[]>(() => {
    const p = pairingsFrom(itemCatSets)
    return [...p.entries()]
      .map(([slug, v]) => ({ slug, label: labelForCategory(slug), count: v.of, pairs: v.with }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }, [itemCatSets])

  // ── LOOKS ─────────────────────────────────────────────────────────────────
  const { categories, looks, loading: looksLoading, setCategoryParent } = useLookCategories(clientId)

  const lookCatSets = useMemo(() => {
    const slugById = new Map(categories.map((c) => [c.id, c.slug]))
    // Archived looks are not on her page, so they must not shape the groups built for it.
    return looks.filter((l) => !l.archived).map((l) => l.categoryIds.map((id) => slugById.get(id)).filter((s): s is string => !!s))
  }, [categories, looks])

  const lookEntries = useMemo<GroupEntry[]>(() => {
    const p = pairingsFrom(lookCatSets)
    const labelBySlug = new Map(categories.map((c) => [c.slug, c.label ?? c.slug]))
    return categories
      .filter((c) => !c.is_hidden)
      .map((c) => ({
        slug: c.slug,
        label: labelBySlug.get(c.slug) ?? c.slug,
        count: p.get(c.slug)?.of ?? 0,
        pairs: p.get(c.slug)?.with ?? [],
      }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }, [categories, lookCatSets])

  const lookParents = useMemo(
    () => parentMapFrom(categories.map((c) => ({ slug: c.slug, label: c.label, parent_slug: c.parent_slug, sort_order: c.sort_order }))),
    [categories],
  )
  const idBySlug = useMemo(() => new Map(categories.map((c) => [c.slug, c.id])), [categories])

  /** A group's total counts each thing ONCE, even when it carries the group and a member. */
  const totalOver = (sets: string[][], slug: string, kids: string[]) => {
    let n = 0
    for (const cats of sets) if (cats.includes(slug) || kids.some((k) => cats.includes(k))) n++
    return n
  }

  if (!clientId) return <p className="text-[#888] text-sm">Pick a client first.</p>

  return (
    <div className="flex flex-col gap-6 max-w-[900px]">
      <div className="flex flex-col gap-3">
        <h2 className="text-[15px] tracking-[0.06em]">Groups</h2>
        <div className="flex items-center gap-1 bg-[#F8F7F5] rounded p-0.5 self-start">
          {([['pieces', 'Pieces'], ['looks', 'Looks']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setWhich(k)}
              className={`px-4 py-1.5 text-[11px] tracking-[0.1em] uppercase rounded transition-colors ${which === k ? 'bg-white text-[#1A1A1A] shadow-sm' : 'text-[#888] hover:text-[#1A1A1A]'}`}
            >{label}</button>
          ))}
        </div>
        <p className="text-[13px] text-[#666] leading-relaxed max-w-[70ch]">
          {which === 'pieces'
            ? `Outerwear on top, Jackets and Coats inside it. On ${who}'s Collection the group becomes a heading she can tap, and it returns everything inside it.`
            : `Office Casual on top, the seasonal ones inside it. On ${who}'s Looks page the group returns every look in it, and she can still tap one season on its own. Nothing is merged, so no look is re-tagged.`}
        </p>
      </div>

      {which === 'pieces' ? (
        <GroupsEditor
          entries={pieceEntries}
          parentBySlug={closet.parentBySlug}
          setParent={(slug, parent) => closet.setParent(slug, parent, pieceEntries.find((e) => e.slug === slug)?.label)}
          unit="pieces"
          who={who}
          loading={itemsLoading || closet.loading}
          error={closet.error}
          totalFor={(slug, kids) => totalOver(itemCatSets, slug, kids)}
        />
      ) : (
        <GroupsEditor
          entries={lookEntries}
          parentBySlug={lookParents}
          setParent={async (slug, parent) => {
            const id = idBySlug.get(slug)
            if (!id) return { ok: false, message: 'That category could not be found.' }
            return setCategoryParent(id, parent)
          }}
          unit="looks"
          who={who}
          loading={looksLoading}
          totalFor={(slug, kids) => totalOver(lookCatSets, slug, kids)}
        />
      )}
    </div>
  )
}
