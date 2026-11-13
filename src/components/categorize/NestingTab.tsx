import { useMemo, useState } from 'react'
import { useClosetItems } from '@/hooks/useClosetItems'
import { useClientCategories } from '@/hooks/useClientCategories'
import { useLookCategories } from '@/hooks/useLookCategories'
import { useCategoryNames } from '@/hooks/useCategoryNames'
import { categoriesOf, labelForCategory } from '@/lib/garmentCategory'
import { parentMapFrom } from '@/lib/categoryNesting'
import { pairingsFrom } from '@/lib/categoryPairings'
import { NestingEditor, type NestingEntry } from './NestingEditor'
import { CategoryMapPanel } from './CategoryMapPanel'
import { CustomHeadingPanel } from './CustomHeadingPanel'
import { StandardTreePanel } from './StandardTreePanel'

/**
 * The "Nesting categories" tab. One screen, two taxonomies. (ADR-0113)
 *
 * ADR-0099 says a piece has two kinds of category and every surface must say which, so
 * this one says which, out loud, with a switch:
 *
 *   COLLECTION — the garment categories in her closet. Julia, on Danielle York: Outerwear
 *   with Jackets and Coats inside it. Her Jewelry filter returned 41 of 251 pieces
 *   because nothing recorded that Earrings belong to Jewelry.
 *
 *   LOOKS — the outfit categories on her Looks page. Cynthia, on Janet Foutty: put
 *   SS Office Casual and FW Office Casual inside one Office Casual, and still pick a
 *   season within it. Nesting does that WITHOUT merging, so no look is re-tagged.
 *
 * The editor is shared, so a stylist learns this once.
 */

type Which = 'collection' | 'looks'

export function NestingTab({ clientId, clientName }: { clientId: string | null; clientName?: string }) {
  const [which, setWhich] = useState<Which>('collection')
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
  // Raw categories per piece (no map applied), so the Category map lists every spelling she has.
  const rawCatsByItem = useMemo(() => new Map(items.map((item, k) => [item.id, itemCatSets[k]])), [items, itemCatSets])
  // The name each category had before any rename. It is what a nesting save writes to her row,
  // so taking a rename off later gives back exactly this.
  const baseLabels = useMemo(() => {
    const m = new Map<string, string>()
    for (const cats of itemCatSets) for (const slug of cats) if (!m.has(slug)) m.set(slug, labelForCategory(slug))
    // A group she just made has no pieces of its own, so the pieces never saw it.
    // Union in her stored categories or a new group would vanish the moment it is created.
    for (const r of closet.rows) if (!m.has(r.slug)) m.set(r.slug, r.label ?? labelForCategory(r.slug))
    return m
  }, [itemCatSets, closet.rows])
  const names = useCategoryNames(clientId)
  const pieceEntries = useMemo<NestingEntry[]>(() => {
    const p = pairingsFrom(itemCatSets)
    const out = [...baseLabels].map(([slug, base]) => ({
      slug, label: names.nameOf(slug, base), count: p.get(slug)?.of ?? 0, pairs: p.get(slug)?.with ?? [],
    }))
    return out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }, [itemCatSets, baseLabels, names.nameOf])

  // ── LOOKS ─────────────────────────────────────────────────────────────────
  const { categories, looks, loading: looksLoading, error: looksError, setCategoryParent, createCategory } = useLookCategories(clientId)

  const lookCatSets = useMemo(() => {
    const slugById = new Map(categories.map((c) => [c.id, c.slug]))
    // Archived looks are not on her page, so they must not shape the groups built for it.
    return looks.filter((l) => !l.archived).map((l) => l.categoryIds.map((id) => slugById.get(id)).filter((s): s is string => !!s))
  }, [categories, looks])

  const lookEntries = useMemo<NestingEntry[]>(() => {
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
        <h2 className="text-[15px] tracking-[0.06em]">Nesting categories</h2>
        <div className="flex items-center gap-1 bg-[#F8F7F5] rounded p-0.5 self-start">
          {([['collection', 'Collection'], ['looks', 'Looks']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setWhich(k)}
              className={`px-4 py-1.5 text-[11px] tracking-[0.1em] uppercase rounded transition-colors ${which === k ? 'bg-white text-[#1A1A1A] shadow-sm' : 'text-[#888] hover:text-[#1A1A1A]'}`}
            >{label}</button>
          ))}
        </div>
        <p className="text-[13px] text-[#666] leading-relaxed max-w-[70ch]">
          {which === 'collection'
            ? `Outerwear on top, Jackets and Coats inside it. On ${who}'s Collection the group becomes a heading she can tap, and it returns everything inside it.`
            : `Office Casual on top, the seasonal ones inside it. On ${who}'s Looks page the group returns every look in it, and she can still tap one season on its own. Nothing is merged, so no look is re-tagged.`}
        </p>
      </div>

      {which === 'collection' && <StandardTreePanel clientId={clientId} who={who} />}

      {which === 'collection' && <CustomHeadingPanel clientId={clientId} who={who} />}

      {which === 'collection' && (
        <CategoryMapPanel
          clientId={clientId}
          who={who}
          items={items}
          catsByItem={rawCatsByItem}
          rows={closet.rows}
          setSameAs={closet.setSameAs}
          setParent={closet.setParent}
        />
      )}

      {which === 'collection' ? (
        <NestingEditor
          entries={pieceEntries}
          parentBySlug={closet.parentBySlug}
          setParent={(slug, parent) => closet.setParent(slug, parent, baseLabels.get(slug))}
          createGroup={closet.createGroup}
          rename={(slug, name) => names.rename(slug, name, baseLabels.get(slug) ?? labelForCategory(slug))}
          unit="pieces"
          who={who}
          loading={itemsLoading || closet.loading}
          error={closet.error}
          totalFor={(slug, kids) => totalOver(itemCatSets, slug, kids)}
        />
      ) : (
        <NestingEditor
          entries={lookEntries}
          parentBySlug={lookParents}
          setParent={async (slug, parent) => {
            const id = idBySlug.get(slug)
            if (!id) return { ok: false, message: 'That category could not be found.' }
            return setCategoryParent(id, parent)
          }}
          createGroup={async (label) => {
            const made = await createCategory(label)
            return made ? { ok: true, slug: made.slug } : { ok: false, message: 'That group could not be created.' }
          }}
          unit="looks"
          who={who}
          loading={looksLoading}
          error={looksError}
          totalFor={(slug, kids) => totalOver(lookCatSets, slug, kids)}
        />
      )}
    </div>
  )
}
