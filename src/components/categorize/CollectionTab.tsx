import { useEffect, useMemo, useState } from 'react'
import { Pencil, Search, CheckSquare, Square, Tags, Loader2, Eraser, Layers, X, Plus, Check, BookOpen, ExternalLink } from 'lucide-react'
import { useItemLookUsage, type LookLite } from '@/hooks/useItemLookUsage'
import { styledCoverage, coverageByCategory, type StyledCoverage } from '@/lib/styledCoverage'
import { useClosetItems } from '@/hooks/useClosetItems'
import { resolveItemImage, proxyImageUrl, displayName, type ClosetItem } from '@/lib/images'
import { primaryCategoryOf, categoriesOf, labelForCategory, customCategoriesFromItems, slugifyCategory } from '@/lib/garmentCategory'
import { CATEGORY_LABELS } from '@/lib/categorize'
import { supabase } from '@/lib/supabase'
import { requestHeroRefresh } from '@/lib/renderer'
import { EditItemDialog } from '@/components/layout/EditItemDialog'
import { AddItemDialog } from '@/components/layout/AddItemDialog'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { useClientStore } from '@/stores/clientStore'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

// Human labels for the client-edit provenance keys (migration 015).
const FIELD_LABEL: Record<string, string> = { name: 'Name', brand: 'Designer', category: 'Category' }

// COLLECTION tab inside Categorize: the stylist sees the client's collection the way the client
// does (her lookbook's Collection grid) but with per-item edit — hover an item → pencil → edit
// Name / Category / Color / Style Note. Saves to gp_closet_items (the same store the client view
// reads), so changes show in her lookbook. Reuses the closet hook + the canvas EditItemDialog.
// Each item's garment category is resolved with the SAME resolver as the lookbook + Style canvas
// (override → tag → name), so GoodPix carry-overs categorize too. Reports counts up for the rail
// filter and accepts a garment-category filter.
export function CollectionTab({ clientId, filterCategories, residenceSlugs, onCategoryCounts, onCategoryCoverage, onTransitioned }: {
  clientId: string | null
  filterCategories?: Set<string>
  /**
   * slug -> label for this client's HOMES (ADR-0111). Comes from her look_categories rows,
   * because which slugs are homes is a property of the row and not of the word.
   */
  residenceSlugs?: Map<string, string>
  onCategoryCounts?: (counts: Map<string, number>) => void
  /** Styled coverage per rail category, so the sidebar can show where the unstyled pieces are. */
  onCategoryCoverage?: (coverage: Map<string, StyledCoverage>) => void
  /** Called after a stylist transitions a piece out, so the Transitions tab + badge refresh live. */
  onTransitioned?: () => void
}) {
  const { items, tagNameById, loading, error, refetch } = useClosetItems(clientId)
  const { activeClient } = useClientStore()
  const clientFirst = (activeClient?.name ?? 'the client').split(' ')[0]
  const [adding, setAdding] = useState(false)
  const { byItem: lookUsage } = useItemLookUsage(clientId)
  const [looksModal, setLooksModal] = useState<{ name: string; looks: LookLite[] } | null>(null)
  const [editing, setEditing] = useState<ClosetItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [removingBg, setRemovingBg] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [rotating, setRotating] = useState(false)
  // Pending Archive/Transition confirmation (elegant in-app dialog, replaces window.confirm).
  const [confirmState, setConfirmState] = useState<{ kind: 'archive' | 'transition'; item: ClosetItem; lookCount: number } | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  // Drive-verification sweep state (migration 017).
  const [verifyBusy, setVerifyBusy] = useState<Set<string>>(new Set())
  const [unconfirmedOnly, setUnconfirmedOnly] = useState(false)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bgBusy, setBgBusy] = useState(false)
  const [bgProgress, setBgProgress] = useState({ done: 0, total: 0 })

  useEffect(() => { setSelected(new Set()) }, [clientId])
  const toggleSelect = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  // Bulk-set the PRIMARY category on the selected items (chunked .in()). Same store the lookbook reads.
  //
  // "Set category" answers WHAT A PIECE IS, and a piece gets exactly one answer. Naming a
  // RESIDENCE here overwrites the garment type, so the coat stops being Outerwear anywhere in
  // the app. That is not a hypothetical: it happened to 119 of Margaux Ellery's pieces, and to 6
  // more after those were repaired, because the two dropdowns sit side by side and nothing said
  // which was which. A home is not a garment type, so we redirect it to "Also in" — where it is
  // additive and destroys nothing — and say so rather than silently doing something else.
  async function bulkSetCategory(slug: string) {
    if (selected.size === 0) return
    if (residenceSlugs?.has(slug)) {
      const label = residenceSlugs.get(slug) || labelForCategory(slug)
      alert(
        `"${label}" is a home, not a garment type.\n\n` +
        `"Set category" replaces what a piece IS — filing these under ${label} would take them ` +
        `out of Tops, Shoes and Outerwear everywhere.\n\n` +
        `Adding them to ${label} with "＋ Also add to…" instead, which keeps their garment type.`,
      )
      return bulkAddCategory(slug)
    }
    setBulkBusy(true)
    const ids = [...selected]
    let ok = true
    for (let i = 0; i < ids.length && ok; i += 100) {
      const { error: e } = await supabase.from('gp_closet_items').update({ category: slug }).in('id', ids.slice(i, i + 100))
      if (e) { ok = false; alert('Bulk update failed — ' + e.message) }
    }
    setBulkBusy(false)
    if (ok) { setSelected(new Set()); refetch() }
  }

  // Bulk-ADD a category to the selected items' "Also in" list (custom_categories[]) WITHOUT changing
  // their primary category — e.g. tag 30 pieces into "49ers" while they stay in Tops/Bags/etc. Each
  // item keeps its own array, so we update per-item (bounded concurrency) rather than one .in().
  async function bulkAddCategory(slug: string) {
    if (selected.size === 0 || !slug) return
    setBulkBusy(true)
    const byId = new Map(items.map((i) => [i.id, i]))
    const ids = [...selected]
    let ok = true
    let idx = 0
    const run = async (id: string) => {
      const it = byId.get(id)
      const existing = (it?.custom_categories ?? []).map((c) => slugifyCategory(String(c))).filter(Boolean)
      const primary = (it?.category ?? '').trim().toLowerCase()
      if (existing.includes(slug) || primary === slug) return // already there — skip
      const next = [...new Set([...existing, slug])]
      const { error: e } = await supabase.from('gp_closet_items').update({ custom_categories: next }).eq('id', id)
      if (e) ok = false
    }
    const CONC = 5
    await Promise.all(Array.from({ length: Math.min(CONC, ids.length) }, async () => {
      while (idx < ids.length && ok) { const i = ids[idx++]; await run(i) }
    }))
    setBulkBusy(false)
    if (ok) { setSelected(new Set()); refetch() } else alert('Some items could not be updated — try again.')
  }

  // Display only — the one-line label under a card. Filtering uses categoriesByItem below.
  const primaryCategoryByItem = useMemo(() => {
    const m = new Map<string, string>()
    for (const i of items) {
      const tagNames = (i.content_tag_ids ?? []).map((id) => tagNameById.get(id) ?? '').filter(Boolean)
      m.set(i.id, primaryCategoryOf(i, tagNames))
    }
    return m
  }, [items, tagNameById])

  // Every category an item belongs to (primary garment + "Also in" custom_categories) — drives
  // the rail counts + filter so an item in Tops AND 49ers shows under both.
  const categoriesByItem = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const i of items) {
      const tagNames = (i.content_tag_ids ?? []).map((id) => tagNameById.get(id) ?? '').filter(Boolean)
      m.set(i.id, categoriesOf(i, tagNames))
    }
    return m
  }, [items, tagNameById])

  const customCats = useMemo(() => customCategoriesFromItems(items), [items])

  // Report category counts up to the rail (present categories + counts for the filter chips).
  // '__total__' carries the true number of DISTINCT items (not the sum of category counts, which
  // over-counts multi-category pieces) so "All items" can show an accurate total.
  useEffect(() => {
    if (!onCategoryCounts) return
    const counts = new Map<string, number>()
    let total = 0
    for (const i of items) {
      if (i.is_deleted) continue
      total++
      for (const c of categoriesByItem.get(i.id) ?? []) counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    counts.set('__total__', total)
    onCategoryCounts(counts)
  }, [categoriesByItem, items, onCategoryCounts])

  const baseVisible = useMemo(() => {
    let live = items.filter((i) => !i.is_deleted)
    if (filterCategories && filterCategories.size > 0) {
      live = live.filter((i) => (categoriesByItem.get(i.id) ?? []).some((c) => filterCategories!.has(c)))
    }
    const term = q.trim().toLowerCase()
    if (!term) return live
    return live.filter((i) =>
      displayName(i).toLowerCase().includes(term) ||
      (i.category ?? '').toLowerCase().includes(term) ||
      (i.brand ?? '').toLowerCase().includes(term) ||
      // Color lives in the free-text `color` field (the normalized color_family column is empty),
      // so "silver"/"black"/"gold" match the descriptive color text.
      (i.color ?? '').toLowerCase().includes(term))
  }, [items, q, filterCategories, categoriesByItem])
  // Drive-verification progress for the current view (before the "unconfirmed only" filter).
  const verifiedCount = useMemo(() => baseVisible.filter((i) => i.drive_verified_at).length, [baseVisible])
  // Styled coverage over the SAME scope the counts above use, so filtering to Shoes answers
  // "how much of her shoe collection is styled". Costs no read: every piece and every look is
  // already on this screen (ADR-0105).
  const coverage = useMemo(() => styledCoverage(baseVisible.map((i) => i.id), lookUsage), [baseVisible, lookUsage])
  // Per-category coverage for the rail. Deliberately computed over the WHOLE collection, not the
  // filtered view: the rail is how she chooses what to filter TO, so its rows must not change
  // meaning when she taps one. Same buckets as the counts effect above, so the denominators match
  // the numbers already printed beside each row.
  const railCoverage = useMemo(
    () => coverageByCategory(
      items.filter((i) => !i.is_deleted).map((i) => ({ id: i.id, categories: categoriesByItem.get(i.id) ?? [] })),
      lookUsage,
    ),
    [items, categoriesByItem, lookUsage],
  )
  useEffect(() => { onCategoryCoverage?.(railCoverage) }, [railCoverage, onCategoryCoverage])
  const visible = useMemo(
    () => (unconfirmedOnly ? baseVisible.filter((i) => !i.drive_verified_at) : baseVisible),
    [baseVisible, unconfirmedOnly],
  )

  async function save(data: { name_override: string | null; brand: string | null; color: string | null; style_note: string | null; category: string | null; custom_categories?: string[] | null; color_family?: string | null; color_families?: string[] | null }) {
    if (!editing) return
    setSaving(true)
    // If the stylist overrode a field the CLIENT set, that field is no longer "client-owned" — the
    // stylist took it back, so drop it from the provenance list (migration 015).
    const owned = editing.client_edited_fields ?? []
    const patch: Record<string, any> = { ...data }
    if (owned.length) {
      const nextOwned = owned.filter((f) => {
        if (f === 'name') return (data.name_override ?? null) === (editing.name_override ?? null)
        if (f === 'brand') return (data.brand ?? null) === (editing.brand ?? null)
        if (f === 'category') return (data.category ?? null) === (editing.category ?? null)
        return true
      })
      if (nextOwned.length !== owned.length) patch.client_edited_fields = nextOwned.length ? nextOwned : null
    }
    const { error: e } = await supabase.from('gp_closet_items').update(patch).eq('id', editing.id)
    setSaving(false)
    if (e) { console.error('Failed to save item edits:', e); return }
    setEditing(null)
    refetch()
  }

  // "Confirm on Google Drive" — the verification sweep (migration 017). Stamps who + when so the
  // sweep survives across people/sessions; click again to un-confirm. Optimistic so the grid feels
  // instant while confirming hundreds.
  async function toggleDriveVerified(item: ClosetItem) {
    const nowOn = !item.drive_verified_at
    setVerifyBusy((p) => new Set(p).add(item.id))
    const { data: { session } } = await supabase.auth.getSession()
    const { error } = await supabase.from('gp_closet_items')
      .update(nowOn
        ? { drive_verified_at: new Date().toISOString(), drive_verified_by: session?.user?.email ?? null }
        : { drive_verified_at: null, drive_verified_by: null })
      .eq('id', item.id)
    setVerifyBusy((p) => { const n = new Set(p); n.delete(item.id); return n })
    if (error) { alert('Could not update — ' + error.message); return }
    // Mutate in place + light refetch so the count updates without scrolling to top.
    item.drive_verified_at = nowOn ? new Date().toISOString() : null
    refetch()
  }

  // Archive + Transition each open an elegant in-app ConfirmDialog (mobile bottom-sheet / desktop
  // card) instead of a native window.confirm — the confirm layers above the open edit dialog. The
  // Transition path pre-counts affected looks so the copy can name them before the stylist commits.

  // Open the Archive confirm (soft-delete, is_deleted=true; removes from collection + lookbook, reversible).
  function askArchive() {
    if (!editing) return
    setConfirmState({ kind: 'archive', item: editing, lookCount: 0 })
  }

  // Open the Transition-out confirm (client no longer owns it). Pre-query the looks it's styled in.
  async function askTransitionOut() {
    if (!editing || !clientId) return
    const target = editing
    const { data: affected } = await supabase
      .from('gp_looks')
      .select('id')
      .eq('client_id', clientId)
      .contains('closet_item_ids', [target.id])
    setConfirmState({ kind: 'transition', item: target, lookCount: (affected ?? []).length })
  }

  function closeConfirm() { if (!confirmBusy) setConfirmState(null) }

  // Commit the pending Archive or Transition. Archive = soft-delete only. Transition = mark every
  // look styled with the piece, then the piece itself (looks first, so a mid-flight failure leaves
  // the piece visible/retryable). Mirrors the lookbook /api/transition 'out' path + useTransitions. (014)
  async function runConfirm() {
    if (!confirmState || !clientId) return
    const { kind, item } = confirmState
    setConfirmBusy(true)
    try {
      if (kind === 'archive') {
        // Stamp WHO/WHEN/WHY so a hide is never an unexplained mystery again (migration 016).
        const { data: { session } } = await supabase.auth.getSession()
        const { error } = await supabase.from('gp_closet_items')
          .update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: session?.user?.email ?? null, deleted_reason: 'archive' })
          .eq('id', item.id)
        if (error) throw error
      } else {
        const now = new Date().toISOString()
        const { data: affected, error: lqErr } = await supabase
          .from('gp_looks')
          .select('id, transitioned_at, transitioned_item_ids')
          .eq('client_id', clientId)
          .contains('closet_item_ids', [item.id])
        if (lqErr) throw lqErr
        for (const lk of affected ?? []) {
          const ids = new Set<string>([...(lk.transitioned_item_ids ?? []), item.id])
          const { error } = await supabase.from('gp_looks')
            .update({ transitioned_at: lk.transitioned_at ?? now, transitioned_item_ids: [...ids] })
            .eq('id', lk.id).eq('client_id', clientId)
          if (error) throw error
        }
        const { error: uErr } = await supabase.from('gp_closet_items')
          .update({ transitioned_at: now, transition_reason: 'unspecified', transition_source: 'stylist' })
          .eq('id', item.id).eq('client_id', clientId)
        if (uErr) throw uErr
      }
    } catch (e) {
      setConfirmBusy(false)
      alert(`Could not ${confirmState.kind === 'archive' ? 'archive' : 'transition'} this item — ` + (e instanceof Error ? e.message : 'unknown error'))
      return
    }
    setConfirmBusy(false)
    setConfirmState(null)
    setEditing(null)
    refetch()
    // A transition changes the Transitions tab + badge, which read from a separate hook.
    if (kind === 'transition') onTransitioned?.()
  }

  // Remove the item's background → transparent (deterministic strip; declines gracefully when it
  // can't). Updates raw.processed_image (reversible). On success, refetch so the new image shows.
  async function removeBg() {
    if (!editing) return
    setRemovingBg(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-remove-bg-item`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token ?? ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: editing.id, image_url: resolveItemImage(editing) }),
      })
      const d = await resp.json().catch(() => ({}))
      if (!resp.ok || !d?.ok) { alert(d?.reason || d?.error || 'Could not remove the background.'); return }
      // Photo changed → re-bake every look / capsule hero this item is styled into.
      void requestHeroRefresh(editing.id)
      setEditing(null)
      refetch()
    } catch {
      alert('Failed to remove background — try again.')
    } finally {
      setRemovingBg(false)
    }
  }

  // Bulk background removal on the selected items — runs each through the same remover the Edit
  // dialog uses (Photoroom → deterministic fallback). Bounded concurrency so we don't hammer the
  // API; reports how many succeeded (jewelry/thin chains can still decline). Uses Photoroom credits.
  async function bulkRemoveBg() {
    const ids = [...selected]
    if (ids.length === 0 || bgBusy) return
    if (!window.confirm(`Remove the background on ${ids.length} item${ids.length === 1 ? '' : 's'}?\n\nEach runs through the background remover (uses Photoroom credits) and updates the image everywhere it appears. Reversible per item.`)) return
    const byId = new Map(visible.map((i) => [i.id, i]))
    const items = ids.map((id) => byId.get(id)).filter((x): x is ClosetItem => !!x)
    setBgBusy(true); setBgProgress({ done: 0, total: items.length })
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token ?? ''
    let ok = 0, fail = 0, done = 0
    const okIds: string[] = []
    const run = async (item: ClosetItem) => {
      try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-remove-bg-item`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_id: item.id, image_url: resolveItemImage(item) }),
        })
        const d = await resp.json().catch(() => ({}))
        if (resp.ok && d?.ok) { ok++; okIds.push(item.id) } else fail++
      } catch { fail++ }
      finally { done++; setBgProgress({ done, total: items.length }) }
    }
    const CONC = 3
    let idx = 0
    await Promise.all(Array.from({ length: Math.min(CONC, items.length) }, async () => {
      while (idx < items.length) { const i = idx++; await run(items[i]) }
    }))
    // Photos changed → re-bake every look / capsule hero that styles a processed item.
    void requestHeroRefresh(okIds)
    setBgBusy(false); setBgProgress({ done: 0, total: 0 })
    setSelected(new Set())
    refetch()
    alert(`Background removed on ${ok} item${ok === 1 ? '' : 's'}${fail ? ` · ${fail} couldn't be processed (thin/jewelry items or the remover was unavailable — try those individually)` : ''}.`)
  }

  // Replace an item's image with a stylist-uploaded photo (cleaned through Photoroom on the way in).
  // Reversible (raw.bg_backup). Updates the item → shows in builder + lookbook.
  async function replacePhoto(file: File) {
    if (!editing) return
    setReplacing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const fd = new FormData()
      fd.append('item_id', editing.id)
      fd.append('photo', file)
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-replace-closet-image`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token ?? ''}` }, // no Content-Type — browser sets the multipart boundary
        body: fd,
      })
      const d = await resp.json().catch(() => ({}))
      if (!resp.ok || !d?.ok) { alert(d?.error || 'Could not replace the photo.'); return }
      // Photo changed → re-bake every look / capsule hero this item is styled into.
      void requestHeroRefresh(editing.id)
      setEditing(null)
      refetch()
    } catch {
      alert('Failed to replace the photo — try again.')
    } finally {
      setReplacing(false)
    }
  }

  // Rotate the item's photo a quarter-turn clockwise. Done client-side (fetch the bytes through the
  // CORS-safe image-proxy → canvas → 90° turn) then pushed through the SAME reversible replace
  // endpoint replacePhoto uses, so it updates the image everywhere (builder + lookbook) and can be
  // undone the same way. Digitized (intake) items — the ones that come in mis-oriented — already
  // serve a CORS-enabled proxy URL, so the canvas export never taints.
  async function rotate() {
    if (!editing) return
    const src = resolveItemImage(editing)
    if (!src) { alert('This item has no image to rotate.'); return }
    setRotating(true)
    try {
      const resp = await fetch(proxyImageUrl(src))
      if (!resp.ok) throw new Error('load')
      const bmp = await createImageBitmap(await resp.blob())
      // 90° clockwise: new canvas is the source rotated a quarter-turn, so swap the dimensions.
      const canvas = document.createElement('canvas')
      canvas.width = bmp.height
      canvas.height = bmp.width
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas')
      ctx.translate(canvas.width, 0)
      ctx.rotate(Math.PI / 2)
      ctx.drawImage(bmp, 0, 0)
      bmp.close?.()
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
      if (!blob) throw new Error('encode')
      const file = new File([blob], `rotated-${editing.id}.png`, { type: 'image/png' })

      const { data: { session } } = await supabase.auth.getSession()
      const fd = new FormData()
      fd.append('item_id', editing.id)
      fd.append('photo', file)
      const up = await fetch(`${SUPABASE_URL}/functions/v1/intake-replace-closet-image`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token ?? ''}` }, // browser sets the multipart boundary
        body: fd,
      })
      const d = await up.json().catch(() => ({}))
      if (!up.ok || !d?.ok) { alert(d?.error || 'Could not rotate the photo.'); return }
      // Photo changed → re-bake every look / capsule hero this item is styled into.
      void requestHeroRefresh(editing.id)
      setEditing(null)
      refetch()
    } catch {
      alert('Failed to rotate the photo — try again.')
    } finally {
      setRotating(false)
    }
  }

  if (!clientId) return <p className="text-[#888] text-sm">Select a client to view their collection.</p>
  if (loading) return <p className="text-[#888] text-sm">Loading collection…</p>
  if (error) return <p className="text-[#a33] text-sm">Couldn't load collection — {error}</p>

  return (
    <div>
      {/* Verification-sweep SOP (Danielle). Chelsea's team follows this when confirming
          every piece against the Google Drive folder — see the "Confirm on Drive" button below. */}
      <a
        href="/sop/collection-verification.html"
        target="_blank"
        rel="noopener noreferrer"
        className="mb-4 flex items-center gap-2 rounded-sm border border-[#E8E4DF] bg-[#FAF8F5] px-3 py-2 text-[12px] text-[#1A1A1A] hover:border-blush transition-colors"
      >
        <BookOpen className="h-3.5 w-3.5 text-blush" />
        <span className="tracking-[0.04em]"><span className="font-medium">Collection verification SOP</span> — how to confirm every piece against Google Drive</span>
        <ExternalLink className="h-3 w-3 text-[#aaa] ml-auto" />
      </a>
      <div className="mb-5 flex items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#aaa]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search collection…"
            className="pl-8 pr-3 py-2 text-sm border border-[#E8E4DF] rounded-sm focus:outline-none focus:ring-1 focus:ring-blush w-64"
          />
        </div>
        <span className="text-[11px] tracking-[0.1em] uppercase text-[#888]">{baseVisible.length} item{baseVisible.length === 1 ? '' : 's'}</span>
        {/* Drive-verification progress + filter (the SOP sweep). */}
        <span className="text-[11px] tracking-[0.06em] text-[#3f7d55]" title="Pieces confirmed against the Google Drive folder">
          {verifiedCount}/{baseVisible.length} confirmed on Drive
        </span>
        {/* Styled coverage. Published only: a look still in draft is not on her lookbook, so a
            piece in one has not been styled as far as she is concerned. Maegan, 2026-09-04. */}
        <span
          className={`text-[11px] tracking-[0.06em] whitespace-nowrap ${coverage.draftOnly > 0 ? 'text-[#9a6b3f]' : 'text-[#8a7a6a]'}`}
          title={coverage.total === 0
            ? 'Nothing in this collection yet'
            : `${coverage.styled} of ${coverage.total} pieces appear in at least one PUBLISHED look. ${coverage.draftOnly} appear only in looks that were never published, so ${clientFirst} cannot see them. ${coverage.unstyled} have never been in a look.`}
        >
          {coverage.label}
        </span>
        <button
          onClick={() => setUnconfirmedOnly((v) => !v)}
          className={`text-[10px] tracking-[0.14em] uppercase px-2.5 py-1 rounded-sm border transition-colors ${unconfirmedOnly ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' : 'text-[#888] border-[#E8E4DF] hover:text-[#1A1A1A]'}`}
        >{unconfirmedOnly ? 'Showing unconfirmed' : 'Unconfirmed only'}</button>
        <button
          onClick={() => setAdding(true)}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[#1A1A1A] text-white text-[11px] tracking-[0.08em] uppercase hover:bg-black transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> Add Item
        </button>
      </div>

      {visible.length > 0 && (
        <div className="mb-4 flex items-center gap-3 text-[11px] flex-wrap">
          <button
            onClick={() => (selected.size === visible.length ? setSelected(new Set()) : setSelected(new Set(visible.map((i) => i.id))))}
            className="inline-flex items-center gap-1.5 text-[#666] hover:text-[#1A1A1A]"
          >
            {selected.size === visible.length && visible.length > 0 ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
            Select all ({visible.length})
          </button>
          {selected.size > 0 && (
            <button
              onClick={bulkRemoveBg}
              disabled={bgBusy || bulkBusy}
              title="Remove the background on all selected items (uses Photoroom credits)"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-[#1A1A1A] text-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors tracking-[0.08em] uppercase disabled:opacity-50"
            >
              {bgBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eraser className="h-3.5 w-3.5" />}
              {bgBusy ? `Removing ${bgProgress.done}/${bgProgress.total}` : `Remove background (${selected.size})`}
            </button>
          )}
          {selected.size > 0 && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-sm bg-[#1A1A1A] text-white flex-wrap">
              <Tags className="h-3.5 w-3.5" />
              <span className="tracking-[0.08em] uppercase">{selected.size} selected</span>
              {/* Set the PRIMARY garment category (replaces it) */}
              <select
                disabled={bulkBusy}
                defaultValue=""
                title="Set the primary category (replaces the current one)"
                onChange={(e) => {
                  const v = e.target.value
                  if (!v) return
                  if (v === '__new__') { const n = window.prompt('New category name (e.g. Wide Leg Heel Jeans):'); if (n && n.trim()) bulkSetCategory(slugifyCategory(n)) }
                  else bulkSetCategory(v)
                  e.currentTarget.value = ''
                }}
                className="bg-white text-[#1A1A1A] rounded-sm px-2 py-1 text-[11px] focus:outline-none"
              >
                <option value="" disabled>Set category…</option>
                {Object.entries(CATEGORY_LABELS).filter(([s]) => s !== 'other').map(([slug, label]) => <option key={slug} value={slug}>{label}</option>)}
                {customCats.length > 0 && <optgroup label="Custom">{customCats.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}</optgroup>}
                <option value="__new__">＋ New category…</option>
              </select>
              {/* ADD an "Also in" category (keeps the primary; item shows under both) */}
              <select
                disabled={bulkBusy}
                defaultValue=""
                title="Also add to another category — keeps the current one (e.g. add 49ers without leaving Tops)"
                onChange={(e) => {
                  const v = e.target.value
                  if (!v) return
                  if (v === '__new__') { const n = window.prompt('New category name (e.g. 49ers):'); if (n && n.trim()) bulkAddCategory(slugifyCategory(n)) }
                  else bulkAddCategory(v)
                  e.currentTarget.value = ''
                }}
                className="bg-white text-[#1A1A1A] rounded-sm px-2 py-1 text-[11px] focus:outline-none"
              >
                <option value="" disabled>＋ Also add to…</option>
                {Object.entries(CATEGORY_LABELS).filter(([s]) => s !== 'other').map(([slug, label]) => <option key={slug} value={slug}>{label}</option>)}
                {customCats.length > 0 && <optgroup label="Custom">{customCats.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}</optgroup>}
                <option value="__new__">＋ New category…</option>
              </select>
              {bulkBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <button onClick={() => setSelected(new Set())} className="text-white/70 hover:text-white">Clear</button>
            </div>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-[#888] text-sm">{q ? 'No items match your search.' : 'This client has no collection items yet.'}</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {visible.map((item) => {
            const img = resolveItemImage(item)
            const isSel = selected.has(item.id)
            const verified = !!item.drive_verified_at
            return (
              <div key={item.id} className={`group relative border rounded-sm overflow-hidden bg-white ${isSel ? 'border-[#1A1A1A] ring-1 ring-[#1A1A1A]/15' : verified ? 'border-[#3f7d55]/50 ring-1 ring-[#3f7d55]/20' : 'border-[#E8E4DF]'}`}>
                <button
                  title="Select for bulk category"
                  onClick={() => toggleSelect(item.id)}
                  className={`absolute top-1.5 left-1.5 z-10 p-1.5 rounded-sm bg-white/90 shadow-sm transition-opacity ${isSel ? 'opacity-100 text-[#1A1A1A]' : 'opacity-0 group-hover:opacity-100 text-[#bbb] hover:text-[#1A1A1A]'}`}
                >
                  {isSel ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                </button>
                <button
                  title="Edit item"
                  onClick={() => setEditing(item)}
                  className="absolute top-1.5 right-1.5 z-10 p-1.5 rounded-sm bg-white/90 text-[#888] opacity-0 group-hover:opacity-100 hover:text-[#1A1A1A] transition-opacity shadow-sm"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <div className="aspect-square bg-[#F8F7F5] flex items-center justify-center">
                  {img ? (
                    <img src={img} alt={displayName(item)} className="max-w-full max-h-full object-contain p-2.5" loading="lazy" />
                  ) : (
                    <span className="text-[10px] tracking-[0.2em] uppercase text-[#bbb]">No image</span>
                  )}
                </div>
                <div className="px-3 py-2.5">
                  {/* Designer above the item name, the way a garment label reads. Scraped brands come
                      through as '' or the literal 'None' — both mean "we don't know it", and the gap
                      is worth surfacing so it can be filled in place. */}
                  {(() => {
                    const brand = (item.brand ?? '').trim()
                    if (brand && brand !== 'None') {
                      return <p className="text-[10px] tracking-[0.18em] uppercase text-[#1A1A1A] truncate">{brand}</p>
                    }
                    return (
                      <button
                        onClick={() => setEditing(item)}
                        className="text-[10px] tracking-[0.18em] uppercase text-[#c4c0ba] hover:text-[#1A1A1A] transition-colors truncate"
                        title="Add the designer for this piece"
                      >
                        + Designer
                      </button>
                    )
                  })()}
                  <p className="text-[13px] text-[#1A1A1A] truncate mt-0.5">{displayName(item) || 'Untitled item'}</p>
                  <p className="text-[10px] tracking-[0.18em] uppercase text-[#aaa] mt-0.5 truncate">{labelForCategory(primaryCategoryByItem.get(item.id) ?? 'other')}</p>
                  {/* Level 1: badge when the CLIENT set one of these fields, so the stylist can tell
                      client edits from ours before touching them (migration 015). */}
                  {(item.client_edited_fields?.length ?? 0) > 0 && (() => {
                    const labels = (item.client_edited_fields ?? []).map((f) => FIELD_LABEL[f] ?? f)
                    const when = item.client_edited_at ? new Date(item.client_edited_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''
                    return (
                      <p className="mt-1.5 text-[10px] tracking-[0.04em] text-[#8a7a6a] truncate" title={`Set by ${clientFirst}${when ? ` · ${when}` : ''}`}>
                        ✦ {labels.join(' & ')} set by {clientFirst}{when ? ` · ${when}` : ''}
                      </p>
                    )
                  })()}
                  {(() => {
                    const looks = lookUsage.get(item.id) ?? []
                    if (looks.length === 0) return <p className="text-[10px] text-[#c4c0ba] mt-1.5">Not yet styled</p>
                    // The card must agree with the header. A piece whose only looks are drafts is
                    // counted UNSTYLED above, so it may not read "Styled in 3 looks" here.
                    const pub = looks.filter((l) => l.published).length
                    const draft = looks.length - pub
                    return (
                      <button
                        onClick={() => setLooksModal({ name: displayName(item) || 'Item', looks })}
                        className={`mt-1.5 inline-flex items-center gap-1 text-[11px] transition-colors hover:text-[#1A1A1A] ${pub === 0 ? 'text-[#9a6b3f]' : 'text-[#8a7a6a]'}`}
                        title={pub === 0
                          ? `Only in ${draft} unpublished look${draft === 1 ? '' : 's'}, so ${clientFirst} cannot see this piece styled yet`
                          : 'See the looks this item is styled in'}
                      >
                        <Layers className="h-3 w-3" />
                        {pub === 0
                          ? <>In {draft} draft look{draft === 1 ? '' : 's'}</>
                          : <>Styled in {pub} look{pub === 1 ? '' : 's'}{draft > 0 ? ` · ${draft} draft` : ''}</>}
                      </button>
                    )
                  })()}
                  {/* Verification sweep: confirm this piece exists in the Google Drive folder (migration 017). */}
                  <button
                    onClick={() => toggleDriveVerified(item)}
                    disabled={verifyBusy.has(item.id)}
                    title={verified ? `Confirmed on Google Drive${item.drive_verified_by ? ` by ${item.drive_verified_by}` : ''}${item.drive_verified_at ? ` · ${new Date(item.drive_verified_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''} — click to undo` : 'Confirm this piece exists in the Google Drive folder'}
                    className={`mt-2.5 w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] tracking-[0.14em] uppercase rounded-sm transition-colors disabled:opacity-50 ${verified ? 'bg-[#e7f0ea] text-[#3f7d55] hover:bg-[#dbeae0]' : 'border border-[#E8E4DF] text-[#888] hover:text-[#1A1A1A] hover:border-[#c9c2b8]'}`}
                  >
                    {verified
                      ? <><Check className="h-3 w-3" /> Confirmed on Drive</>
                      : <>Confirm on Google Drive</>}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {adding && clientId && <AddItemDialog clientId={clientId} clientName={activeClient?.name} customCategories={customCats} residenceSlugs={residenceSlugs} onClose={() => setAdding(false)} onAdded={refetch} />}
      {editing && <EditItemDialog item={editing} saving={saving} customCategories={customCats} residenceSlugs={residenceSlugs} enableMultiCategory enableMultiColor imageUrl={(() => { const s = resolveItemImage(editing); return s ? proxyImageUrl(s) : null })()} onSave={save} onClose={() => setEditing(null)} onRemoveBackground={removeBg} removingBg={removingBg} onReplacePhoto={replacePhoto} replacing={replacing} onRotate={rotate} rotating={rotating} onArchive={askArchive} onTransitionOut={askTransitionOut} clientEditedFields={editing.client_edited_fields} clientFirst={clientFirst} />}

      {confirmState && (() => {
        const name = displayName(confirmState.item) || 'this piece'
        const firstName = (activeClient?.name ?? 'the client').split(' ')[0]
        const n = confirmState.lookCount
        if (confirmState.kind === 'archive') {
          return (
            <ConfirmDialog
              open eyebrow="Collection" title="Archive this piece?"
              body={<><span className="text-[#1A1A1A]">{name}</span> will be removed from {firstName}’s collection and lookbook. You can restore it later.</>}
              confirmLabel="Archive" tone="danger" busy={confirmBusy}
              onConfirm={runConfirm} onCancel={closeConfirm}
            />
          )
        }
        return (
          <ConfirmDialog
            open eyebrow="No longer owned" title="Transition out this piece?"
            body={<><span className="text-[#1A1A1A]">{name}</span> will be removed from {firstName}’s collection{n > 0 ? <>, along with the {n} look{n === 1 ? '' : 's'} styled with {n === 1 ? 'it' : 'them'}.</> : '.'}</>}
            confirmLabel="Transition Out" busy={confirmBusy}
            onConfirm={runConfirm} onCancel={closeConfirm}
          />
        )
      })()}

      {looksModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 md:p-8" onClick={() => setLooksModal(null)}>
          <div className="bg-white rounded-sm max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E4DF]">
              <div>
                {(() => {
                  const pub = looksModal.looks.filter((l) => l.published).length
                  const draft = looksModal.looks.length - pub
                  return (
                    <p className="text-[10px] tracking-[0.25em] uppercase text-[#aaa]">
                      Styled in {pub} look{pub === 1 ? '' : 's'}{draft > 0 ? ` · ${draft} draft` : ''}
                    </p>
                  )
                })()}
                <p className="text-[15px] text-[#1A1A1A] mt-0.5">{looksModal.name}</p>
              </div>
              <button onClick={() => setLooksModal(null)} className="text-[#999] hover:text-[#1A1A1A]" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <div className="overflow-y-auto p-5">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {looksModal.looks.map((lk) => (
                  <div key={lk.id} className="border border-[#E8E4DF] rounded-sm overflow-hidden bg-white">
                    <div className="aspect-[3/4] bg-[#F8F7F5] flex items-center justify-center overflow-hidden">
                      {lk.image
                        ? <img src={lk.image} alt={lk.name} className="max-w-full max-h-full object-contain" loading="lazy" />
                        : <span className="text-[10px] tracking-[0.2em] uppercase text-[#bbb]">No preview</span>}
                    </div>
                    <p className="text-[12px] text-[#1A1A1A] truncate px-2.5 py-2">
                      {lk.name}
                      {!lk.published && <span className="ml-1.5 text-[10px] tracking-[0.14em] uppercase text-[#9a6b3f]">Draft</span>}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
