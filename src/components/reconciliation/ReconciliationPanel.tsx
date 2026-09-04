import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Copy, Tag, AlertTriangle, ImageOff, Sparkles, Loader2, ShieldCheck, Pencil, Trash2, Cloud, X, FolderInput, CheckSquare, Square, Tags } from 'lucide-react'
import { useClientStore } from '@/stores/clientStore'
import { useAuditStore } from '@/stores/auditStore'
import { useReconciliation, fetchUploadedFingerprints, fetchIngestedPhotos, type IngestedPhoto } from '@/hooks/useReconciliation'
import { supabase } from '@/lib/supabase'
import { resolveItemImage, proxyImageUrl, type ClosetItem } from '@/lib/images'
import { EditItemDialog } from '@/components/layout/EditItemDialog'
import { signInAndPickPhotos, downloadDriveFile, isGoogleDriveConfigured, type DriveFile } from '@/lib/googleDrive'
import { checkDriveFolder, type DriveCheckResult } from '@/lib/driveReconcile'
import { dHashFromUrl, hamming, pool } from '@/lib/imageHash'
import { getCachedHashes, putCachedHashes } from '@/lib/hashCache'
import { getResolved, addResolved, clearResolved, isResolved, type ResolveReason } from '@/lib/auditResolve'
import { CATEGORY_LABELS } from '@/lib/categorize'
import { slugifyCategory, labelForCategory } from '@/lib/garmentCategory'
import {
  computeStatuses, effectiveName, isMissingName, isMissingBrand,
  canRecover, FLAG_META, type ReconRow, type ReconFlag, type FilterKey,
} from '@/lib/reconcile'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

// A Drive file scored by the waterfall: how many independent signals matched it to the
// uploaded record, and the verdict — 'review' (weak/partial match, eyeball it) or 'missing'
// (zero signals → never uploaded).
type ScoredFile = { file: DriveFile; hits: number; signals: string[]; verdict: 'review' | 'missing' }
// A Drive file that DID confidently match — kept so the user can open the "matched" view and
// verify each pairing (Drive photo ↔ the item it matched) rather than trusting a bare count.
type MatchedFile = { file: DriveFile; hits: number; signals: string[]; intakeItemId: string | null; status: 'approved' | 'pending' | 'rejected' | 'unused' }

const TONE: Record<string, string> = {
  good: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  bad:  'bg-rose-50 text-rose-700 border-rose-200',
  warn: 'bg-amber-50 text-amber-700 border-amber-200',
  info: 'bg-slate-100 text-slate-600 border-slate-200',
}
const FLAG_ICON: Record<ReconFlag | 'clean', typeof CheckCircle2> = {
  clean: CheckCircle2, duplicate: Copy, goodpix: Tag, no_name: AlertTriangle, no_brand: AlertTriangle, no_original: ImageOff,
}

// Build the ClosetItem shape the shared EditItemDialog expects, from a recon row.
function toClosetItem(r: ReconRow): ClosetItem {
  return {
    id: r.id, client_id: r.client_id, name: r.name, name_override: r.name_override,
    style_note: r.style_note, category: r.category, custom_categories: r.custom_categories,
    brand: r.brand ?? '', color: r.color,
    color_family: r.color_family, color_families: r.color_families,
    content_tag_ids: [], is_deleted: false,
    raw: { ...r.raw, ...(r.liveUrl ? { processed_image: r.liveUrl } : {}) },
    primary_image_hash: r.primary_image_hash, processed_image_hash: r.processed_image_hash,
    source: r.source, added_at: r.added_at,
  }
}

export function ReconciliationPanel() {
  const activeClient = useClientStore((s) => s.activeClient)
  const clientId = activeClient?.id ?? null
  const { rows, loading, error, refetch } = useReconciliation(clientId)
  const { filter, setFilter, setCounts, setDriveDrops } = useAuditStore()
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<ReconRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [removingBg, setRemovingBg] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [rotating, setRotating] = useState(false)
  // Google Drive drop-check
  const [driveBusy, setDriveBusy] = useState(false)
  const [driveResult, setDriveResult] = useState<DriveCheckResult | null>(null)
  const [driveSource, setDriveSource] = useState('')
  const [dropUrls, setDropUrls] = useState<Record<string, string>>({})
  const [driveErr, setDriveErr] = useState<string | null>(null)
  // Zoom / compare lightbox + multi-select bulk categorize
  const [lightbox, setLightbox] = useState<{ original: string | null; live: string | null; name: string } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [foldering, setFoldering] = useState(false)
  const [mergeFrom, setMergeFrom] = useState('')
  const [mergeTo, setMergeTo] = useState('')
  const [merging, setMerging] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [recProgress, setRecProgress] = useState({ done: 0, total: 0 })
  // Deep photo match (perceptual hash) — compares the Drive folder to the collection by pixels
  const [deepBusy, setDeepBusy] = useState(false)
  const [deepPhase, setDeepPhase] = useState('')
  const [deepProgress, setDeepProgress] = useState({ done: 0, total: 0 })
  const [deepResult, setDeepResult] = useState<{ source: string; totalFiles: number; inCollection: number; inNeedsReview: number; otherIngested: number; candidates: ScoredFile[]; matched: MatchedFile[]; resolvedHidden: number } | null>(null)
  const [candLightbox, setCandLightbox] = useState<string | null>(null) // Drive file id open in the review popup
  const [showMatched, setShowMatched] = useState(false) // reveal the confidently-matched files to spot-check
  const [driveToken, setDriveToken] = useState<string | null>(null)
  const [selectedMissing, setSelectedMissing] = useState<Set<string>>(new Set())
  const [digCat, setDigCat] = useState<{ slug: string; label: string } | null>(null) // category to tag digitized gaps with
  const [digitizing, setDigitizing] = useState(false)
  const [digitizeMsg, setDigitizeMsg] = useState('')
  // Image-match (Option B): pixel-fingerprint the unmatched remainder to catch renamed/
  // re-exported folders whose filenames no longer line up with the originals.
  const [pixelBusy, setPixelBusy] = useState(false)
  const [pixelPhase, setPixelPhase] = useState('')
  const [pixelProgress, setPixelProgress] = useState({ done: 0, total: 0 })
  // Carried from the filename pass so the image pass can extend it without re-running everything.
  const ingestedRef = useRef<IngestedPhoto[]>([])
  const matchSetsRef = useRef<{ collectionItems: Set<string>; needsReviewItems: Set<string>; otherItems: Set<string>; uploadedNoItem: number }>({ collectionItems: new Set(), needsReviewItems: new Set(), otherItems: new Set(), uploadedNoItem: 0 })

  const statuses = useMemo(() => computeStatuses(rows), [rows])

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: rows.length, clean: 0, unreviewed: 0, drive_drops: 0, duplicate: 0, no_name: 0, no_brand: 0, no_original: 0, goodpix: 0 }
    for (const r of rows) {
      const st = statuses.get(r.id)!
      if (st.flags.size === 0) c.clean++
      for (const f of st.flags) c[f]++
      if (!r.reconciled_at) c.unreviewed++
    }
    return c
  }, [rows, statuses])

  // Publish counts to the store so the sidebar filter rail can show them.
  useEffect(() => { setCounts(counts) }, [counts, setCounts])
  // Reset the Drive-drops chip + active filter + selection when switching clients.
  useEffect(() => { setDriveResult(null); setDropUrls({}); setDriveDrops(null); setFilter('all'); setSelected(new Set()) }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSelected(new Set()) }, [filter])

  const visible = useMemo(() => {
    if (filter === 'all') return rows
    if (filter === 'drive_drops') return [] // rendered separately from Drive results
    if (filter === 'clean') return rows.filter((r) => statuses.get(r.id)!.flags.size === 0)
    if (filter === 'unreviewed') return rows.filter((r) => !r.reconciled_at)
    const out = rows.filter((r) => statuses.get(r.id)!.flags.has(filter))
    // In the Duplicates view, keep each pair/family together and put the copy to KEEP first,
    // the one to REMOVE next, so the two sit side by side for an eyeball check.
    if (filter === 'duplicate') {
      const roleRank = (role?: string) => (role === 'keep' ? 0 : role === 'remove' ? 1 : 2)
      return [...out].sort((a, b) => {
        const sa = statuses.get(a.id)!, sb = statuses.get(b.id)!
        const ka = sa.dupKey ?? '', kb = sb.dupKey ?? ''
        if (ka !== kb) return ka < kb ? -1 : 1
        return roleRank(sa.dupRole) - roleRank(sb.dupRole)
      })
    }
    return out
  }, [rows, filter, statuses])

  // intake_item_id → its live closet row, so the "matched" view can pair a Drive photo with the
  // exact item it matched (for visual spot-checking). Needs-Review items aren't in rows.
  const rowByIntakeId = useMemo(() => {
    const m = new Map<string, ReconRow>()
    for (const r of rows) if (r.intake_item_id) m.set(r.intake_item_id, r)
    return m
  }, [rows])

  // Custom categories already in use by this client (so the bulk picker offers them). Read from
  // BOTH the primary `category` AND the "Also in" list — a category that exists only as an "Also in"
  // is still one of this client's categories, and reading primaries alone hid it from every picker.
  const customCats = useMemo(() => {
    const m = new Map<string, string>()
    const add = (c: string | null | undefined) => {
      const slug = (c ?? '').trim().toLowerCase()
      if (slug && !(slug in CATEGORY_LABELS)) m.set(slug, labelForCategory(slug))
    }
    for (const r of rows) { add(r.category); for (const cc of r.custom_categories ?? []) add(String(cc)) }
    return [...m.entries()].map(([slug, label]) => ({ slug, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [rows])

  // Categories actually in use (for the merge tool), with item counts. Counts a piece once for its
  // primary category and once for each "Also in" it carries — the merge moves both, so the number in
  // the confirm dialog has to mean the same thing. Counting primaries alone undercounted every
  // custom category, which is exactly the case someone reaches for the merge tool to clean up.
  const presentCats = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) {
      const seen = new Set<string>()
      const bump = (c: string | null | undefined) => {
        const slug = (c ?? '').trim().toLowerCase()
        if (slug && !seen.has(slug)) { seen.add(slug); m.set(slug, (m.get(slug) ?? 0) + 1) }
      }
      bump(r.category)
      for (const cc of r.custom_categories ?? []) bump(String(cc))
    }
    return [...m.entries()].map(([slug, n]) => ({ slug, label: labelForCategory(slug), n })).sort((a, b) => a.label.localeCompare(b.label))
  }, [rows])

  // Merge one whole category into another (e.g. "Shoes 2" → "Shoes").
  //
  // A piece can hold a category in TWO places — as its primary `category` and as an "Also in"
  // (custom_categories[], ADR-0082) — and this used to rewrite only the first. The merged-away
  // category then survived in every picker and sidebar, because customCategoriesFromItems reads
  // both, so a merge that said "moved all 12 items" left the category standing with its "Also in"
  // members still under it. Both are rewritten now.
  async function mergeCategories() {
    if (!clientId || !mergeFrom || !mergeTo || mergeFrom === mergeTo) return
    const n = presentCats.find((c) => c.slug === mergeFrom)?.n ?? 0
    if (!window.confirm(`Move all ${n} "${labelForCategory(mergeFrom)}" items into "${labelForCategory(mergeTo)}"?`)) return
    setMerging(true)
    const { error: e } = await supabase.from('gp_closet_items').update({ category: mergeTo }).eq('client_id', clientId).eq('category', mergeFrom)
    if (e) { setMerging(false); alert('Merge failed — ' + e.message); return }
    // Postgres can't swap one array element in a filtered update, so rewrite the carriers by hand.
    // Read them back from the table rather than from `rows`, so a piece whose primary was just
    // moved is handled with its current array, and mergeTo is deduped in.
    const { data: carriers, error: ce } = await supabase
      .from('gp_closet_items')
      .select('id, category, custom_categories')
      .eq('client_id', clientId)
      .contains('custom_categories', [mergeFrom])
    if (ce) { setMerging(false); alert('Merge moved the primary categories but not the "Also in" ones — ' + ce.message); return }
    let ok = true
    for (const c of (carriers ?? []) as Array<{ id: string; category: string | null; custom_categories: string[] | null }>) {
      const primary = (c.category ?? '').trim().toLowerCase()
      const next = [...new Set(
        (c.custom_categories ?? [])
          .map((x) => String(x).trim().toLowerCase())
          .map((x) => (x === mergeFrom ? mergeTo : x))
          .filter((x) => x && x !== primary),
      )]
      const { error: ue } = await supabase.from('gp_closet_items').update({ custom_categories: next }).eq('id', c.id)
      if (ue) ok = false
    }
    setMerging(false)
    if (!ok) { alert('Some "Also in" entries could not be moved — run the merge again.'); return }
    setMergeFrom(''); setMergeTo(''); refetch()
  }

  // Run Claude vision on a set of items to fill BLANKS only — name (if blank), brand (only
  // when a label/logo is actually readable), color (if blank). Never overwrites existing
  // values. Sequential with a progress count. The metadata isn't in the DB for these, so
  // vision is the only automated source.
  async function recoverRows(targets: ReconRow[], label: string) {
    const elig = targets.filter((r) => r.source === 'intake_pipeline' && r.intake_item_id && (isMissingName(r) || isMissingBrand(r) || !(r.color ?? '').trim()))
    if (!elig.length) { alert('Nothing to recover here — these either have no upload link (GoodPix) or are already filled in.'); return }
    if (!window.confirm(`Run Claude vision on ${elig.length} ${label} to fill blanks (name, + brand/color when a label is readable)?\n\nRoughly ${Math.max(1, Math.ceil(elig.length * 3 / 60))} min — keep this tab open.`)) return
    setRecovering(true); setRecProgress({ done: 0, total: elig.length })
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token ?? ''
    let filled = 0
    for (let i = 0; i < elig.length; i++) {
      const r = elig[i]
      try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-extract-metadata`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: r.intake_item_id }),
        })
        const d = await resp.json().catch(() => ({}))
        if (d?.ok) {
          const md = d.metadata ?? {}
          const update: Record<string, string> = {}
          if (isMissingName(r) && md.item_name) update.name = md.item_name
          if (isMissingBrand(r) && md.brand && String(md.brand).toLowerCase() !== 'unknown') update.brand = md.brand
          if (!(r.color ?? '').trim() && md.color) update.color = md.color
          if (Object.keys(update).length) { await supabase.from('gp_closet_items').update(update).eq('id', r.id); filled++ }
        }
      } catch { /* skip; continue */ }
      setRecProgress({ done: i + 1, total: elig.length })
    }
    setRecovering(false)
    alert(`Filled blanks on ${filled} of ${elig.length} items.`)
    setSelected(new Set())
    refetch()
  }
  const recoverAllMissingNames = () => recoverRows(rows.filter((r) => isMissingName(r)), 'items missing a name')
  const recoverSelected = () => recoverRows(rows.filter((r) => selected.has(r.id)), 'selected items')

  const toggleSelect = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selectAllVisible = () => setSelected(new Set(visible.map((r) => r.id)))

  // Bulk-set the category override on the selected items (chunked .in() — big writes silently fail).
  async function bulkSetCategory(slug: string) {
    if (selected.size === 0) return
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

  // Set every item's category FROM ITS UPLOAD FOLDER. Stylists name each Drive folder/batch
  // with the category Chelsea needs (Sets, Wide Leg Heel Jeans, …), so the batch label IS the
  // category — we just never used it. Trace closet item → intake_item → batch label → slug.
  async function setCategoriesFromFolders() {
    const withIntake = rows.filter((r) => r.intake_item_id)
    if (!withIntake.length) { alert('No items have an upload link to read a folder from (these may be GoodPix items).'); return }
    // GUARD: only FILL items that have no category — never overwrite a category a stylist
    // (or a prior step) already set. This is fill-blanks-only, so it can't silently wipe
    // manual sorting the way an unconditional overwrite did. To re-categorize an item that
    // already has one, edit it directly (or clear it first).
    const uncategorized = withIntake.filter((r) => !(r.category ?? '').trim())
    const kept = withIntake.length - uncategorized.length
    if (!uncategorized.length) {
      alert(`All ${withIntake.length} items already have a category — nothing to fill.\n\nThis tool only fills items that have NO category, so it never overwrites your sorting. To re-categorize an item, edit it directly.`)
      return
    }
    if (!window.confirm(`Set categories from the upload folder for ${uncategorized.length} un-categorized item${uncategorized.length === 1 ? '' : 's'}?\n\nEach gets its folder/batch name as its category (e.g. "Wide Leg Heel Jeans").${kept ? `\n\n${kept} item${kept === 1 ? '' : 's'} that already have a category will be LEFT UNTOUCHED.` : ''}\n\nRecoverable by editing.`)) return
    setFoldering(true)
    try {
      const iids = uncategorized.map((r) => r.intake_item_id as string)
      const itemBatch = new Map<string, string>()
      for (let i = 0; i < iids.length; i += 100) {
        const { data } = await supabase.from('intake_items').select('id, batch_id').in('id', iids.slice(i, i + 100))
        for (const it of data ?? []) if (it.batch_id) itemBatch.set(it.id, it.batch_id)
      }
      const batchIds = [...new Set(itemBatch.values())]
      const batchSlug = new Map<string, string>()
      for (let i = 0; i < batchIds.length; i += 100) {
        const { data } = await supabase.from('intake_batches').select('id, batch_label, drive_folder_name').in('id', batchIds.slice(i, i + 100))
        for (const b of data ?? []) {
          const lbl = String((b as any).drive_folder_name || (b as any).batch_label || '').trim()
          if (lbl && !/dedup|duplicate|already digitized|safe to ignore|^mixed$/i.test(lbl)) batchSlug.set(b.id, slugifyCategory(lbl))
        }
      }
      const bySlug = new Map<string, string[]>()
      for (const r of uncategorized) {
        const slug = batchSlug.get(itemBatch.get(r.intake_item_id as string) ?? '')
        if (!slug) continue
        const arr = bySlug.get(slug) ?? []; arr.push(r.id); bySlug.set(slug, arr)
      }
      let updated = 0
      for (const [slug, ids] of bySlug) {
        for (let i = 0; i < ids.length; i += 100) {
          // Server-side guard too: only write where category is still null/empty, so a
          // stale client row can't cause an overwrite. .select() returns the rows actually
          // changed, for an accurate count.
          const { data, error: e } = await supabase.from('gp_closet_items')
            .update({ category: slug })
            .in('id', ids.slice(i, i + 100))
            .or('category.is.null,category.eq.')
            .select('id')
          if (e) { alert('Update failed — ' + e.message); setFoldering(false); return }
          updated += (data ?? []).length
        }
      }
      alert(`Set ${updated} item${updated === 1 ? '' : 's'} into ${bySlug.size} categor${bySlug.size === 1 ? 'y' : 'ies'} from their upload folders.${kept ? `\n${kept} already-categorized item${kept === 1 ? '' : 's'} left untouched.` : ''}`)
      refetch()
    } finally { setFoldering(false) }
  }

  async function confirm(r: ReconRow) {
    setBusy(r.id)
    const { error: e } = await supabase.from('gp_closet_items').update({ raw: { ...r.raw, reconciled_at: new Date().toISOString() } }).eq('id', r.id)
    setBusy(null)
    if (e) { alert('Could not mark reviewed — ' + e.message); return }
    refetch()
  }

  // Soft-delete (recoverable): removes the item from the live lookbook. Used to kill a
  // duplicate or a wrong item. is_deleted=true → the lookbook + collection stop showing it.
  async function removeFromLookbook(r: ReconRow, why: string) {
    if (!window.confirm(`Remove "${effectiveName(r) || 'this item'}" from the lookbook?\n\n${why}\n\nThis is recoverable (soft-delete).`)) return
    setBusy(r.id)
    // Stamp who/when/why (migration 016) so a hide is always explainable.
    const { data: { session } } = await supabase.auth.getSession()
    const { error: e } = await supabase.from('gp_closet_items')
      .update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: session?.user?.email ?? null, deleted_reason: 'duplicate' })
      .eq('id', r.id)
    setBusy(null)
    if (e) { alert('Could not remove — ' + e.message); return }
    refetch()
  }

  async function recover(r: ReconRow) {
    if (!r.intake_item_id) return
    setBusy(r.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-extract-metadata`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: r.intake_item_id }),
      })
      const d = await resp.json().catch(() => ({}))
      if (!resp.ok || !d?.ok) { alert(d?.error || 'Metadata recovery failed.'); return }
      const md = d.metadata ?? {}
      const update: Record<string, string> = {}
      if (isMissingName(r) && md.item_name) update.name = md.item_name
      if (isMissingBrand(r) && md.brand && String(md.brand).toLowerCase() !== 'unknown') update.brand = md.brand
      if (!(r.color ?? '').trim() && md.color) update.color = md.color
      if (Object.keys(update).length) {
        const { error: e } = await supabase.from('gp_closet_items').update(update).eq('id', r.id)
        if (e) { alert('Recovered, but could not save — ' + e.message); return }
      } else {
        alert('Vision could not recover this item — no readable name or brand. Use Edit to fix it manually.')
      }
      refetch()
    } catch {
      alert('Metadata recovery failed — try again.')
    } finally {
      setBusy(null)
    }
  }

  // ----- Edit dialog actions (reuse the shared dialog used in Collection) -----
  async function saveEdit(data: { name_override: string | null; brand: string | null; color: string | null; style_note: string | null; category: string | null; custom_categories?: string[] | null; color_family?: string | null; color_families?: string[] | null }) {
    if (!editing) return
    setSaving(true)
    const { error: e } = await supabase.from('gp_closet_items').update(data).eq('id', editing.id)
    setSaving(false)
    if (e) { alert('Failed to save — ' + e.message); return }
    setEditing(null); refetch()
  }
  async function removeBg() {
    if (!editing) return
    setRemovingBg(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-remove-bg-item`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: editing.id, image_url: resolveItemImage(toClosetItem(editing)) }),
      })
      const d = await resp.json().catch(() => ({}))
      if (!resp.ok || !d?.ok) { alert(d?.reason || d?.error || 'Could not remove the background.'); return }
      setEditing(null); refetch()
    } catch { alert('Failed to remove background — try again.') } finally { setRemovingBg(false) }
  }
  async function replacePhoto(file: File) {
    if (!editing) return
    setReplacing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const fd = new FormData()
      fd.append('item_id', editing.id)
      fd.append('photo', file)
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-replace-closet-image`, {
        method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}` }, body: fd,
      })
      const d = await resp.json().catch(() => ({}))
      if (!resp.ok || !d?.ok) { alert(d?.error || 'Could not replace the photo.'); return }
      setEditing(null); refetch()
    } catch { alert('Failed to replace the photo — try again.') } finally { setReplacing(false) }
  }
  // Rotate the item's photo a quarter-turn clockwise — client-side canvas turn (bytes fetched through
  // the CORS-safe proxy) pushed through the SAME reversible replace endpoint, mirroring the Collection tab.
  async function rotate() {
    if (!editing) return
    const src = resolveItemImage(toClosetItem(editing))
    if (!src) { alert('This item has no image to rotate.'); return }
    setRotating(true)
    try {
      const r = await fetch(proxyImageUrl(src))
      if (!r.ok) throw new Error('load')
      const bmp = await createImageBitmap(await r.blob())
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
        method: 'POST', headers: { Authorization: `Bearer ${session?.access_token ?? ''}` }, body: fd,
      })
      const d = await up.json().catch(() => ({}))
      if (!up.ok || !d?.ok) { alert(d?.error || 'Could not rotate the photo.'); return }
      setEditing(null); refetch()
    } catch { alert('Failed to rotate the photo — try again.') } finally { setRotating(false) }
  }

  // Point at a Google Drive folder (same Picker as the digitize import) and find the DROPS:
  // files in that folder we never ingested. Matches by size+EXIF-time fingerprint, then
  // renders the orphaned Drive photos so you can see exactly what's missing.
  const DROP_RENDER_CAP = 80
  async function runDriveCheck() {
    if (!clientId) return
    setDriveErr(null); setDriveBusy(true)
    try {
      const picked = await signInAndPickPhotos()
      if (!picked) { setDriveBusy(false); return } // user cancelled the picker
      const uploaded = await fetchUploadedFingerprints(clientId)
      const result = checkDriveFolder(picked.files, uploaded)
      setDriveResult(result); setDriveSource(picked.sourceName); setDriveDrops(result.drops.length)
      const urls: Record<string, string> = {}
      for (const f of result.drops.slice(0, DROP_RENDER_CAP)) {
        try { urls[f.id] = URL.createObjectURL(await downloadDriveFile(f, picked.accessToken)) } catch { /* skip unrenderable */ }
      }
      setDropUrls(urls)
      setFilter('drive_drops')
    } catch (e) {
      setDriveErr(e instanceof Error ? e.message : 'Drive check failed.')
    } finally {
      setDriveBusy(false)
    }
  }

  // FIND MISSING PHOTOS: cross-reference a Drive folder to the RELIABLE ingested record by
  // FILENAME. Every photo we ever ingested kept its original filename (intake_photos.
  // original_filename — 100% populated, and the original extension survives HEIC→JPEG
  // conversion), so a deterministic basename match is far more reliable than re-hashing
  // thousands of images through a proxy (which times out and throws false "missing"). We match
  // against intake_photos — NOT the closet items' garment/tag fields, which were mis-paired on
  // early uploads. Each Drive photo lands in an honest bucket by the status of its match:
  //   approved → in the collection · pending → uploaded, sitting in Needs Review (just approve)
  //   no filename match at all → never uploaded (the true gap → Digitize).
  async function runDeepMatch() {
    if (!clientId) return
    setDeepBusy(true); setDeepResult(null); setDeepPhase('Opening Google Drive…'); setDeepProgress({ done: 0, total: 0 })
    try {
      const picked = await signInAndPickPhotos()
      if (!picked) { setDeepBusy(false); setDeepPhase(''); return }
      setDriveToken(picked.accessToken)

      // 1) Index every ingested photo by several keys, keeping the best item-status per key
      //    (approved beats pending beats rejected/unused). Basename = lowercased name with the
      //    extension stripped, so IMG_3157.HEIC and IMG_3157.jpg are the same key.
      setDeepPhase('Loading the ingested record…')
      const ingested = await fetchIngestedPhotos(clientId)
      const baseKey = (n: string | null | undefined) => (n ?? '').trim().toLowerCase().replace(/\.[a-z0-9]+$/i, '')
      const fullKey = (n: string | null | undefined) => (n ?? '').trim().toLowerCase()
      const rankStatus = (s: IngestedPhoto['status']) => (s === 'approved' ? 3 : s === 'pending' ? 2 : 1)
      type Hit = { status: IngestedPhoto['status']; itemId: string | null }
      const setBest = (m: Map<string, Hit>, k: string, h: Hit) => {
        if (!k) return; const c = m.get(k); if (c === undefined || rankStatus(h.status) > rankStatus(c.status)) m.set(k, h)
      }
      const byDriveId = new Map<string, Hit>()
      const byBase = new Map<string, Hit>()
      const byFull = new Map<string, Hit>()
      const sizes = new Set<number>()
      for (const p of ingested) {
        const h: Hit = { status: p.status, itemId: p.itemId }
        if (p.driveFileId) setBest(byDriveId, p.driveFileId, h)
        setBest(byBase, baseKey(p.filename), h)
        setBest(byFull, fullKey(p.filename), h)
        if (p.size) sizes.add(p.size)
      }

      // 2) WATERFALL: score each Drive file by how many independent signals say "uploaded":
      //    Drive-id (exact) · filename basename · exact filename · byte-size. A Drive-id or
      //    filename hit is a confident match. We then count DISTINCT ITEMS those photos belong
      //    to (each item has several photos), so the totals line up with the lookbook's item
      //    count — not an inflated photo count. The weaker matches drop into the review pile.
      const files = picked.files
      // Photos a stylist already cleared (in-lookbook / tag) never come back as gaps.
      const resolved = getResolved(clientId)
      setDeepPhase('Comparing the Drive folder…'); setDeepProgress({ done: 0, total: files.length })
      const collectionItems = new Set<string>()   // distinct approved items this folder covers
      const needsReviewItems = new Set<string>()   // distinct pending items
      const otherItems = new Set<string>()         // distinct rejected/unused items
      let uploadedNoItem = 0                        // matched a photo that belongs to no item
      let resolvedHidden = 0
      const candidates: ScoredFile[] = []
      const matched: MatchedFile[] = []
      for (const f of files) {
        const signals: string[] = []
        let hit: Hit | null = null
        const idHit = byDriveId.get(f.id)
        if (idHit !== undefined) { signals.push('Drive ID'); hit = idHit }
        const baseHit = byBase.get(baseKey(f.name))
        if (baseHit !== undefined) { signals.push('filename'); if (hit === null) hit = baseHit }
        if (byFull.has(fullKey(f.name))) signals.push('exact name')
        if (f.size && sizes.has(f.size)) signals.push('size')

        const confident = signals.includes('Drive ID') || signals.includes('filename')
        if (confident && hit) {
          matched.push({ file: f, hits: signals.length, signals, intakeItemId: hit.itemId, status: hit.status })
          const set = hit.status === 'approved' ? collectionItems : hit.status === 'pending' ? needsReviewItems : otherItems
          if (hit.itemId) set.add(hit.itemId); else uploadedNoItem++
        } else if (isResolved(resolved, f)) {
          resolvedHidden++ // already reviewed & cleared by a stylist
        } else {
          candidates.push({ file: f, hits: signals.length, signals, verdict: signals.length > 0 ? 'review' : 'missing' })
        }
      }
      candidates.sort((a, b) => a.hits - b.hits || a.file.name.localeCompare(b.file.name, undefined, { numeric: true }))
      // Stash for the optional image-match pass (so it can extend these sets in place).
      ingestedRef.current = ingested
      matchSetsRef.current = { collectionItems, needsReviewItems, otherItems, uploadedNoItem }
      setDeepResult({
        source: picked.sourceName,
        totalFiles: files.length,
        inCollection: collectionItems.size,
        inNeedsReview: needsReviewItems.size,
        otherIngested: otherItems.size + uploadedNoItem,
        candidates,
        matched,
        resolvedHidden,
      })
      setSelectedMissing(new Set())
    } catch (e) {
      alert('Finding missing photos failed — ' + (e instanceof Error ? e.message : String(e)))
    } finally { setDeepBusy(false); setDeepPhase('') }
  }

  // OPTION B — IMAGE MATCH on the unmatched remainder. Filenames can't survive a renamed/
  // re-exported folder, so for the leftover candidates we compare the ACTUAL IMAGE. We
  // fingerprint the client's whole uploaded record once (cached in IndexedDB, so it's a
  // one-time ~minute), then hash each candidate's Drive thumbnail and reclassify any that
  // visually match an uploaded photo — moving renamed copies out of "never uploaded".
  async function runImageMatch() {
    if (!deepResult || !clientId || pixelBusy) return
    const cands = deepResult.candidates
    if (cands.length === 0) return
    setPixelBusy(true); setPixelPhase('Loading the record…'); setPixelProgress({ done: 0, total: 0 })
    try {
      const ingested = ingestedRef.current.length ? ingestedRef.current : await fetchIngestedPhotos(clientId)
      const px = (k: string) => `${SUPABASE_URL}/functions/v1/image-proxy?key=${encodeURIComponent(k)}`

      // 1) Fingerprint the collection's uploaded photos (cached). Each carries status + itemId
      //    so a visual match lands in the right bucket. Hash only what isn't cached yet.
      const withKey = ingested.filter((p) => p.r2_key)
      const cache = await getCachedHashes(withKey.map((p) => p.r2_key))
      const toHash = withKey.filter((p) => !cache.has(p.r2_key))
      setPixelPhase(toHash.length ? 'Fingerprinting collection (one-time)…' : 'Reading fingerprints…')
      setPixelProgress({ done: 0, total: toHash.length })
      let done = 0
      const fresh: [string, bigint][] = []
      await pool(toHash, 10, async (p) => {
        const h = await dHashFromUrl(px(p.r2_key))
        if (h !== null) { cache.set(p.r2_key, h); fresh.push([p.r2_key, h]) }
      }, () => setPixelProgress({ done: ++done, total: toHash.length }))
      await putCachedHashes(fresh) // persist so the next run is instant

      // Flatten to a comparable list: [hash, status, itemId].
      const coll = withKey
        .map((p) => { const h = cache.get(p.r2_key); return h !== undefined ? { h, status: p.status, itemId: p.itemId } : null })
        .filter((x): x is { h: bigint; status: IngestedPhoto['status']; itemId: string | null } => x !== null)

      // 2) Hash each candidate's Drive thumbnail and find its nearest uploaded photo (≤10/64 bits
      //    = the same image across rename/transcode/resize). Best status wins on ties.
      setPixelPhase('Image-matching the unmatched…'); setPixelProgress({ done: 0, total: cands.length }); done = 0
      const rankStatus = (s: IngestedPhoto['status']) => (s === 'approved' ? 3 : s === 'pending' ? 2 : 1)
      const sets = matchSetsRef.current
      const stillCandidates: ScoredFile[] = []
      const pixelMatched: MatchedFile[] = []
      await pool(cands, 6, async (c) => {
        let best: { status: IngestedPhoto['status']; itemId: string | null } | null = null
        if (c.file.thumbnailLink) {
          const h = await dHashFromUrl(c.file.thumbnailLink)
          if (h !== null) {
            for (const e of coll) {
              if (hamming(h, e.h) <= 10 && (best === null || rankStatus(e.status) > rankStatus(best.status))) best = { status: e.status, itemId: e.itemId }
            }
          }
        }
        if (best) {
          pixelMatched.push({ file: c.file, hits: 1, signals: ['image'], intakeItemId: best.itemId, status: best.status })
          const set = best.status === 'approved' ? sets.collectionItems : best.status === 'pending' ? sets.needsReviewItems : sets.otherItems
          if (best.itemId) set.add(best.itemId); else sets.uploadedNoItem++
        } else {
          stillCandidates.push(c)
        }
      }, () => setPixelProgress({ done: ++done, total: cands.length }))

      stillCandidates.sort((a, b) => a.hits - b.hits || a.file.name.localeCompare(b.file.name, undefined, { numeric: true }))
      setDeepResult((prev) => prev ? {
        ...prev,
        inCollection: sets.collectionItems.size,
        inNeedsReview: sets.needsReviewItems.size,
        otherIngested: sets.otherItems.size + sets.uploadedNoItem,
        candidates: stillCandidates,
        matched: [...prev.matched, ...pixelMatched],
      } : prev)
      setSelectedMissing(new Set())
    } catch (e) {
      alert('Image match failed — ' + (e instanceof Error ? e.message : String(e)))
    } finally { setPixelBusy(false); setPixelPhase('') }
  }

  // REVIEW ACTION: a stylist confirms these candidates aren't gaps — they're already in the
  // lookbook, or they're tag/label shots. Record the decision (persists across re-runs) and
  // drop them from the list. The audit is "done" when the candidate list is empty.
  function resolveAndRemove(ids: string[], reason: ResolveReason) {
    if (!clientId || !deepResult || ids.length === 0) return
    const idset = new Set(ids)
    const files = deepResult.candidates.filter((c) => idset.has(c.file.id)).map((c) => ({ id: c.file.id, name: c.file.name }))
    addResolved(clientId, files, reason)
    // Advance the popup to the next remaining candidate (or close it).
    if (candLightbox && idset.has(candLightbox)) {
      const remaining = deepResult.candidates.filter((c) => !idset.has(c.file.id))
      const curIdx = deepResult.candidates.findIndex((c) => c.file.id === candLightbox)
      const next = remaining[curIdx] ?? remaining[curIdx - 1] ?? null
      setCandLightbox(next ? next.file.id : null)
    }
    setDeepResult((prev) => prev ? { ...prev, candidates: prev.candidates.filter((c) => !idset.has(c.file.id)), resolvedHidden: prev.resolvedHidden + files.length } : prev)
    setSelectedMissing((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n })
  }

  // DIGITIZE the selected missing photos: download them, upload through the SAME pipeline
  // (intake-upload-photos + finalize, now capturing drive_file_id) → confirm board → AI →
  // Needs Review → approve. No new pipeline — just feeds the existing one.
  async function digitizeSelected() {
    if (!deepResult || !driveToken || !clientId || selectedMissing.size === 0) return
    const sel = deepResult.candidates.filter((c) => selectedMissing.has(c.file.id)).map((c) => c.file)
    if (!window.confirm(`Digitize ${sel.length} photo${sel.length === 1 ? '' : 's'} for ${activeClient?.name}${digCat ? ` as “${digCat.label}”` : ''}?\n\nThey'll upload, run through the AI, and appear on the Digitize → confirm board, then Needs Review for you to approve.${digCat ? '' : '\n\n(No category chosen — you can set it in Needs Review.)'}`)) return
    setDigitizing(true); setDigitizeMsg('Starting…')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token ?? ''
      const baseName = (n: string) => n.replace(/\.[^.]+$/, '')
      // download all selected
      const files: File[] = []
      const driveFileIds: Record<string, string> = {}
      const captureTimes: Record<string, string> = {}
      for (let i = 0; i < sel.length; i++) {
        setDigitizeMsg(`Downloading ${i + 1}/${sel.length}…`)
        try {
          const f = await downloadDriveFile(sel[i], driveToken)
          files.push(f); driveFileIds[baseName(sel[i].name)] = sel[i].id
          if (sel[i].captureTime) captureTimes[baseName(sel[i].name)] = sel[i].captureTime as string
        } catch { /* skip unreadable */ }
      }
      if (!files.length) { alert('Could not download any of the selected photos.'); return }
      // upload in chunks of 2 → intake-upload-photos
      let batchId: string | null = null
      const CHUNK = 2
      for (let i = 0; i < files.length; i += CHUNK) {
        setDigitizeMsg(`Uploading ${Math.min(i + CHUNK, files.length)}/${files.length}…`)
        const chunk = files.slice(i, i + CHUNK)
        const fd = new FormData()
        if (batchId) fd.append('batch_id', batchId)
        fd.append('client_id', clientId)
        // The approve step turns batch_label into the item's category (slugified). If a stylist
        // chose a category, send its label so the items come in pre-tagged. Otherwise send
        // 'Mixed' — which the approver intentionally skips, leaving category blank to set later.
        if (!batchId) { fd.append('batch_label', digCat ? digCat.label : 'Mixed'); fd.append('drive_folder_id', '') }
        fd.append('drive_file_ids', JSON.stringify(driveFileIds))
        if (Object.keys(captureTimes).length) fd.append('capture_times', JSON.stringify(captureTimes))
        chunk.forEach((f) => fd.append('photos', f))
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-upload-photos`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
        const d = await resp.json().catch(() => ({}))
        if (!resp.ok || !d?.batch_id) throw new Error(d?.error || `upload failed (${resp.status})`)
        batchId = d.batch_id
      }
      setDigitizeMsg('Finalizing…')
      if (batchId) await fetch(`${SUPABASE_URL}/functions/v1/intake-finalize-batch`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ batch_id: batchId }) })
      alert(`Sent ${files.length} photo${files.length === 1 ? '' : 's'} into the pipeline for ${activeClient?.name}. They'll classify, then appear on Digitize → confirm board → Needs Review. Approve them there and they'll join the collection (with Drive tracking).`)
      // drop the digitized ones from the candidate list
      setDeepResult((prev) => prev ? { ...prev, candidates: prev.candidates.filter((c) => !selectedMissing.has(c.file.id)) } : prev)
      setSelectedMissing(new Set())
    } catch (e) {
      alert('Digitize failed — ' + (e instanceof Error ? e.message : String(e)))
    } finally { setDigitizing(false); setDigitizeMsg('') }
  }

  if (!clientId) return <Shell><p className="text-[#888] text-sm">Select a client to reconcile their collection.</p></Shell>
  if (loading) return <Shell><p className="text-[#888] text-sm">Loading collection…</p></Shell>
  if (error) return <Shell><p className="text-rose-600 text-sm">Couldn't load collection — {error}</p></Shell>

  return (
    <Shell>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-[15px] tracking-[0.1em] uppercase text-[#1A1A1A] flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Reconciliation — {activeClient?.name}
          </h1>
          <p className="text-[12px] text-[#888] mt-1.5 max-w-3xl leading-relaxed">
            Every item live on the lookbook today, matched <strong>uploaded photo ↔ live photo ↔ metadata</strong> by database link (not guesswork).
            Confirm a match, edit metadata, recover blanks, or remove duplicates — all from here.
            <span className="text-[#aaa]"> Counts are from the database (uploaded → approved → live); the Google&nbsp;Drive drop-check is the next layer.</span>
          </p>
        </div>
        <div className="text-right flex-none ml-4">
          <p className="text-[26px] leading-none text-[#1A1A1A]" style={{ fontFamily: "'Schnyder', Georgia, serif", fontWeight: 300 }}>
            {counts.clean}<span className="text-[#ccc]">/{rows.length}</span>
          </p>
          <p className="text-[9px] tracking-[0.25em] uppercase text-[#aaa] mt-1">Clean</p>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button
          onClick={runDriveCheck}
          disabled={driveBusy || !isGoogleDriveConfigured()}
          title={isGoogleDriveConfigured() ? 'Quick filename count: how many files in a Drive folder are already uploaded vs never uploaded' : 'Google Drive is not configured'}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-[11px] tracking-[0.12em] uppercase border border-[#ccc] text-[#888] rounded-sm hover:border-[#1A1A1A] hover:text-[#1A1A1A] transition-colors disabled:opacity-40"
        >
          {driveBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
          {driveBusy ? 'Counting…' : 'Quick count check'}
        </button>
        <button
          onClick={setCategoriesFromFolders}
          disabled={foldering}
          title="Fill the category of items that don't have one yet, from the folder/batch they were uploaded in (stylists name folders by category). Items you've already categorized are left untouched."
          className="inline-flex items-center gap-2 px-3.5 py-2 text-[11px] tracking-[0.12em] uppercase border border-[#1A1A1A] text-[#1A1A1A] rounded-sm hover:bg-[#1A1A1A] hover:text-white transition-colors disabled:opacity-40"
        >
          {foldering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderInput className="h-3.5 w-3.5" />}
          {foldering ? 'Setting categories…' : 'Categories from upload folder'}
        </button>
        <button
          onClick={recoverAllMissingNames}
          disabled={recovering}
          title="Run Claude vision on every no-name item to fill in its name (and brand/color when a label is readable)"
          className="inline-flex items-center gap-2 px-3.5 py-2 text-[11px] tracking-[0.12em] uppercase border border-amber-400 text-amber-700 rounded-sm hover:bg-amber-50 transition-colors disabled:opacity-40"
        >
          {recovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {recovering ? `Recovering ${recProgress.done}/${recProgress.total}…` : 'Recover missing names'}
        </button>
        <button
          onClick={runDeepMatch}
          disabled={deepBusy || !isGoogleDriveConfigured()}
          title="Pick a Google Drive folder → matches every file to this client's uploaded photos by filename and shows exactly which were never uploaded (then Digitize them)"
          className="inline-flex items-center gap-2 px-3.5 py-2 text-[11px] tracking-[0.12em] uppercase bg-indigo-600 text-white border border-indigo-600 rounded-sm hover:bg-indigo-700 transition-colors disabled:opacity-40"
        >
          {deepBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
          {deepBusy ? (deepProgress.total ? `${deepPhase} ${deepProgress.done}/${deepProgress.total}` : deepPhase || 'Finding…') : 'Find missing photos'}
        </button>
      </div>

      {/* Results/progress live on their OWN row so they never reflow the toolbar above. */}
      {(driveResult || driveErr) && (
        <div className="mb-4">
          {driveResult && (() => {
            const tone = driveResult.drops.length === 0 ? 'text-emerald-700' : 'text-rose-600'
            return (
              <p className="text-[12px] text-[#666] leading-relaxed max-w-3xl">
                <strong className="text-[#1A1A1A]">{driveSource}</strong>: {driveResult.total} files in Drive ·{' '}
                <span className="text-emerald-700">{driveResult.matched} already uploaded</span> ·{' '}
                <strong className={tone}>{driveResult.drops.length} never uploaded</strong>
                {' '}(matched by filename; shown below).
              </p>
            )
          })()}
          {driveErr && <p className="text-[12px] text-rose-600">{driveErr}</p>}
        </div>
      )}

      {deepResult && (() => {
        const cands = deepResult.candidates
        const missingCount = cands.filter((c) => c.verdict === 'missing').length
        const reviewCount = cands.length - missingCount
        const allSel = selectedMissing.size === cands.length && cands.length > 0
        return (
        <div className="mb-5 rounded-sm border border-indigo-200 bg-indigo-50/40 p-3">
          <p className="text-[12px] text-[#444]">
            <strong className="text-[#1A1A1A]">{deepResult.source}</strong> — {deepResult.totalFiles} photos in folder. They cover{' '}
            <span className="text-emerald-700 font-medium">{deepResult.inCollection} live items</span>
            {deepResult.inNeedsReview > 0 && <> · <span className="text-amber-700 font-medium">{deepResult.inNeedsReview} items awaiting approval</span></>}
            {deepResult.otherIngested > 0 && <span className="text-[#999]"> · {deepResult.otherIngested} other</span>}
            {'. '}<span className="text-[#888]">Unmatched photos:</span>
            {reviewCount > 0 && <> <span className="text-amber-700 font-medium">{reviewCount} to review</span> ·</>}
            {' '}<span className={missingCount ? 'text-rose-600 font-medium' : 'text-emerald-700'}>{missingCount} never uploaded</span>
          </p>
          {deepResult.inNeedsReview > 0 && (
            <p className="text-[11px] text-amber-700 mt-1.5 bg-amber-50 border border-amber-200 rounded-sm px-2.5 py-1.5 max-w-3xl">
              ⏳ <strong>{deepResult.inNeedsReview}</strong> item{deepResult.inNeedsReview === 1 ? ' is' : 's are'} already uploaded and AI-processed — sitting in <strong>Needs Review</strong> on the Digitize tab. Approve them there; no re-upload needed.
            </p>
          )}
          {/* Trust-but-verify: open the confidently-matched files and eyeball each pairing. */}
          {deepResult.matched.length > 0 && (
            <div className="mt-2">
              <button onClick={() => setShowMatched((v) => !v)} className="text-[11px] text-[#888] hover:text-[#1A1A1A] underline">
                {showMatched ? 'Hide' : 'Show'} {deepResult.matched.length} matched files (verify the matches)
              </button>
              {showMatched && (
                <div className="mt-2 max-h-[50vh] overflow-y-auto rounded-sm border border-emerald-100 bg-white/50 p-2">
                  <p className="text-[10px] text-[#999] mb-2">Each tile is a Drive photo we counted as already-uploaded, with the item it matched. Click to see them side-by-side. Spot anything wrong? Tell me the filename.</p>
                  <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-8 gap-3">
                    {deepResult.matched.slice(0, 600).map((m) => {
                      const row = m.intakeItemId ? rowByIntakeId.get(m.intakeItemId) : undefined
                      const itemName = row ? (effectiveName(row) || 'Item') : (m.status === 'pending' ? 'Needs-Review item' : 'Uploaded photo')
                      const big = m.file.thumbnailLink ? m.file.thumbnailLink.replace(/=s\d+/, '=s1600') : null
                      return (
                        <button
                          key={m.file.id}
                          onClick={() => setLightbox({ original: big, live: row?.liveUrl ?? null, name: `${m.file.name}  →  ${itemName}` })}
                          className="text-left border border-emerald-200 rounded-sm overflow-hidden bg-white hover:border-emerald-400 transition-colors"
                        >
                          <div className="aspect-square bg-[#F8F7F5] flex items-center justify-center overflow-hidden relative">
                            {m.file.thumbnailLink
                              ? <img src={m.file.thumbnailLink} alt={m.file.name} className="w-full h-full object-contain" referrerPolicy="no-referrer" loading="lazy" />
                              : <span className="text-[8px] text-[#bbb] text-center px-1">{m.file.name}</span>}
                            <span title={`Matched on: ${m.signals.join(', ')}`} className="absolute top-1 right-1 text-[8px] tracking-[0.08em] uppercase px-1 py-0.5 rounded-sm bg-emerald-600 text-white pointer-events-none">{m.signals.includes('image') ? 'img' : `${m.hits}h`}</span>
                          </div>
                          <p className="text-[8px] text-[#888] truncate px-1 pt-0.5" title={m.file.name}>{m.file.name}</p>
                          <p className="text-[8px] text-emerald-700 truncate px-1 pb-0.5" title={itemName}>→ {itemName}</p>
                        </button>
                      )
                    })}
                  </div>
                  {deepResult.matched.length > 600 && <p className="text-[10px] text-[#aaa] mt-2">Showing first 600 of {deepResult.matched.length}.</p>}
                </div>
              )}
            </div>
          )}
          {cands.length === 0 ? (
            <p className="text-[12px] text-emerald-700 mt-2 font-medium">
              ✓ Audit complete for this folder — every photo is accounted for{deepResult.resolvedHidden > 0 ? ' (uploaded, or reviewed and cleared)' : ''}. Nothing left to digitize.
            </p>
          ) : (
            <>
              <p className="text-[11px] text-[#888] mt-2 mb-2 max-w-3xl">
                Sorted weakest-match first. <span className="text-rose-600 font-medium">0 hits = never uploaded</span> (real gap). <span className="text-amber-700 font-medium">1 hit = weak</span> (e.g. size only — eyeball it). Select and Digitize to run the genuine gaps through the AI → Needs Review → approve.
              </p>
              {/* Option B: image-match the remainder — the only thing that survives a renamed /
                  re-exported folder, where filenames no longer match the originals. */}
              <div className="mb-3 rounded-sm border border-violet-200 bg-violet-50/60 px-3 py-2 max-w-3xl">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-[11px] text-[#555] leading-relaxed flex-1 min-w-[240px]">
                    <strong className="text-violet-800">Renamed or re-exported folder?</strong> If filenames were reset (e.g. a "Finished Digitization" export), this list will over-report. <strong>Image-match</strong> compares the actual photo, so renamed copies of items you already have drop out. First run fingerprints the collection once (~a minute), then it's instant.
                  </p>
                  <button
                    onClick={runImageMatch}
                    disabled={pixelBusy}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-[11px] tracking-[0.1em] uppercase bg-violet-600 text-white rounded-sm hover:bg-violet-700 transition-colors disabled:opacity-50 flex-none"
                  >
                    {pixelBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {pixelBusy
                      ? (pixelProgress.total ? `${pixelPhase} ${pixelProgress.done}/${pixelProgress.total}` : pixelPhase || 'Matching…')
                      : `Image-match ${cands.length} unmatched`}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 mb-2 text-[11px] flex-wrap">
                <button
                  onClick={() => setSelectedMissing(allSel ? new Set() : new Set(cands.map((c) => c.file.id)))}
                  className="inline-flex items-center gap-1.5 text-[#666] hover:text-[#1A1A1A]"
                >
                  {allSel ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />} Select all ({cands.length})
                </button>
                <button
                  onClick={() => setSelectedMissing(new Set(cands.filter((c) => c.verdict === 'missing').map((c) => c.file.id)))}
                  className="inline-flex items-center gap-1.5 text-rose-600 hover:text-rose-700"
                >
                  <Square className="h-3.5 w-3.5" /> Select {missingCount} never-uploaded
                </button>
                {selectedMissing.size > 0 && (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <Tags className="h-3.5 w-3.5 text-[#888]" />
                      <select
                        value={digCat?.slug ?? ''}
                        onChange={(e) => {
                          const v = e.target.value
                          if (!v) { setDigCat(null); return }
                          if (v === '__new__') { const n = window.prompt('New category name (e.g. Time Pieces):'); if (n && n.trim()) setDigCat({ slug: slugifyCategory(n), label: n.trim() }); e.currentTarget.value = digCat?.slug ?? ''; return }
                          const label = (CATEGORY_LABELS as Record<string, string>)[v] ?? customCats.find((c) => c.slug === v)?.label ?? v
                          setDigCat({ slug: v, label })
                        }}
                        title="Tag the digitized items with this category (or leave to set later in Needs Review)"
                        className="bg-white border border-[#E8E4DF] rounded-sm px-2 py-1 text-[11px] focus:outline-none"
                      >
                        <option value="">Category: set later</option>
                        {Object.entries(CATEGORY_LABELS).filter(([s]) => s !== 'other').map(([slug, label]) => <option key={slug} value={slug}>{label}</option>)}
                        {customCats.length > 0 && <optgroup label="Custom">{customCats.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}</optgroup>}
                        <option value="__new__">＋ New category…</option>
                      </select>
                    </span>
                    <button
                      onClick={digitizeSelected}
                      disabled={digitizing}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1A1A1A] text-white rounded-sm tracking-[0.1em] uppercase hover:bg-[#333] transition-colors disabled:opacity-50"
                    >
                      {digitizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      {digitizing ? (digitizeMsg || 'Working…') : `Digitize ${selectedMissing.size}${digCat ? ` as ${digCat.label}` : ''} → Needs Review`}
                    </button>
                    <button
                      onClick={() => resolveAndRemove([...selectedMissing], 'in_lookbook')}
                      title="These aren't gaps — they're already in the lookbook, or they're tag/label shots. Clears them from the audit for good."
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-emerald-300 text-emerald-700 rounded-sm tracking-[0.1em] uppercase hover:bg-emerald-50 transition-colors"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Not a gap — clear {selectedMissing.size}
                    </button>
                  </>
                )}
              </div>
              {/* Scrollable so a large gap list never blows up the page height / shoves the toolbar. */}
              <div className="max-h-[60vh] overflow-y-auto rounded-sm border border-indigo-100 bg-white/40 p-2">
                <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-8 gap-3">
                  {cands.map(({ file: f, hits, signals, verdict }) => {
                    const sel = selectedMissing.has(f.id)
                    return (
                      <div
                        key={f.id}
                        className={`border rounded-sm overflow-hidden bg-white ${sel ? 'border-[#1A1A1A] ring-1 ring-[#1A1A1A]/20' : verdict === 'missing' ? 'border-rose-200' : 'border-amber-200'}`}
                      >
                        <div className="aspect-square bg-[#F8F7F5] flex items-center justify-center overflow-hidden relative">
                          {/* Click the photo → big review popup. */}
                          <button onClick={() => setCandLightbox(f.id)} className="absolute inset-0 cursor-zoom-in" title="Click to view larger" aria-label={`View ${f.name}`}>
                            {f.thumbnailLink
                              ? <img src={f.thumbnailLink} alt={f.name} className="w-full h-full object-contain" referrerPolicy="no-referrer" loading="lazy" />
                              : <span className="text-[8px] text-[#bbb] text-center px-1 leading-tight">{f.name}</span>}
                          </button>
                          {/* Checkbox toggles selection for bulk Digitize / clear. */}
                          <button
                            onClick={() => setSelectedMissing((p) => { const n = new Set(p); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n })}
                            className="absolute top-1 left-1 bg-white/90 rounded-sm p-0.5 hover:bg-white"
                            title={sel ? 'Deselect' : 'Select'}
                          >
                            {sel ? <CheckSquare className="h-4 w-4 text-[#1A1A1A]" /> : <Square className="h-4 w-4 text-[#999]" />}
                          </button>
                          <span
                            title={signals.length ? `Matched on: ${signals.join(', ')}` : 'No signal matched — never uploaded'}
                            className={`absolute top-1 right-1 text-[8px] tracking-[0.08em] uppercase px-1 py-0.5 rounded-sm pointer-events-none ${verdict === 'missing' ? 'bg-rose-600 text-white' : 'bg-amber-500 text-white'}`}
                          >
                            {hits} hit{hits === 1 ? '' : 's'}
                          </span>
                        </div>
                        <p className="text-[8px] text-[#888] truncate px-1 py-0.5" title={`${f.name}${signals.length ? ` · ${signals.join(', ')}` : ''}`}>{f.name}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
          {deepResult.resolvedHidden > 0 && (
            <p className="text-[10px] text-[#aaa] mt-2">
              {deepResult.resolvedHidden} photo{deepResult.resolvedHidden === 1 ? '' : 's'} cleared as “already in lookbook / tag”.{' '}
              <button onClick={() => { if (clientId && window.confirm('Un-clear all reviewed photos for this client? They\'ll reappear next run.')) { clearResolved(clientId); setDeepResult((p) => p ? { ...p, resolvedHidden: 0 } : p) } }} className="underline hover:text-[#666]">reset</button>
            </p>
          )}
        </div>
        )
      })()}

      {filter !== 'drive_drops' && presentCats.length > 1 && (
        <div className="flex items-center gap-2 mb-3 text-[11px] flex-wrap">
          <span className="tracking-[0.12em] uppercase text-[#888] inline-flex items-center gap-1.5"><Tags className="h-3.5 w-3.5" /> Merge categories</span>
          <select value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)} className="bg-white border border-[#E8E4DF] rounded-sm px-2 py-1 text-[11px] focus:outline-none">
            <option value="">Move all…</option>
            {presentCats.map((c) => <option key={c.slug} value={c.slug}>{c.label} ({c.n})</option>)}
          </select>
          <span className="text-[#bbb]">→</span>
          <select value={mergeTo} onChange={(e) => setMergeTo(e.target.value)} className="bg-white border border-[#E8E4DF] rounded-sm px-2 py-1 text-[11px] focus:outline-none">
            <option value="">into…</option>
            {presentCats.filter((c) => c.slug !== mergeFrom).map((c) => <option key={c.slug} value={c.slug}>{c.label} ({c.n})</option>)}
          </select>
          <button
            onClick={mergeCategories}
            disabled={!mergeFrom || !mergeTo || mergeFrom === mergeTo || merging}
            className="inline-flex items-center gap-1.5 px-3 py-1 text-[10px] tracking-[0.12em] uppercase bg-[#1A1A1A] text-white rounded-sm hover:bg-[#333] transition-colors disabled:opacity-40"
          >
            {merging ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Merge
          </button>
        </div>
      )}

      {filter !== 'drive_drops' && visible.length > 0 && (
        <div className="flex items-center gap-3 mb-3 text-[11px] flex-wrap">
          <button
            onClick={() => (selected.size === visible.length ? setSelected(new Set()) : selectAllVisible())}
            className="inline-flex items-center gap-1.5 text-[#666] hover:text-[#1A1A1A]"
          >
            {selected.size === visible.length && visible.length > 0 ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
            Select all ({visible.length})
          </button>
          {selected.size > 0 && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-sm bg-[#1A1A1A] text-white">
              <Tags className="h-3.5 w-3.5" />
              <span className="tracking-[0.08em] uppercase">{selected.size} selected — set category</span>
              <select
                disabled={bulkBusy}
                defaultValue=""
                onChange={(e) => {
                  const v = e.target.value
                  if (!v) return
                  if (v === '__new__') { const n = window.prompt('New category name (e.g. Wide Leg Heel Jeans):'); if (n && n.trim()) bulkSetCategory(slugifyCategory(n)) }
                  else bulkSetCategory(v)
                  e.currentTarget.value = ''
                }}
                className="bg-white text-[#1A1A1A] rounded-sm px-2 py-1 text-[11px] focus:outline-none"
              >
                <option value="" disabled>Choose…</option>
                {Object.entries(CATEGORY_LABELS).filter(([s]) => s !== 'other').map(([slug, label]) => <option key={slug} value={slug}>{label}</option>)}
                {customCats.length > 0 && <optgroup label="Custom">{customCats.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}</optgroup>}
                <option value="__new__">＋ New category…</option>
              </select>
              {bulkBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span className="w-px h-4 bg-white/20" />
              <button
                onClick={recoverSelected}
                disabled={recovering}
                title="Run Claude vision on the selected items to fill blank name/brand/color"
                className="inline-flex items-center gap-1.5 text-amber-200 hover:text-white disabled:opacity-50 tracking-[0.08em] uppercase"
              >
                {recovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {recovering ? `Recovering ${recProgress.done}/${recProgress.total}` : 'Recover metadata'}
              </button>
              <button onClick={() => setSelected(new Set())} className="text-white/70 hover:text-white ml-1">Clear</button>
            </div>
          )}
        </div>
      )}

      {filter === 'drive_drops' ? (
        <DropsGrid drops={driveResult?.drops ?? []} urls={dropUrls} cap={DROP_RENDER_CAP} />
      ) : visible.length === 0 ? (
        <p className="text-[#888] text-sm">Nothing in this view.</p>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => {
            const st = statuses.get(r.id)!
            const reviewed = !!r.reconciled_at
            const flags = Array.from(st.flags)
            return (
              <div key={r.id} className={`flex gap-3 p-3 rounded-sm border bg-white ${selected.has(r.id) ? 'border-[#1A1A1A] ring-1 ring-[#1A1A1A]/15' : reviewed ? 'border-emerald-200' : 'border-[#E8E4DF]'}`}>
                <button onClick={() => toggleSelect(r.id)} className="flex-none self-start pt-1 text-[#bbb] hover:text-[#1A1A1A]" title="Select for bulk actions">
                  {selected.has(r.id) ? <CheckSquare className="h-4 w-4 text-[#1A1A1A]" /> : <Square className="h-4 w-4" />}
                </button>
                <ImgCell url={r.originalUrl} label="Original (uploaded)" empty={r.source === 'intake_pipeline' ? 'Original photo lost' : 'GoodPix — no upload'} onZoom={() => setLightbox({ original: r.originalUrl, live: r.liveUrl, name: effectiveName(r) || 'Item' })} />
                <div className="flex items-center text-[#ccc] text-lg">→</div>
                <ImgCell url={r.liveUrl} label="Live on lookbook" empty="No live image" onZoom={() => setLightbox({ original: r.originalUrl, live: r.liveUrl, name: effectiveName(r) || 'Item' })} />

                <div className="flex-1 min-w-0 py-0.5">
                  <p className={`text-[14px] truncate ${isMissingName(r) ? 'text-rose-500 italic' : 'text-[#1A1A1A]'}`}>
                    {isMissingName(r) ? 'Missing name' : effectiveName(r)}
                  </p>
                  <div className="mt-1.5 space-y-1 text-[12px]">
                    <Field label="Brand" value={r.brand} missing={isMissingBrand(r)} />
                    <Field label="Category" value={r.category} />
                    <Field label="Color" value={r.color} />
                    {r.description?.trim() && <Field label="Description" value={r.description} muted />}
                  </div>
                </div>

                <div className="w-[210px] flex-none flex flex-col items-end gap-2">
                  {/* All flags shown transparently (an item can have several). */}
                  <div className="flex flex-wrap justify-end gap-1">
                    {flags.length === 0 ? (
                      <FlagChip flag="clean" />
                    ) : flags.map((f) => <FlagChip key={f} flag={f} count={f === 'duplicate' ? st.dupCount : undefined} />)}
                  </div>

                  {/* Cross-provenance duplicate verdict from the CLIP+vision scan (keep / remove / review). */}
                  {st.dupRole && (
                    <div className="w-full flex flex-col items-end gap-1">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[9px] tracking-[0.12em] uppercase font-medium ${
                          st.dupRole === 'keep' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : st.dupRole === 'remove' ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : 'bg-violet-50 text-violet-700 border border-violet-200'
                        }`}
                        title={st.dupConfidence ? `${st.dupConfidence} confidence` : undefined}
                      >
                        {st.dupRole === 'keep' ? 'Keep this one' : st.dupRole === 'remove' ? 'Likely remove' : 'Review by eye'}
                        {st.dupConfidence ? ` · ${st.dupConfidence}` : ''}
                      </span>
                      {st.dupReason && (
                        <p className="text-[10px] leading-snug text-[#888] text-right">{st.dupReason}</p>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col items-end gap-1.5 mt-auto w-full">
                    <div className="flex justify-end gap-1.5 w-full">
                      <button
                        onClick={() => setEditing(r)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] tracking-[0.1em] uppercase border border-[#E8E4DF] text-[#666] rounded-sm hover:border-[#ccc] hover:text-[#1A1A1A] transition-colors"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                      {st.flags.has('duplicate') && (
                        <button
                          onClick={() => removeFromLookbook(r, 'It is flagged as a duplicate.')}
                          disabled={busy === r.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] tracking-[0.1em] uppercase border border-rose-200 text-rose-600 rounded-sm hover:bg-rose-50 transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="h-3 w-3" /> Remove dup
                        </button>
                      )}
                    </div>
                    {canRecover(r) && (
                      <button
                        onClick={() => recover(r)}
                        disabled={busy === r.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-[0.12em] uppercase border border-amber-300 text-amber-700 rounded-sm hover:bg-amber-50 transition-colors disabled:opacity-50 w-full justify-center"
                      >
                        {busy === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Recover metadata
                      </button>
                    )}
                    <button
                      onClick={() => confirm(r)}
                      disabled={busy === r.id || reviewed}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-[0.12em] uppercase rounded-sm transition-colors disabled:opacity-60 w-full justify-center ${
                        reviewed ? 'text-emerald-600 border border-emerald-200' : 'bg-[#1A1A1A] text-white hover:bg-[#333]'
                      }`}
                    >
                      <CheckCircle2 className="h-3 w-3" /> {reviewed ? 'Reviewed' : 'Confirm match'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <EditItemDialog
          item={toClosetItem(editing)}
          saving={saving}
          customCategories={customCats}
          enableMultiCategory
          imageUrl={(() => { const s = resolveItemImage(toClosetItem(editing)); return s ? proxyImageUrl(s) : null })()}
          onSave={saveEdit}
          onClose={() => setEditing(null)}
          onRemoveBackground={removeBg}
          removingBg={removingBg}
          onReplacePhoto={replacePhoto}
          replacing={replacing}
          onRotate={rotate}
          rotating={rotating}
        />
      )}

      {lightbox && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-6 md:p-10" onClick={() => setLightbox(null)}>
          <button onClick={() => setLightbox(null)} className="absolute top-5 right-6 text-white/70 hover:text-white" aria-label="Close">
            <X className="h-6 w-6" />
          </button>
          <div className="max-w-6xl w-full" onClick={(e) => e.stopPropagation()}>
            <p className="text-white/90 text-center text-[12px] tracking-[0.2em] uppercase mb-4">{lightbox.name}</p>
            <div className="grid grid-cols-2 gap-6">
              <LightboxPane url={lightbox.original} label="Original (uploaded)" />
              <LightboxPane url={lightbox.live} label="Live on lookbook" />
            </div>
            <p className="text-white/40 text-center text-[10px] mt-4">Click anywhere to close</p>
          </div>
        </div>
      )}

      {/* Review popup for an unmatched candidate: see it big, then clear it (in lookbook / tag)
          or select it as a real gap. Clearing advances to the next so you can rip through them. */}
      {candLightbox && deepResult && (() => {
        const list = deepResult.candidates
        const idx = list.findIndex((c) => c.file.id === candLightbox)
        const cand = idx >= 0 ? list[idx] : null
        if (!cand) return null
        const f = cand.file
        const big = f.thumbnailLink ? f.thumbnailLink.replace(/=s\d+/, '=s1600') : null
        const prev = list[idx - 1], next = list[idx + 1]
        const sel = selectedMissing.has(f.id)
        return (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 md:p-8" onClick={() => setCandLightbox(null)}>
            <button onClick={() => setCandLightbox(null)} className="absolute top-5 right-6 text-white/70 hover:text-white" aria-label="Close"><X className="h-6 w-6" /></button>
            {prev && <button onClick={(e) => { e.stopPropagation(); setCandLightbox(prev.file.id) }} className="absolute left-3 md:left-6 top-1/2 -translate-y-1/2 text-white/60 hover:text-white text-3xl px-2" aria-label="Previous">‹</button>}
            {next && <button onClick={(e) => { e.stopPropagation(); setCandLightbox(next.file.id) }} className="absolute right-3 md:right-6 top-1/2 -translate-y-1/2 text-white/60 hover:text-white text-3xl px-2" aria-label="Next">›</button>}
            <div className="max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-center gap-3 mb-3">
                <span className={`text-[10px] tracking-[0.1em] uppercase px-2 py-0.5 rounded-sm ${cand.verdict === 'missing' ? 'bg-rose-600 text-white' : 'bg-amber-500 text-white'}`}>
                  {cand.hits} hit{cand.hits === 1 ? '' : 's'}{cand.signals.length ? ` · ${cand.signals.join(', ')}` : ' · never uploaded'}
                </span>
                <span className="text-white/80 text-[12px]">{f.name}</span>
                <span className="text-white/40 text-[11px]">{idx + 1} / {list.length}</span>
              </div>
              <div className="bg-white/5 rounded-sm flex items-center justify-center overflow-hidden border border-white/10" style={{ maxHeight: '70vh' }}>
                {big
                  ? <img src={big} alt={f.name} className="max-w-full object-contain" style={{ maxHeight: '70vh' }} referrerPolicy="no-referrer" />
                  : <span className="text-white/40 text-sm p-10">No preview</span>}
              </div>
              <div className="flex items-center justify-center gap-2.5 mt-4 flex-wrap">
                <button onClick={() => resolveAndRemove([f.id], 'in_lookbook')} className="inline-flex items-center gap-1.5 px-4 py-2 text-[11px] tracking-[0.1em] uppercase bg-emerald-600 text-white rounded-sm hover:bg-emerald-700 transition-colors">
                  <CheckCircle2 className="h-4 w-4" /> Already in lookbook
                </button>
                <button onClick={() => resolveAndRemove([f.id], 'tag')} className="inline-flex items-center gap-1.5 px-4 py-2 text-[11px] tracking-[0.1em] uppercase bg-white/15 text-white rounded-sm hover:bg-white/25 transition-colors">
                  <Tag className="h-4 w-4" /> It's a tag / not an item
                </button>
                <button
                  onClick={() => setSelectedMissing((p) => { const n = new Set(p); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n })}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 text-[11px] tracking-[0.1em] uppercase rounded-sm transition-colors ${sel ? 'bg-[#1A1A1A] text-white' : 'border border-white/30 text-white/80 hover:bg-white/10'}`}
                >
                  {sel ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />} {sel ? 'Selected to digitize' : 'Real gap — select to digitize'}
                </button>
              </div>
              <p className="text-white/40 text-center text-[10px] mt-3">‹ › to move · cleared photos won't come back · click outside to close</p>
            </div>
          </div>
        )
      })()}
    </Shell>
  )
}

function LightboxPane({ url, label }: { url: string | null; label: string }) {
  return (
    <div>
      <div className="aspect-square bg-white/5 rounded-sm flex items-center justify-center overflow-hidden border border-white/10">
        {url
          ? <img src={url} alt={label} className="max-w-full max-h-full object-contain" />
          : <span className="text-[11px] text-white/40">No image</span>}
      </div>
      <p className="text-[9px] tracking-[0.2em] uppercase text-white/50 text-center mt-2">{label}</p>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 overflow-y-auto bg-[#FBFAF8] p-6">{children}</div>
}

// The Drive drops: files in the picked folder that were never ingested. Rendered straight
// from Drive (object URLs) so the stylist can see exactly what's missing.
function DropsGrid({ drops, urls, cap }: { drops: DriveFile[]; urls: Record<string, string>; cap: number }) {
  if (drops.length === 0) {
    return <p className="text-emerald-600 text-sm">✓ No drops — every image in this Drive folder was uploaded.</p>
  }
  const fmtSize = (b: number) => (b ? `· ${(b / 1024 / 1024).toFixed(1)} MB` : '')
  return (
    <>
      <p className="text-[12px] text-[#888] mb-3 max-w-3xl">
        {drops.length} file{drops.length === 1 ? '' : 's'} couldn't be auto-matched to this client's ingested photos
        {drops.length > cap ? ` (showing first ${cap})` : ''}. On pre-tracking uploads this is usually because the file was renamed or converted (HEIC→JPEG) — <strong>not</strong> proof it's missing. Use the count-coverage figure above. Genuinely-missing files can be brought in via Digitize.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {drops.slice(0, cap).map((f) => (
          <div key={f.id} className="border border-rose-200 rounded-sm overflow-hidden bg-white">
            <div className="aspect-square bg-[#F8F7F5] flex items-center justify-center overflow-hidden">
              {urls[f.id]
                ? <img src={urls[f.id]} alt={f.name} className="max-w-full max-h-full object-contain p-1.5" />
                : <span className="text-[9px] text-[#bbb]">Drive preview</span>}
            </div>
            <div className="px-2 py-1.5">
              <p className="text-[11px] text-[#1A1A1A] truncate" title={f.name}>{f.name}</p>
              <p className="text-[9px] tracking-[0.1em] uppercase text-amber-600 mt-0.5">Unmatched {fmtSize(f.size)}</p>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function FlagChip({ flag, count }: { flag: ReconFlag | 'clean'; count?: number }) {
  const meta = FLAG_META[flag]
  const Icon = FLAG_ICON[flag]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] tracking-[0.08em] uppercase ${TONE[meta.tone]}`}>
      <Icon className="h-3 w-3" /> {meta.label}{count && count > 1 ? ` ×${count}` : ''}
    </span>
  )
}

function Field({ label, value, missing, muted }: { label: string; value: string | null; missing?: boolean; muted?: boolean }) {
  return (
    <p className="truncate">
      <span className="text-[9px] tracking-[0.2em] uppercase text-[#bbb] mr-1.5">{label}</span>
      {missing
        ? <span className="text-rose-400 italic">missing</span>
        : <span className={muted ? 'text-[#999]' : 'text-[#444]'}>{value}</span>}
    </p>
  )
}

function ImgCell({ url, label, empty, onZoom }: { url: string | null; label: string; empty: string; onZoom?: () => void }) {
  const [broken, setBroken] = useState(false)
  const canZoom = !!url && !broken && !!onZoom
  return (
    <div className="w-[96px] flex-none">
      <div
        onClick={canZoom ? onZoom : undefined}
        className={`aspect-square rounded-sm border border-[#E8E4DF] bg-[#F8F7F5] flex items-center justify-center overflow-hidden ${canZoom ? 'cursor-zoom-in hover:border-[#1A1A1A] transition-colors' : ''}`}
      >
        {url && !broken ? (
          <img src={url} alt={label} className="max-w-full max-h-full object-contain p-1.5" loading="lazy" onError={() => setBroken(true)} />
        ) : (
          <span className="text-[9px] text-[#bbb] text-center px-2 leading-tight">{broken ? 'Broken link' : empty}</span>
        )}
      </div>
      <p className="text-[8px] tracking-[0.18em] uppercase text-[#bbb] text-center mt-1">{label}</p>
    </div>
  )
}
