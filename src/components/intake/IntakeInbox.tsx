import { useState, useEffect, useRef, useCallback } from 'react'
import { Inbox, Check, X, Edit3, RefreshCw, Upload, Camera, Download, HardDrive } from 'lucide-react'
import { useIntakeItems, type IntakeItem } from '@/hooks/useIntakeItems'
import { ClickableSignedImage, LightboxProvider } from './IntakeItemCard'
import { supabase } from '@/lib/supabase'
import { useClientStore } from '@/stores/clientStore'
import { exportGoodPixXlsx } from '@/lib/goodpix-export'
import {
  isGoogleDriveConfigured,
  signInAndPickPhotos,
  downloadDriveFile,
  refreshAccessToken,
  runDriveDiagnostics,
  type DriveFile,
  type PickedFolder,
} from '@/lib/googleDrive'
import { ensureJpegFiles } from '@/lib/heic'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const CATEGORIES = [
  'Dresses', 'Tops', 'Bottoms', 'Outerwear', 'Knitwear',
  'Shoes', 'Bags', 'Accessories', 'Jewelry', 'Swimwear',
  'Activewear', 'Intimates',
]

export function IntakeInbox() {
  const [filter, setFilter] = useState<'in_progress' | 'qc_passed' | 'pending_review' | 'approved' | 'rejected_final' | 'all'>(() => {
    // Default to In Progress if there are active batches
    const saved = localStorage.getItem('atelier_active_batch')
    return saved ? 'in_progress' : 'pending_review'
  })
  const [activeBatchCount, setActiveBatchCount] = useState(0)
  const [bulkApproving, setBulkApproving] = useState(false)
  const [bulkProgress, setBulkProgress] = useState('')
  const [showBulkConfirm, setShowBulkConfirm] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState('')
  const { activeClient } = useClientStore()
  const [selectedClientId, setSelectedClientId] = useState<string | null>(activeClient?.id ?? null)
  // When "In Progress" tab is active, the hook still needs a valid filter — use 'qc_passed' as default
  const hookFilter = filter === 'in_progress' ? 'pending_review' : filter
  const { items, loading, error, refresh, counts } = useIntakeItems(hookFilter, selectedClientId)
  const [showUpload, setShowUpload] = useState(false)
  const [clientOptions, setClientOptions] = useState<Array<{ id: string; name: string }>>([])
  const [_aiSpend, _setAiSpend] = useState<{ anthropic: number; openai: number; total: number } | null>(null)

  // Multi-select for bulk approve/reject (check items as you review → act on all at once)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkActing, setBulkActing] = useState('')
  const toggleSelect = (id: string) =>
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const handleBulkAction = async (action: 'approve' | 'reject') => {
    const ids = [...selectedIds]
    if (!ids.length || bulkActing) return
    const fn = action === 'approve' ? 'intake-approve-item' : 'intake-reject-final'
    const verb = action === 'approve' ? 'Approving' : 'Rejecting'
    const BATCH = 10
    let done = 0
    for (let i = 0; i < ids.length; i += BATCH) {
      setBulkActing(`${verb} ${done} of ${ids.length}...`)
      const res = await Promise.allSettled(ids.slice(i, i + BATCH).map(id =>
        fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: id }),
        }).then(r => { if (!r.ok) throw new Error(); return r })))
      done += res.filter(r => r.status === 'fulfilled').length
    }
    setSelectedIds(new Set()); setBulkActing(''); refresh()
  }
  const handleClearApproved = async () => {
    if (!confirm('Clear all approved items from this tab? They stay in the collection — this just clears the list.')) return
    await fetch(`${SUPABASE_URL}/functions/v1/intake-clear-approved`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selectedClientId ? { client_id: selectedClientId } : {}),
    })
    refresh()
  }
  // Rejected fix loop: download the originals for ChatGPT, then upload the finished images back.
  const handleDownloadRejected = async () => {
    setBulkActing('Building zip...')
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-export-rejected`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedClientId ? { client_id: selectedClientId } : {}),
      })
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || 'Export failed')
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = 'reprocess-for-chatgpt.zip'; a.click()
      URL.revokeObjectURL(url)
    } catch (err) { alert(err instanceof Error ? err.message : 'Export failed') }
    finally { setBulkActing('') }
  }
  const handleUploadReplace = async (files: FileList) => {
    const arr = [...files]
    let done = 0, matched = 0
    for (const f of arr) {
      const m = f.name.match(/(\d{1,4})/) // the number the stylist kept on the file
      if (m) {
        const form = new FormData()
        form.append('photo', f)
        form.append('export_number', String(parseInt(m[1], 10)))
        if (selectedClientId) form.append('client_id', selectedClientId)
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-replace-rejected`, { method: 'POST', body: form })
        if (resp.ok) matched++
      }
      done++
      setBulkActing(`Uploading ${done} of ${arr.length}... (${matched} matched)`)
    }
    setBulkActing('')
    alert(`${matched} of ${arr.length} matched and moved to Needs Review for final approval.`)
    refresh()
  }

  // Sync: if stylist switches client in the Builder, update the inbox filter
  useEffect(() => {
    if (activeClient?.id && activeClient.id !== selectedClientId) {
      setSelectedClientId(activeClient.id)
    }
  }, [activeClient?.id])

  // Poll active batch count for the tab badge
  useEffect(() => {
    const check = async () => {
      const { count } = await supabase
        .from('intake_batches')
        .select('id', { count: 'exact', head: true })
        .in('status', ['uploading', 'verifying_order', 'processing'])
      setActiveBatchCount(count ?? 0)
    }
    check()
    const iv = setInterval(check, 10000)
    return () => clearInterval(iv)
  }, [])

  // Load AI spend for current month
  useEffect(() => {
    const loadSpend = async () => {
      const startOfMonth = new Date()
      startOfMonth.setDate(1)
      startOfMonth.setHours(0, 0, 0, 0)
      const { data } = await supabase
        .from('ai_usage_log')
        .select('service, cost_usd_estimate')
        .gte('created_at', startOfMonth.toISOString())
      if (data) {
        let anthropic = 0, openai = 0
        for (const r of data) {
          const cost = r.cost_usd_estimate ?? 0
          if (r.service === 'anthropic') anthropic += cost
          else if (r.service === 'openai') openai += cost
        }
        _setAiSpend({ anthropic, openai, total: anthropic + openai })
      }
    }
    loadSpend()
    const iv = setInterval(loadSpend, 30000)
    return () => clearInterval(iv)
  }, [])

  // Load clients that have intake items
  useEffect(() => {
    supabase
      .from('intake_items')
      .select('client_id')
      .then(({ data }) => {
        const ids = [...new Set((data ?? []).map((d: any) => d.client_id))]
        if (ids.length > 0) {
          supabase
            .from('gp_clients')
            .select('id, name')
            .in('id', ids)
            .order('name')
            .then(({ data: clients }) => setClientOptions(clients ?? []))
        }
      })
  }, [])

  const tabs = [
    { key: 'in_progress' as const, label: 'In Progress', count: activeBatchCount, accent: true },
    { key: 'pending_review' as const, label: 'Needs Review', count: counts.pending },
    { key: 'approved' as const, label: 'Approved', count: counts.approved },
    { key: 'rejected_final' as const, label: 'Rejected', count: counts.rejected },
  ]

  const handleBulkApprove = async () => {
    if (bulkApproving) return
    setShowBulkConfirm(false)
    setBulkApproving(true)
    const qcItems = items.filter(i => i.status === 'qc_passed')
    let approved = 0
    let failed = 0
    const BATCH = 10

    for (let i = 0; i < qcItems.length; i += BATCH) {
      const chunk = qcItems.slice(i, i + BATCH)
      const results = await Promise.allSettled(
        chunk.map(item =>
          fetch(`${SUPABASE_URL}/functions/v1/intake-approve-item`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: item.id }),
          }).then(r => { if (!r.ok) throw new Error(); return r })
        )
      )
      approved += results.filter(r => r.status === 'fulfilled').length
      failed += results.filter(r => r.status === 'rejected').length
      setBulkProgress(`Approved ${approved} of ${qcItems.length}...`)
    }

    setBulkProgress(failed > 0
      ? `Done: ${approved} approved, ${failed} failed`
      : `All ${approved} items approved!`)
    setTimeout(() => { setBulkApproving(false); setBulkProgress(''); refresh() }, 2000)
  }

  const handleExportGoodPix = async () => {
    if (!selectedClientId) { alert('Select a client first'); return }
    setExporting(true)
    setExportProgress('Preparing export...')
    try {
      const clientName = clientOptions.find(c => c.id === selectedClientId)?.name ?? 'Client'
      await exportGoodPixXlsx(selectedClientId, clientName, (done, total) => {
        setExportProgress(`Generating URLs: ${done} of ${total}...`)
      })
      setExportProgress('Downloaded!')
      setTimeout(() => { setExporting(false); setExportProgress('') }, 2000)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Export failed')
      setExporting(false)
      setExportProgress('')
    }
  }

  return (
    <LightboxProvider>
    <div className="flex-1 bg-[#F8F7F5] flex flex-col overflow-hidden">
      {/* Upload toggle bar */}
      <div className="flex items-center justify-between px-4 md:px-6 py-2 bg-white border-b border-[#E8E4DF] shrink-0">
        <div className="flex items-center gap-3">
          {counts.pending > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] tracking-[0.2em] uppercase text-[#888]">
                {counts.pending} pending review
              </span>
              <div className="w-2 h-2 rounded-full bg-blush animate-pulse" />
            </div>
          )}
        </div>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className={`flex items-center gap-1.5 px-4 py-2 text-[10px] tracking-[0.15em] uppercase rounded transition-colors ${
            showUpload ? 'bg-[#1A1A1A] text-white' : 'bg-[#F8E5E7] text-[#1A1A1A] hover:bg-[#F0D8DB]'
          }`}
        >
          <Camera className="h-3.5 w-3.5" />
          Upload
        </button>
      </div>

      {/* Upload panel — collapsible */}
      {showUpload && (
        <UploadPanel
          onRefreshItems={refresh}
          onComplete={() => {
            setShowUpload(false)
            setFilter('in_progress')
            refresh()
          }}
        />
      )}

      {/* Tabs */}
      <div className="flex border-b border-[#E8E4DF] bg-white shrink-0">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`
              flex-1 px-4 py-3 text-[11px] tracking-[0.2em] uppercase font-sans
              transition-colors relative
              ${filter === tab.key
                ? 'text-[#1A1A1A] border-b-2 border-[#1A1A1A]'
                : 'text-[#888] hover:text-[#1A1A1A]'
              }
            `}
          >
            <span className="flex items-center justify-center gap-1.5">
              {tab.key === 'in_progress' && tab.count > 0 && (
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              )}
              {tab.label}
            </span>
            {tab.count > 0 && (
              <span className={`
                ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px]
                rounded-full text-[9px] font-medium px-1
                ${tab.key === 'in_progress' ? 'bg-emerald-100 text-emerald-700'
                  : tab.key === 'pending_review' ? 'bg-blush text-[#1A1A1A]'
                  : 'bg-[#E8E4DF] text-[#888]'}
              `}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Client filter bar */}
      <div className="flex items-center gap-2 px-4 md:px-6 py-2 bg-white border-b border-[#E8E4DF] shrink-0">
        <span className="text-[9px] tracking-[0.15em] uppercase text-[#888]">Client:</span>
        <button
          onClick={() => setSelectedClientId(null)}
          className={`px-2.5 py-1 text-[10px] tracking-[0.1em] uppercase rounded-sm transition-colors ${
            !selectedClientId ? 'bg-[#1A1A1A] text-white' : 'bg-[#F8F7F5] text-[#888] hover:bg-[#E8E4DF]'
          }`}
        >
          All
        </button>
        {clientOptions.map(c => (
          <button
            key={c.id}
            onClick={() => setSelectedClientId(c.id)}
            className={`px-2.5 py-1 text-[10px] tracking-[0.1em] rounded-sm transition-colors truncate max-w-[160px] ${
              selectedClientId === c.id ? 'bg-[#1A1A1A] text-white' : 'bg-[#F8F7F5] text-[#888] hover:bg-[#E8E4DF]'
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* Content — In Progress tab or item cards */}
      {filter === 'in_progress' ? (
        <div className="flex-1 overflow-y-auto">
          <InProgressPanel onBatchCountChange={setActiveBatchCount} onRefreshItems={refresh} />
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="w-8 h-8 mx-auto border-2 border-[#E8E4DF] border-t-[#1A1A1A] rounded-full animate-spin mb-3" />
              <p className="text-[11px] tracking-[0.15em] uppercase text-[#888]">Loading...</p>
            </div>
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="text-sm text-red-600 mb-2">{error}</p>
            <button onClick={refresh} className="text-[11px] tracking-[0.15em] uppercase text-[#1A1A1A] underline">
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              {filter === 'pending_review' ? (
                <>
                  <Check className="h-8 w-8 mx-auto text-emerald-400 mb-3" />
                  <p className="text-sm text-[#888]">All caught up!</p>
                  <p className="text-xs text-[#aaa] mt-1">No items waiting for review.</p>
                </>
              ) : (
                <>
                  <Inbox className="h-8 w-8 mx-auto text-[#ccc] mb-3" />
                  <p className="text-sm text-[#888]">No {filter.replace('_', ' ')} items</p>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto py-4 md:py-6 px-4 md:px-6 space-y-4">
            {/* GoodPix Export (Approved tab) */}
            {filter === 'approved' && items.length > 0 && (
              <div className="flex items-center justify-between bg-white border border-[#E8E4DF] rounded-sm px-4 py-3">
                <div className="flex items-center gap-2">
                  <Download className="h-4 w-4 text-[#888]" />
                  <span className="text-sm text-[#1A1A1A]">{items.length} approved items ready for GoodPix</span>
                </div>
                <button
                  onClick={handleExportGoodPix}
                  disabled={exporting}
                  className="flex items-center gap-2 px-5 py-2 bg-[#1A1A1A] text-white text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#333] disabled:opacity-50 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  {exporting ? exportProgress : 'Download for GoodPix'}
                </button>
              </div>
            )}

            {/* Bulk Approve bar (QC Passed tab only) */}
            {filter === 'qc_passed' && items.length > 0 && !bulkApproving && (
              <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-sm px-4 py-3">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm text-emerald-800">{items.length} items passed QC — ready to add to collection</span>
                </div>
                <button
                  onClick={() => setShowBulkConfirm(true)}
                  className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-emerald-700 transition-colors"
                >
                  <Check className="h-3.5 w-3.5" />
                  Approve All {items.length} Items
                </button>
              </div>
            )}

            {/* Bulk approve progress */}
            {bulkApproving && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-sm px-4 py-3 text-center">
                <RefreshCw className="h-4 w-4 text-emerald-600 animate-spin inline mr-2" />
                <span className="text-sm text-emerald-800">{bulkProgress}</span>
              </div>
            )}

            {/* Bulk approve confirmation modal */}
            {showBulkConfirm && (
              <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center">
                <div className="bg-white rounded-sm p-6 max-w-md mx-4 shadow-xl">
                  <h3 className="text-lg font-serif text-[#1A1A1A] mb-2">Approve {items.length} Items?</h3>
                  <p className="text-sm text-[#888] mb-4">
                    {items.length} items that passed QC will be added to
                    {selectedClientId
                      ? ` ${items[0]?.client_name ?? 'this client'}'s`
                      : ' their respective clients\''} collection.
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={handleBulkApprove}
                      disabled={bulkApproving}
                      className="flex-1 px-4 py-2.5 bg-emerald-600 text-white text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Confirm Approve All
                    </button>
                    <button
                      onClick={() => setShowBulkConfirm(false)}
                      className="px-4 py-2.5 border border-[#E8E4DF] text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#F8F7F5]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {filter === 'approved' && items.length > 0 && (
              <div className="flex justify-end mb-2">
                <button onClick={handleClearApproved} className="text-[10px] tracking-[0.15em] uppercase text-[#888] hover:text-[#1A1A1A] underline">
                  Clear approved (stays in collection)
                </button>
              </div>
            )}

            {filter === 'rejected_final' && items.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 mb-3 p-3 bg-[#FAFAF8] border border-[#E8E4DF] rounded-sm">
                <span className="text-[10px] tracking-[0.15em] uppercase text-[#888]">Fix in ChatGPT:</span>
                <button onClick={handleDownloadRejected} disabled={!!bulkActing} className="flex items-center gap-1.5 px-3 py-2 bg-[#1A1A1A] text-white text-[10px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#333] disabled:opacity-50">
                  <Download className="h-3.5 w-3.5" /> Download for ChatGPT
                </button>
                <label className="flex items-center gap-1.5 px-3 py-2 border border-[#E8E4DF] text-[#888] text-[10px] tracking-[0.15em] uppercase rounded-sm hover:border-[#ccc] hover:text-[#1A1A1A] cursor-pointer">
                  <Upload className="h-3.5 w-3.5" /> Upload to replace
                  <input type="file" multiple accept="image/*" className="hidden" onChange={e => { if (e.target.files) handleUploadReplace(e.target.files) }} />
                </label>
                {bulkActing && <span className="text-[11px] text-[#888]">{bulkActing}</span>}
                <span className="text-[10px] text-[#aaa] ml-auto">Keep each file's number — finished images map back automatically</span>
              </div>
            )}

            {selectedIds.size > 0 && (
              <div className="sticky top-2 z-20 flex items-center gap-3 bg-[#1A1A1A] text-white rounded-sm px-4 py-2.5 shadow-lg">
                <span className="text-[11px] tracking-[0.15em] uppercase">{selectedIds.size} selected</span>
                <div className="flex-1" />
                {bulkActing ? (
                  <span className="text-[11px] text-white/70">{bulkActing}</span>
                ) : (
                  <>
                    <button onClick={() => handleBulkAction('approve')} className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-[#1A1A1A] text-[10px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#F8F7F5]">
                      <Check className="h-3.5 w-3.5" /> Approve selected
                    </button>
                    <button onClick={() => handleBulkAction('reject')} className="flex items-center gap-1.5 px-3 py-1.5 border border-white/30 text-white text-[10px] tracking-[0.15em] uppercase rounded-sm hover:bg-white/10">
                      <X className="h-3.5 w-3.5" /> Reject selected
                    </button>
                    <button onClick={() => setSelectedIds(new Set())} className="text-[10px] tracking-[0.15em] uppercase text-white/60 hover:text-white">Clear</button>
                  </>
                )}
              </div>
            )}

            {items.map(item => (
              <InlineItemCard key={item.id} item={item} onAction={refresh} selected={selectedIds.has(item.id)} onToggle={() => toggleSelect(item.id)} />
            ))}
          </div>
        )}
      </div>
      )}
    </div>
    </LightboxProvider>
  )
}

/**
 * Inline item card — everything visible at once, built for speed.
 * AI photo large on left, original + tag small below it,
 * metadata + actions on the right. One-tap approve.
 */
function InlineItemCard({ item, onAction, selected, onToggle }: { item: IntakeItem; onAction: () => void; selected?: boolean; onToggle?: () => void }) {
  const [editing, setEditing] = useState(false)
  const [brand, setBrand] = useState(item.extracted_brand || '')
  const [name, setName] = useState(item.extracted_name || '')
  const [color, setColor] = useState(item.extracted_color || '')
  const [category, setCategory] = useState(item.extracted_category || '')
  const [material, setMaterial] = useState(item.extracted_material || '')
  const [showRestyle, setShowRestyle] = useState(false)
  const [restyleNote, setRestyleNote] = useState('')
  const [restyling, setRestyling] = useState(false)
  const [currentAiKey, setCurrentAiKey] = useState(item.ai_image_primary_r2_key)
  const [rejecting, setRejecting] = useState(false)
  // New reject UX: the stylist confirms or disputes the QC assessment + adds a note.
  // That + the QC issues drive an automatic backend restyle (no stylist prompt-writing).
  const [agreedWithQc, setAgreedWithQc] = useState<boolean | null>(null)
  const [rejectionNote, setRejectionNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [actionResult, setActionResult] = useState<'approved' | 'rejected' | null>(null)

  const handleRestyle = async () => {
    // For restyle (has existing AI image), instructions are required.
    // For first-time generate, empty instructions = use default prompt.
    if (currentAiKey && !restyleNote.trim()) {
      alert('Describe how you want the photo restyled')
      return
    }
    setRestyling(true)
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-restyle-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: item.id,
          instructions: restyleNote.trim(),
        }),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Restyle failed' }))
        throw new Error(err.error || 'Restyle failed')
      }

      const data = await resp.json()
      // Update the displayed AI image with the new one
      setCurrentAiKey(data.ai_image_r2_key)
      setRestyleNote('')
      setShowRestyle(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to restyle')
    } finally {
      setRestyling(false)
    }
  }

  // Reject WITHOUT a redo → Rejected column (intake-reject-final). Reversible via restore=true.
  const handleRejectFinal = async (restore = false) => {
    if (submitting) return
    setSubmitting(true)
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-reject-final`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, restore }),
      })
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || 'Action failed')
      if (!restore) setActionResult('rejected')
      onAction()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  const handleApprove = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-approve-item`, {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          item_id: item.id,
          metadata_overrides: editing ? {
            brand: brand || null,
            item_name: name || null,
            color: color || null,
            category: category || null,
            material: material || null,
          } : undefined,
          feedback: undefined,
        }),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Approve failed' }))
        throw new Error(err.error || 'Approve failed')
      }

      setActionResult('approved')
      setTimeout(() => onAction(), 1200)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to approve')
    } finally {
      setSubmitting(false)
    }
  }

  const handleReject = async () => {
    if (submitting) return
    if (agreedWithQc === null) {
      alert('Let us know if the QC notes match what you see')
      return
    }
    if (agreedWithQc === false && !rejectionNote.trim()) {
      alert("Please describe what's actually wrong so we can fix it")
      return
    }
    setSubmitting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-reject-item`, {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          item_id: item.id,
          agreed_with_qc: agreedWithQc,
          rejection_note: rejectionNote || null,
        }),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Reject failed' }))
        throw new Error(err.error || 'Reject failed')
      }

      setActionResult('rejected')
      setTimeout(() => onAction(), 1200)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reject')
    } finally {
      setSubmitting(false)
    }
  }

  // After action — show brief confirmation then fade out
  if (actionResult) {
    return (
      <div className={`bg-white rounded-sm border p-6 text-center transition-opacity duration-500 ${
        actionResult === 'approved' ? 'border-emerald-200 bg-emerald-50/30' : 'border-red-200 bg-red-50/30'
      }`}>
        <div className="flex items-center justify-center gap-2">
          {actionResult === 'approved' ? (
            <><Check className="h-5 w-5 text-emerald-600" /><span className="text-sm text-emerald-700">Approved — added to collection</span></>
          ) : (
            <><RefreshCw className="h-5 w-5 text-amber-500" /><span className="text-sm text-amber-700">Sent back to be reprocessed — it'll return to Needs Review</span></>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-sm border border-[#E8E4DF] overflow-hidden">
      <div className="flex flex-col md:flex-row">
        {/* Left: Images stack — AI photo on top, originals below */}
        <div className="md:w-[420px] shrink-0 p-4 space-y-3">
          {/* Hero image — AI product photo if available, otherwise original garment */}
          {(() => {
            const heroKey = currentAiKey ?? item.garment_photo?.r2_key
            return heroKey ? (
              <div className="aspect-[3/4] bg-[#F8F7F5] rounded-sm overflow-hidden border border-[#E8E4DF] relative">
                <ClickableSignedImage
                  r2Key={heroKey}
                  alt={item.extracted_name ?? 'Product photo'}
                  className={`w-full h-full ${currentAiKey ? 'object-contain p-2' : 'object-cover'}`}
                  label={currentAiKey ? 'AI Product Photo' : 'Original Photo'}
                />
                {!currentAiKey && (
                  <div className="absolute bottom-2 left-2 bg-[#1A1A1A]/70 text-white text-[8px] tracking-[0.15em] uppercase px-2 py-0.5 rounded-sm">
                    Original photo
                  </div>
                )}
                {restyling && (
                  <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                    <div className="text-center">
                      <RefreshCw className="h-6 w-6 mx-auto text-[#1A1A1A] animate-spin mb-2" />
                      <p className="text-[10px] tracking-[0.15em] uppercase text-[#888]">
                        {currentAiKey ? 'Restyling...' : 'Generating product photo...'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="aspect-square bg-[#F8F7F5] rounded-sm overflow-hidden border border-[#E8E4DF] flex items-center justify-center">
                <span className="text-[10px] tracking-[0.2em] uppercase text-[#ccc]">No photo</span>
              </div>
            )
          })()}

          {/* Original + Tag side by side */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[9px] tracking-[0.15em] uppercase text-[#aaa] mb-1">Original</p>
              {item.garment_photo?.r2_key ? (
                <div className="aspect-[3/4] bg-[#F8F7F5] rounded-sm overflow-hidden border border-[#E8E4DF]">
                  <ClickableSignedImage r2Key={item.garment_photo.r2_key} alt="Original" className="w-full h-full object-cover" label="Original iPhone Photo" />
                </div>
              ) : (
                <div className="aspect-[3/4] bg-[#F8F7F5] rounded-sm border border-dashed border-[#ddd]" />
              )}
            </div>
            <div>
              <p className="text-[9px] tracking-[0.15em] uppercase text-[#aaa] mb-1">Tag</p>
              {item.tag_photo?.r2_key ? (
                <div className="aspect-[3/4] bg-[#F8F7F5] rounded-sm overflow-hidden border border-[#E8E4DF]">
                  <ClickableSignedImage r2Key={item.tag_photo.r2_key} alt="Tag" className="w-full h-full object-cover" label="Brand/Care Tag" />
                </div>
              ) : (
                <div className="aspect-[3/4] bg-[#F8F7F5] rounded-sm border border-dashed border-[#E8E4DF] flex items-center justify-center">
                  <span className="text-[9px] text-[#ddd]">No tag</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Metadata + Actions */}
        <div className="flex-1 p-4 md:p-6 flex flex-col">
          {/* Client + Item header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-start gap-3">
              {onToggle && (item.status === 'pending_review' || item.status === 'qc_passed') && (
                <input type="checkbox" checked={!!selected} onChange={onToggle} className="mt-1.5 h-4 w-4 rounded-sm border-[#ccc] accent-[#1A1A1A] cursor-pointer shrink-0" aria-label="Select item" />
              )}
              <div>
                <p className="text-[10px] tracking-[0.2em] uppercase text-blush">{item.client_name}</p>
                <h3 className="text-lg font-serif text-[#1A1A1A] mt-0.5 leading-tight">
                  {editing ? name || 'Untitled Item' : item.extracted_name || 'Untitled Item'}
                </h3>
              </div>
            </div>
            {(item.status === 'pending_review' || item.status === 'qc_passed') && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase text-[#888] hover:text-[#1A1A1A] transition-colors shrink-0 ml-4"
              >
                <Edit3 className="h-3 w-3" />
                Edit
              </button>
            )}
          </div>

          {(item.reprocess_attempts ?? 0) > 0 && (
            <p className="text-[11px] text-[#b06a4a] font-medium -mt-2 mb-3">↩ Sent back {item.reprocess_attempts}× — rework or reject it</p>
          )}

          {/* Metadata fields — compact */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-6">
            <MetadataField label="Brand" value={brand} editing={editing} onChange={setBrand} />
            <MetadataField label="Color" value={color} editing={editing} onChange={setColor} />
            <MetadataField label="Category" value={category} editing={editing} onChange={setCategory} options={CATEGORIES} />
            <MetadataField label="Material" value={material} editing={editing} onChange={setMaterial} />
          </div>

          {editing && (
            <div className="mb-4">
              <MetadataField label="Item Name" value={name} editing={editing} onChange={setName} />
            </div>
          )}

          {/* QC info (if available) */}
          {item.qc_score != null && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-sm text-xs mb-3 ${
              item.qc_score >= 0.80 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}>
              <span className="font-medium">QC {Math.round(item.qc_score * 100)}%</span>
              {item.qc_issues && item.qc_issues.length > 0 && (
                <span>· {item.qc_issues.map(i => i.replace(/_/g, ' ')).join(', ')}</span>
              )}
            </div>
          )}
          {item.qc_notes && item.status === 'pending_review' && (
            <div className="bg-amber-50/50 border border-amber-100 rounded-sm px-3 py-2 mb-3">
              <p className="text-[9px] tracking-[0.1em] uppercase text-amber-600 mb-0.5">QC Notes</p>
              <p className="text-xs text-amber-800">{item.qc_notes}</p>
              {item.qc_attempt >= 2 && (
                <p className="text-[9px] text-amber-500 mt-1">Auto-restyle attempted and failed — needs manual review</p>
              )}
            </div>
          )}

          {/* Spacer to push actions to bottom */}
          <div className="flex-1" />

          {/* Restyle area (toggle) */}
          {showRestyle && !rejecting && (item.status === 'pending_review' || item.status === 'qc_passed') && (
            <div className="mb-3 border border-[#E8E4DF] rounded-sm p-3 bg-[#FAFAF8]">
              <p className="text-[9px] tracking-[0.15em] uppercase text-[#888] mb-2">
                {currentAiKey ? 'Restyle instructions' : 'Product photo instructions (optional)'}
              </p>
              <textarea
                value={restyleNote}
                onChange={e => setRestyleNote(e.target.value)}
                placeholder={currentAiKey
                  ? "e.g. show as flat lay, crop tighter, make the navy darker..."
                  : "e.g. flat lay on white, no hanger (leave blank for default product shot)"}
                className="w-full border border-[#E8E4DF] rounded-sm px-3 py-2 text-sm text-[#1A1A1A] resize-none h-16 focus:border-[#888] focus:outline-none mb-2"
                disabled={restyling}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleRestyle}
                  disabled={restyling || (!!currentAiKey && !restyleNote.trim())}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-[#1A1A1A] text-white text-[10px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#333] disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${restyling ? 'animate-spin' : ''}`} />
                  {restyling ? 'Restyling (~30s)...' : 'Restyle Photo'}
                </button>
                <button
                  onClick={() => { setShowRestyle(false); setRestyleNote('') }}
                  disabled={restyling}
                  className="px-3 py-2 border border-[#E8E4DF] text-[10px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#F8F7F5] disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
              <p className="text-[9px] text-[#aaa] mt-2">~$0.08 per restyle · uses original garment photo</p>
            </div>
          )}

          {/* Reject panel — confirm/dispute QC + a note; the backend auto-reprocesses it */}
          {rejecting && (
            <div className="border border-amber-100 rounded-sm p-3 bg-amber-50/30 mb-3">
              <p className="text-[11px] tracking-[0.15em] uppercase text-amber-700 font-medium mb-2">Send back for a redo</p>
              {(item.qc_notes || (item.qc_issues && item.qc_issues.length > 0)) ? (
                <div className="bg-white/70 border border-amber-100 rounded-sm px-3 py-2 mb-3">
                  <p className="text-[9px] tracking-[0.1em] uppercase text-amber-600 mb-0.5">What QC flagged</p>
                  {item.qc_issues && item.qc_issues.length > 0 && (
                    <p className="text-xs text-amber-800">{item.qc_issues.map(i => i.replace(/_/g, ' ')).join(', ')}</p>
                  )}
                  {item.qc_notes && <p className="text-xs text-amber-800 mt-0.5">{item.qc_notes}</p>}
                </div>
              ) : (
                <p className="text-xs text-[#888] mb-3">QC didn't flag anything specific — tell us what's wrong below.</p>
              )}
              <p className="text-[11px] text-[#555] mb-2">Does this match what you see?</p>
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => setAgreedWithQc(true)}
                  className={`flex-1 px-3 py-2 text-[10px] tracking-[0.15em] uppercase rounded-sm border transition-colors ${agreedWithQc === true ? 'border-amber-400 bg-amber-100 text-amber-800' : 'border-[#E8E4DF] text-[#888] hover:border-amber-300'}`}
                >
                  Yes, that's the issue
                </button>
                <button
                  onClick={() => setAgreedWithQc(false)}
                  className={`flex-1 px-3 py-2 text-[10px] tracking-[0.15em] uppercase rounded-sm border transition-colors ${agreedWithQc === false ? 'border-amber-400 bg-amber-100 text-amber-800' : 'border-[#E8E4DF] text-[#888] hover:border-amber-300'}`}
                >
                  No, it's something else
                </button>
              </div>
              <textarea
                value={rejectionNote}
                onChange={e => setRejectionNote(e.target.value)}
                placeholder={agreedWithQc === false
                  ? "Then what's actually wrong? (required) — e.g. it turned the dress into a jumpsuit"
                  : "Anything to add that would help us fix it? (optional)"}
                className="w-full border border-[#E8E4DF] rounded-sm px-3 py-2 text-sm resize-none h-16 focus:border-amber-400 focus:outline-none mb-2"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleReject}
                  disabled={submitting}
                  className="flex-1 px-3 py-2 bg-amber-600 text-white text-[10px] tracking-[0.15em] uppercase rounded-sm hover:bg-amber-700 disabled:opacity-50"
                >
                  {submitting ? 'Sending...' : 'Send back to fix'}
                </button>
                <button
                  onClick={() => { setRejecting(false); setAgreedWithQc(null); setRejectionNote('') }}
                  className="px-3 py-2 border border-[#E8E4DF] text-[10px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#F8F7F5]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Action buttons — Approve / Restyle / Reject */}
          {(item.status === 'pending_review' || item.status === 'qc_passed') && !rejecting && (
            <div className="flex gap-2">
              <button
                onClick={handleApprove}
                disabled={submitting || restyling}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-[#1A1A1A] text-white text-[11px] tracking-[0.2em] uppercase rounded-sm hover:bg-[#333] transition-colors disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                {submitting ? 'Approving...' : 'Approve'}
              </button>
              <button
                onClick={() => setRejecting(true)}
                disabled={submitting}
                className="flex items-center justify-center gap-1.5 px-4 py-3 border border-[#E8E4DF] text-[#888] text-[11px] tracking-[0.2em] uppercase rounded-sm hover:border-amber-300 hover:text-amber-700 transition-colors disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" />
                Send back to fix
              </button>
              <button
                onClick={() => handleRejectFinal(false)}
                disabled={submitting}
                className="flex items-center justify-center gap-1.5 px-4 py-3 border border-[#E8E4DF] text-[#888] text-[11px] tracking-[0.2em] uppercase rounded-sm hover:border-red-300 hover:text-red-600 transition-colors disabled:opacity-50"
              >
                <X className="h-4 w-4" />
                Reject
              </button>
            </div>
          )}

          {/* Already actioned status */}
          {/* Already actioned status badges */}
          {item.status === 'approved' && (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 rounded-sm">
              <Check className="h-4 w-4 text-emerald-600" />
              <span className="text-sm text-emerald-700">Approved — added to collection</span>
            </div>
          )}
          {(item.status === 'rerun_requested' || item.status === 'qc_failed_restyle') && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-sm">
              <RefreshCw className="h-4 w-4 text-amber-500 animate-spin" />
              <span className="text-sm text-amber-700">Reprocessing — will return to Needs Review</span>
            </div>
          )}
          {(item.status === 'rejected' || item.status === 'rejected_final') && (
            <div className="flex items-center justify-between gap-2 p-3 bg-red-50 rounded-sm">
              <div className="flex items-center gap-2">
                <X className="h-4 w-4 text-red-500" />
                <span className="text-sm text-red-600">Rejected</span>
              </div>
              <button
                onClick={() => handleRejectFinal(true)}
                disabled={submitting}
                className="text-[10px] tracking-[0.15em] uppercase text-[#888] hover:text-[#1A1A1A] underline disabled:opacity-50"
              >
                Restore to Needs Review
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Upload panel — select client, drop photos, pipeline runs automatically.
 */
/**
 * In Progress Panel — shows all active batches from the database.
 * Works across stylists: Chelsea's and Madeline's batches both appear.
 * Polls every 5 seconds for real-time progress updates.
 */
interface ActiveBatch {
  id: string
  client_id: string
  client_name: string
  batch_label: string | null
  status: string
  total_photos: number
  estimated_pairs: number | null
  created_at: string
  completed_at: string | null
  photos_classified: number
  photos_total: number
  items_done: number
  items_total: number
  items_processing: number
  items_approved: number
  items_rejected: number
  items_to_review: number
}

function InProgressPanel({ onBatchCountChange, onRefreshItems }: { onBatchCountChange: (n: number) => void; onRefreshItems: () => void }) {
  const [batches, setBatches] = useState<ActiveBatch[]>([])
  const [loading, setLoading] = useState(true)

  // Store callbacks in refs to avoid stale closures in the polling interval
  const onBatchCountChangeRef = useRef(onBatchCountChange)
  const onRefreshItemsRef = useRef(onRefreshItems)
  onBatchCountChangeRef.current = onBatchCountChange
  onRefreshItemsRef.current = onRefreshItems

  useEffect(() => {
    let mounted = true

    const fetchBatches = async () => {
      // Get active batches + recently completed. 7-day window so a finished batch stays
      // visible (with its review-completion bar) until the stylist has reviewed every item.
      const yesterday = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const { data: activeBatches } = await supabase
        .from('intake_batches')
        .select('id, client_id, batch_label, status, total_photos, estimated_pairs, created_at, completed_at')
        .in('status', ['uploading', 'verifying_order', 'processing'])
        .order('created_at', { ascending: false })

      const { data: recentDone } = await supabase
        .from('intake_batches')
        .select('id, client_id, batch_label, status, total_photos, estimated_pairs, created_at, completed_at')
        .in('status', ['complete', 'partial'])
        .gte('completed_at', yesterday)
        .order('completed_at', { ascending: false })
        .limit(10)

      const rawBatches = [...(activeBatches ?? []), ...(recentDone ?? [])]

      if (rawBatches.length === 0) {
        if (mounted) {
          setBatches([])
          setLoading(false)
          onBatchCountChangeRef.current(0)
          localStorage.removeItem('atelier_active_batch')
        }
        return
      }

      // Update the tab badge with active-only count
      const activeCount = (activeBatches ?? []).length
      onBatchCountChangeRef.current(activeCount)
      if (activeCount === 0) localStorage.removeItem('atelier_active_batch')

      // Get client names
      const clientIds = [...new Set(rawBatches.map(b => b.client_id))]
      const { data: clients } = await supabase
        .from('gp_clients')
        .select('id, name')
        .in('id', clientIds)
      const clientMap = Object.fromEntries((clients ?? []).map(c => [c.id, c.name]))

      // For each batch, get progress via batch-status endpoint
      const enriched: ActiveBatch[] = await Promise.all(
        rawBatches.map(async (b) => {
          try {
            const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-batch-status`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ batch_id: b.id }),
            })
            const status = resp.ok ? await resp.json() : {}
            const items = status.items ?? {}
            const photos = status.photos ?? {}
            const done = (items.qc_passed ?? 0) + (items.pending_review ?? 0) + (items.approved ?? 0) + (items.rejected_final ?? 0)
            const processing = (items.pending_metadata ?? 0) + (items.pending_image_gen ?? 0) + (items.pending_qc ?? 0) + (items.qc_failed_restyle ?? 0)
            return {
              id: b.id,
              client_id: b.client_id,
              client_name: clientMap[b.client_id] ?? 'Unknown Client',
              batch_label: b.batch_label,
              status: status.status ?? b.status,
              total_photos: b.total_photos,
              estimated_pairs: status.estimated_pairs ?? b.estimated_pairs,
              created_at: b.created_at,
              completed_at: b.completed_at,
              photos_classified: photos.classified ?? 0,
              photos_total: photos.total ?? b.total_photos,
              items_done: done,
              items_total: items.total ?? 0,
              items_processing: processing,
              items_approved: items.approved ?? 0,
              items_rejected: items.rejected_final ?? 0,
              items_to_review: (items.qc_passed ?? 0) + (items.pending_review ?? 0),
            }
          } catch {
            return {
              id: b.id, client_id: b.client_id,
              client_name: clientMap[b.client_id] ?? 'Unknown',
              batch_label: b.batch_label,
              status: b.status, total_photos: b.total_photos,
              estimated_pairs: b.estimated_pairs, created_at: b.created_at,
              completed_at: b.completed_at,
              photos_classified: 0, photos_total: b.total_photos,
              items_done: 0, items_total: 0, items_processing: 0,
              items_approved: 0, items_rejected: 0, items_to_review: 0,
            }
          }
        })
      )

      if (mounted) {
        setBatches(enriched)
        setLoading(false)
        if (enriched.some(b => ['uploading', 'verifying_order', 'processing'].includes(b.status))) onRefreshItemsRef.current()
      }
    }

    fetchBatches()
    const iv = setInterval(fetchBatches, 5000)
    return () => { mounted = false; clearInterval(iv) }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 mx-auto border-2 border-[#E8E4DF] border-t-[#1A1A1A] rounded-full animate-spin mb-3" />
          <p className="text-[11px] tracking-[0.15em] uppercase text-[#888]">Checking active batches...</p>
        </div>
      </div>
    )
  }

  if (batches.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Check className="h-8 w-8 mx-auto text-emerald-400 mb-3" />
          <p className="text-sm text-[#888]">No active batches</p>
          <p className="text-xs text-[#aaa] mt-1">Upload photos to start processing</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 md:px-6 space-y-4">
      {batches.map(batch => {
        const isUploading = batch.status === 'uploading'
        const isClassifying = batch.status === 'verifying_order'
        const isProcessing = batch.status === 'processing'
        const isComplete = batch.status === 'complete' || batch.status === 'partial'

        // Display name: "Skirts — Margaux Ellery" or just "Margaux Ellery"
        const displayName = batch.batch_label
          ? `${batch.batch_label} — ${batch.client_name}`
          : batch.client_name

        // Review-completion tracking: once processing is done, the batch isn't truly
        // finished until the stylist has approved or rejected every item.
        const reviewTotal = batch.items_total || batch.estimated_pairs || Math.ceil(batch.total_photos / 2)
        const reviewed = batch.items_approved + batch.items_rejected
        const fullyReviewed = isComplete && reviewTotal > 0 && batch.items_to_review === 0

        // Calculate overall progress percentage
        let pct = 0
        let phase = ''
        let detail = ''
        let timeEst = ''

        if (isComplete) {
          // After processing, the bar tracks REVIEW progress (approved+rejected / total).
          pct = reviewTotal > 0 ? Math.round((reviewed / reviewTotal) * 100) : 100
          if (fullyReviewed) {
            phase = 'Complete — all reviewed'
            detail = `All ${reviewTotal} items reviewed · ${batch.items_approved} approved, ${batch.items_rejected} sent back`
          } else {
            phase = 'Ready for review'
            detail = `${reviewed} of ${reviewTotal} reviewed · ${batch.items_to_review} to go · ${batch.items_approved} approved, ${batch.items_rejected} sent back`
          }
        } else if (isUploading) {
          pct = Math.max(5, Math.round((batch.total_photos / Math.max(batch.total_photos, 1)) * 30))
          phase = 'Uploading photos'
          detail = `${batch.total_photos} photos uploaded so far — stay on this page until upload finishes`
          timeEst = ''
        } else if (isClassifying) {
          pct = batch.photos_total > 0 ? Math.round((batch.photos_classified / batch.photos_total) * 40) : 5
          phase = 'Creating product photos'
          detail = `Reading your ${batch.photos_total} photos — ${batch.photos_classified} sorted so far`
          const remaining = batch.photos_total - batch.photos_classified
          const secLeft = Math.round(remaining * 1.5)
          timeEst = secLeft > 60 ? `~${Math.ceil(secLeft / 60)}min left` : `~${secLeft}s left`
        } else if (isProcessing) {
          const total = batch.items_total || batch.estimated_pairs || Math.ceil(batch.total_photos / 2)
          if (total > 0 && batch.items_done > 0) {
            pct = Math.round(40 + (batch.items_done / total) * 60)
          } else if (total > 0) {
            pct = 45
          }
          phase = 'Creating product photos'
          const remaining = total - batch.items_done
          detail = batch.items_done > 0
            ? `${batch.items_done} of ${total} product photos ready, ${batch.items_processing} still being made`
            : `${total} items in line — making clean product photos for each`
          const secLeft = remaining * 7
          timeEst = secLeft > 60 ? `~${Math.ceil(secLeft / 60)}min left` : secLeft > 0 ? `~${secLeft}s left` : ''
        }

        // Age / completion time
        const ageMin = Math.round((Date.now() - new Date(batch.created_at).getTime()) / 60000)
        const ageStr = ageMin < 1 ? 'just started' : ageMin < 60 ? `${ageMin}m ago` : `${Math.floor(ageMin / 60)}h ${ageMin % 60}m ago`
        const completedStr = batch.completed_at
          ? `Finished ${Math.round((Date.now() - new Date(batch.completed_at).getTime()) / 60000)}m ago`
          : `Started ${ageStr}`

        return (
          <div key={batch.id} className={`bg-white rounded-sm border overflow-hidden ${
            fullyReviewed ? 'border-emerald-200 bg-emerald-50/20' : isComplete ? 'border-[#E8D5C4] bg-[#FBF7F2]' : 'border-[#E8E4DF]'
          }`}>
            {/* Header row */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#F0EDE9]">
              <div className="flex items-center gap-3">
                {fullyReviewed ? (
                  <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full flex items-center justify-center">
                    <Check className="h-1.5 w-1.5 text-white" />
                  </span>
                ) : isComplete ? (
                  <span className="w-2.5 h-2.5 bg-[#C89B7B] rounded-full" />
                ) : (
                  <span className="w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse" />
                )}
                <span className="text-sm font-medium text-[#1A1A1A]">{displayName}</span>
                <span className="text-[10px] tracking-[0.1em] uppercase text-[#aaa]">
                  {batch.total_photos} photos · {completedStr}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {timeEst && (
                  <span className="text-[10px] tracking-[0.15em] uppercase text-emerald-600 font-medium">
                    {timeEst}
                  </span>
                )}
                {fullyReviewed && (
                  <span className="text-[10px] tracking-[0.15em] uppercase text-emerald-600 font-medium">
                    Done ✓
                  </span>
                )}
                {isComplete && !fullyReviewed && (
                  <span className="text-[10px] tracking-[0.15em] uppercase text-[#9C6F4A] font-medium">
                    {batch.items_to_review} to review
                  </span>
                )}
                {!isComplete && (
                  <button
                    onClick={async () => {
                      if (!confirm(`Cancel "${displayName}"? Items already processed will stay, but remaining items will stop.`)) return
                      // Use batch-status endpoint to cancel — it has service role access
                      await fetch(`${SUPABASE_URL}/functions/v1/intake-batch-status`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ batch_id: batch.id, action: 'cancel' }),
                      })
                    }}
                    className="px-2.5 py-1 text-[9px] tracking-[0.15em] uppercase text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>

            {/* Progress */}
            <div className="px-5 py-4">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-[11px] tracking-[0.1em] uppercase font-medium ${fullyReviewed ? 'text-emerald-600' : isComplete ? 'text-[#9C6F4A]' : 'text-[#888]'}`}>{phase}</span>
                <span className="text-[11px] text-[#aaa]">{pct}%</span>
              </div>
              <div className="w-full bg-[#F0EDE9] rounded-full h-2 mb-2">
                <div
                  className={`h-2 rounded-full transition-all duration-1000 ease-out ${fullyReviewed ? 'bg-emerald-500' : isComplete ? 'bg-[#C89B7B]' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
              </div>
              <p className="text-[11px] text-[#888]">{detail}</p>
            </div>

            {/* Stylist-facing stepper — no engineering jargon. The active step is always
                the one needing attention: 'Ready to review' (blush) means it's the
                stylist's turn; only 'All reviewed' green means the batch is truly done. */}
            <div className="flex items-center gap-0 px-5 pb-4">
              {(() => {
                const steps = [
                  // done = finished, active = current, review = stylist-action styling
                  { label: 'Uploaded', done: !isUploading, active: isUploading },
                  { label: 'Creating photos', done: isComplete, active: !isUploading && !isComplete },
                  { label: 'Ready to review', done: fullyReviewed, active: isComplete && !fullyReviewed, review: true },
                  { label: 'All reviewed', done: fullyReviewed, active: false },
                ]
                return steps.map((step, i) => (
                  <div key={i} className="flex items-center">
                    {i > 0 && <div className={`w-7 h-px ${steps[i - 1].done ? 'bg-emerald-300' : 'bg-[#E8E4DF]'}`} />}
                    <div className="flex flex-col items-center gap-1">
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center transition-colors
                        ${step.done ? 'bg-emerald-500'
                          : step.active && step.review ? 'bg-[#C89B7B] animate-pulse ring-2 ring-[#E8D5C4]'
                          : step.active ? 'bg-emerald-400 animate-pulse'
                          : 'bg-[#E8E4DF]'}
                      `}>
                        {step.done && <Check className="h-2.5 w-2.5 text-white" />}
                      </div>
                      <span className={`text-[8px] tracking-[0.1em] uppercase text-center leading-tight ${
                        step.done ? 'text-emerald-600'
                          : step.active && step.review ? 'text-[#9C6F4A] font-semibold'
                          : step.active ? 'text-[#1A1A1A] font-medium'
                          : 'text-[#ccc]'
                      }`}>{step.label}</span>
                    </div>
                  </div>
                ))
              })()}
            </div>
          </div>
        )
      })}

      <p className="text-[10px] text-[#aaa] text-center italic pt-2">
        You can close this panel — photos keep processing in the background. When a batch says <strong>Ready to review</strong>, open the tabs above to approve or reject each item; it's <strong>done</strong> once every item is reviewed.
      </p>
    </div>
  )
}

function UploadPanel({ onComplete }: { onComplete: () => void; onRefreshItems: () => void }) {
  const { activeClient } = useClientStore()
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])
  const [selectedClientId, setSelectedClientId] = useState(activeClient?.id ?? '')
  const [batchLabel, setBatchLabel] = useState('')
  const [category, setCategory] = useState('clothing')
  const isAccessory = ['handbag', 'shoes', 'jewelry', 'belts'].includes(category)
  const [files, setFiles] = useState<File[]>([])
  const [stage, setStage] = useState<'select' | 'uploading' | 'processing' | 'complete' | 'error'>('select')
  const [progress, setProgress] = useState('')
  const [progressPct, setProgressPct] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  // Google Drive source (mutually exclusive with local `files`)
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([])
  const [driveToken, setDriveToken] = useState<string | null>(null)
  const [driveFolder, setDriveFolder] = useState<PickedFolder | null>(null)
  const [driveBusy, setDriveBusy] = useState(false)
  const [driveTesting, setDriveTesting] = useState(false)

  const [clientSearch, setClientSearch] = useState('')

  // Load full client list (no limit)
  useEffect(() => {
    supabase
      .from('gp_clients')
      .select('id, name')
      .order('name')
      .then(({ data }) => {
        setClients(data ?? [])
        if (!selectedClientId && activeClient?.id) {
          setSelectedClientId(activeClient.id)
        }
      })
  }, [])

  const handleFiles = useCallback((newFiles: File[]) => {
    const valid = newFiles.filter(f =>
      (f.type.startsWith('image/') || f.name.toLowerCase().endsWith('.heic')) &&
      f.size <= 25 * 1024 * 1024
    )
    // Sort by filename to preserve camera roll order (IMG_0001, IMG_0002...)
    valid.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    setFiles(prev => [...prev, ...valid].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })))
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    handleFiles(Array.from(e.dataTransfer.files))
  }, [handleFiles])

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx))
  }

  const clearDrive = () => {
    setDriveFiles([])
    setDriveToken(null)
    setDriveFolder(null)
  }

  const handlePickDriveFolder = useCallback(async () => {
    setDriveBusy(true)
    try {
      const picked = await signInAndPickPhotos()
      if (!picked) return // cancelled
      if (picked.files.length === 0) {
        alert('No photos found in your selection.')
        return
      }
      // Drive source replaces any locally-staged files (mutually exclusive)
      setFiles([])
      setDriveToken(picked.accessToken)
      setDriveFolder({ id: '', name: picked.sourceName })
      setDriveFiles(picked.files)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not connect to Google Drive'
      alert(
        `Google Drive: ${msg}\n\n` +
        `Page: ${window.location.origin}\n` +
        `If this keeps happening, click "Test connection" below — it pinpoints which step is failing.`,
      )
    } finally {
      setDriveBusy(false)
    }
  }, [])

  // Self-service connection test: walks the same OAuth → Drive path and reports
  // exactly which step fails plus this page's origin, so support/Karl can fix the
  // right Google allowlist instead of guessing from an opaque "There was an error".
  const handleTestDrive = useCallback(async () => {
    setDriveTesting(true)
    try {
      const diag = await runDriveDiagnostics()
      const lines = diag.steps.map(s => `${s.ok ? '✅' : '❌'} ${s.name}${s.detail ? `\n     ${s.detail}` : ''}`)
      alert(
        `${diag.ok ? 'Google Drive connection looks good ✅' : 'Google Drive connection has a problem ❌'}\n` +
        `Page origin: ${diag.origin}\n\n` +
        lines.join('\n'),
      )
    } catch (err) {
      alert(`Test failed: ${err instanceof Error ? err.message : String(err)}\n\nPage: ${window.location.origin}`)
    } finally {
      setDriveTesting(false)
    }
  }, [])

  // Realistic time estimate. The pipeline is cron-driven for reliability (fire-and-forget
  // triggers die in the Edge runtime), which adds a fixed floor the naive estimate ignored.
  // As of the gpt-image-2 upgrade (newer, higher-fidelity model — but ~2× slower, ~110-130s
  // vs ~55s), the cron backstops wait 180s for an in-flight gen, so the floor is now ~7 min:
  // item waits for the cron claim (~180s), generates (~110-130s), waits for the cron QC
  // re-fire (~180s) + QC (~20s). Per-item term is conservative — absorbs QC + any high re-gen.
  // We deliberately over-estimate: far better to under-promise than to have a stylist think
  // it's stuck. (Revisit if we add an in-flight marker to shorten the cron backstop windows.)
  const estimateTime = (photoCount: number) => {
    const items = (isAccessory ? photoCount : Math.ceil(photoCount / 2))
    const uploadSec = Math.ceil(photoCount * 2) // ~2s per photo upload (chunked by 2)
    const floorSec = 420                        // gpt-image-2 (~2× slower) + 180s cron claim/QC backstops
    const perItemSec = 22                       // conservative end-to-end per item on the slower model
    const totalMin = Math.ceil((uploadSec + floorSec + items * perItemSec) / 60)
    if (totalMin <= 5) return '~5 min'
    if (totalMin <= 60) return `~${totalMin} min`
    return `~${Math.floor(totalMin / 60)}h ${totalMin % 60}m`
  }

  const runPipeline = async () => {
    if (!selectedClientId) { alert('Select a client'); return }

    // Source is either locally-staged files or a picked Google Drive folder (mutually exclusive).
    const fromDrive = driveFiles.length > 0
    const photoCount = fromDrive ? driveFiles.length : files.length
    if (photoCount === 0) { alert('Add photos'); return }

    // Fetch one chunk's worth of File objects. For Drive, download just-in-time so we
    // never hold more than CHUNK photos in memory — keeps large batches (500+) safe.
    // The ~1h Drive token can expire mid-batch; on a 401 we silently refresh it once
    // and retry the chunk so long uploads don't die partway through.
    let activeToken = driveToken!
    const getChunkFiles = async (start: number, count: number): Promise<File[]> => {
      let chunk: File[]
      if (!fromDrive) {
        chunk = files.slice(start, start + count)
      } else {
        const slice = driveFiles.slice(start, start + count)
        try {
          chunk = await Promise.all(slice.map(df => downloadDriveFile(df, activeToken)))
        } catch (e) {
          if (e instanceof Error && /\(401\)/.test(e.message)) {
            activeToken = await refreshAccessToken()
            setDriveToken(activeToken)
            chunk = await Promise.all(slice.map(df => downloadDriveFile(df, activeToken)))
          } else {
            throw e
          }
        }
      }
      // Convert any HEIC → JPEG before upload (Claude/OpenAI reject HEIC). Covers both
      // the local picker and the Drive import, since both flow through here. See lib/heic.
      return ensureJpegFiles(chunk)
    }

    const itemCount = (isAccessory ? photoCount : Math.ceil(photoCount / 2))
    const timeEst = estimateTime(photoCount)

    setStage('uploading')
    setProgress(`Uploading ${photoCount} photos (${itemCount} items)...`)
    setProgressPct(5)

    try {
      // Upload in chunks of 2.
      let batchId: string | null = null
      const CHUNK = 2
      let uploadedCount = 0
      const failedPhotos: string[] = []

      for (let i = 0; i < photoCount; i += CHUNK) {
        const chunk = await getChunkFiles(i, CHUNK)
        const formData = new FormData()
        if (batchId) formData.append('batch_id', batchId)
        formData.append('client_id', selectedClientId)
        if (batchLabel.trim() && !batchId) formData.append('batch_label', batchLabel.trim())
        if (!batchId) formData.append('batch_category', category)
        chunk.forEach(f => formData.append('photos', f))

        // Retry each chunk up to 3x. Once we have a batchId, retries reuse it.
        let result: { batch_id: string; uploaded?: number; errors?: string[] } | null = null
        let lastErr = ''
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt))
          try {
            const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-upload-photos`, {
              method: 'POST',
              body: formData,
            })
            const body = await resp.json().catch(() => ({}))
            if (resp.ok) { result = body; break }
            lastErr = body.error || `Upload failed (${resp.status})`
          } catch (e) {
            lastErr = e instanceof Error ? e.message : 'network error'
          }
        }

        if (!result) {
          // This chunk's photos couldn't be stored (a HEIC that wouldn't convert, or one over
          // the size limit). DO NOT abort the whole batch — skip them, record them, and keep
          // uploading the rest. The stylist only re-handles the few that failed.
          console.warn(`chunk at photo ${i + 1} skipped after retries: ${lastErr}`)
          chunk.forEach(f => failedPhotos.push(f.name))
          continue
        }

        batchId = result.batch_id
        if (result.errors?.length) failedPhotos.push(...result.errors)
        uploadedCount += result.uploaded ?? chunk.length
        const pct = Math.round((uploadedCount / photoCount) * 40)
        setProgressPct(pct)
        setProgress(`Uploaded ${uploadedCount} of ${photoCount} photos...`)
      }

      if (!batchId || uploadedCount === 0) {
        throw new Error(
          `No photos could be uploaded.${failedPhotos.length ? ' ' + failedPhotos.slice(0, 4).join('; ') : ''}`,
        )
      }

      // Finalize — triggers classify + process
      setProgress(`Classifying ${photoCount} photos...`)
      setProgressPct(45)

      const finalizeResp = await fetch(`${SUPABASE_URL}/functions/v1/intake-finalize-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: batchId }),
      })

      if (!finalizeResp.ok) {
        const err = await finalizeResp.json().catch(() => ({ error: 'Finalize failed' }))
        throw new Error(err.error || 'Finalize failed')
      }

      // Save batch to localStorage for the nav badge indicator
      localStorage.setItem('atelier_active_batch', JSON.stringify({
        batchId, clientId: selectedClientId, photoCount,
      }))

      // Show brief success then reset form so stylist can upload another batch immediately
      setStage('complete')
      const label = batchLabel.trim() ? `"${batchLabel.trim()}"` : `${itemCount} items`
      const skipped = failedPhotos.length
      const skipNote = skipped
        ? ` ⚠️ ${skipped} photo${skipped > 1 ? 's' : ''} couldn't be processed and ${skipped > 1 ? 'were' : 'was'} skipped — re-upload ${skipped > 1 ? 'those' : 'it'} (often a very large or unconvertible HEIC).`
        : ''
      setProgress(`${label} submitted!${skipNote} Processing runs in the background — about ${timeEst} for everything to land in the inbox (large batches take longer). Watch the In Progress tab; you can close this and come back.`)
      setProgressPct(100)

      // Reset after 2s so they can upload again
      setTimeout(() => {
        setStage('select')
        setFiles([])
        clearDrive()
        setBatchLabel('')
        setProgress('')
        setProgressPct(0)
        onComplete()
      }, 5000)
    } catch (err) {
      setStage('error')
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      setProgress(`Error: ${msg}. Screenshot this and send to Karl. [Client: ${selectedClientId?.slice(0,8)}, Photos: ${photoCount}, Time: ${new Date().toISOString()}]`)
    }
  }

  return (
    <div className="bg-white border-b border-[#E8E4DF] px-4 md:px-6 py-4 shrink-0 max-h-[70vh] overflow-y-auto">
      {stage === 'select' && (
        <div className="max-w-3xl mx-auto">
          {/* Client picker + batch name — stack on mobile */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div className="relative">
              <label className="block text-[9px] tracking-[0.15em] uppercase text-[#888] mb-1">
                Client {selectedClientId && clients.find(c => c.id === selectedClientId) && (
                  <span className="text-[#1A1A1A] font-medium ml-1">
                    — {clients.find(c => c.id === selectedClientId)?.name}
                  </span>
                )}
              </label>
              <input
                type="text"
                value={clientSearch}
                onChange={e => {
                  const val = e.target.value
                  setClientSearch(val)
                  const selectedName = clients.find(c => c.id === selectedClientId)?.name
                  if (selectedName && val.toLowerCase() !== selectedName.toLowerCase()) {
                    setSelectedClientId('')
                  }
                }}
                placeholder={`Search ${clients.length} clients...`}
                className="w-full border border-[#E8E4DF] rounded-sm px-3 py-2.5 text-sm text-[#1A1A1A] bg-white"
              />
              {clientSearch.length >= 2 && !selectedClientId && (
                <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-[#E8E4DF] rounded-sm shadow-lg max-h-48 overflow-y-auto">
                  {clients
                    .filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase()))
                    .slice(0, 20)
                    .map(c => (
                      <button
                        key={c.id}
                        onClick={() => { setSelectedClientId(c.id); setClientSearch(c.name) }}
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-[#F8F7F5] transition-colors"
                      >
                        {c.name}
                      </button>
                    ))}
                  {clients.filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase())).length === 0 && (
                    <p className="px-3 py-2 text-sm text-[#aaa]">No clients found</p>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="block text-[9px] tracking-[0.15em] uppercase text-[#888] mb-1">
                Category
              </label>
              <div className="flex flex-wrap gap-1.5">
                {([['clothing', 'Clothing'], ['handbag', 'Handbag'], ['shoes', 'Shoes'], ['jewelry', 'Jewelry'], ['belts', 'Belts']] as const).map(([val, lbl]) => (
                  <button key={val} type="button" onClick={() => setCategory(val)}
                    className={`px-3 py-1.5 text-[10px] tracking-[0.1em] uppercase rounded-sm border ${category === val ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' : 'bg-white text-[#888] border-[#E8E4DF] hover:border-[#ccc]'}`}>
                    {lbl}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[#aaa] mt-1.5">
                {isAccessory ? 'One photo per item — no tag needed.' : 'Two photos per item: the garment, then its tag.'}
              </p>
            </div>
            <div>
              <label className="block text-[9px] tracking-[0.15em] uppercase text-[#888] mb-1">
                Batch Name <span className="text-[#bbb]">(optional)</span>
              </label>
              <input
                type="text"
                value={batchLabel}
                onChange={e => setBatchLabel(e.target.value)}
                placeholder="e.g. Skirts, Fall Coats"
                className="w-full border border-[#E8E4DF] rounded-sm px-3 py-2.5 text-sm text-[#1A1A1A] bg-white"
              />
            </div>
          </div>

          {/* Add buttons — full width on mobile, inline on desktop */}
          <div className="grid grid-cols-2 md:flex gap-2 mb-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,.heic"
              multiple
              onChange={e => { handleFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
              className="hidden"
            />
            <input
              ref={el => {
                (folderInputRef as React.MutableRefObject<HTMLInputElement | null>).current = el
                if (el) {
                  el.setAttribute('webkitdirectory', '')
                  el.setAttribute('directory', '')
                }
              }}
              type="file"
              multiple
              onChange={e => { handleFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 border border-[#E8E4DF] text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#F8F7F5] transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
              Add Photos
            </button>
            {isGoogleDriveConfigured() && (
              <button
                onClick={handlePickDriveFolder}
                disabled={driveBusy}
                className="flex items-center justify-center gap-1.5 px-4 py-2.5 border border-[#E8E4DF] text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#F8F7F5] disabled:opacity-50 transition-colors"
              >
                {driveBusy
                  ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  : <HardDrive className="h-3.5 w-3.5" />}
                Google Drive
              </button>
            )}
            {isGoogleDriveConfigured() && (
              <button
                onClick={handleTestDrive}
                disabled={driveTesting}
                title="Check that Google Drive import is working from this device"
                className="flex items-center justify-center gap-1.5 px-2 py-2.5 text-[10px] tracking-[0.1em] uppercase text-[#999] hover:text-[#1A1A1A] disabled:opacity-50 transition-colors"
              >
                {driveTesting ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
                Test connection
              </button>
            )}
            <button
              onClick={() => folderInputRef.current?.click()}
              className="hidden md:flex items-center justify-center gap-1.5 px-4 py-2.5 border border-[#E8E4DF] text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#F8F7F5] transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
              Add Folder
            </button>
          </div>

          {/* Instructions for stylists — collapsible on mobile */}
          <details className="bg-[#F8F7F5] rounded-sm mb-4 text-[11px] text-[#666] group">
            <summary className="p-4 font-medium text-[#1A1A1A] text-[13px] cursor-pointer list-none flex items-center justify-between">
              Closet Digitization
              <span className="text-[10px] text-[#aaa] group-open:hidden">Tap for instructions</span>
            </summary>
            <div className="px-4 pb-4 space-y-3">

            <div>
              <p className="font-medium text-[#1A1A1A] text-[11px] mb-1">📷 Photographing</p>
              <ol className="list-decimal list-inside space-y-0.5 text-[11px]">
                <li><strong>1 photo of the item</strong> — lay flat on a clean surface, full garment visible, good lighting</li>
                <li><strong>1 photo of the brand/care tag</strong> — so AI can read the brand, size, and material</li>
                <li>Repeat for each piece: <strong>item photo → tag photo → item photo → tag photo</strong></li>
              </ol>
              <p className="text-[10px] text-[#9C6F4A] mt-1 font-medium">⚠️ Order matters — photos are paired in the exact order you upload them (item, then its tag). Keep them in order, or items will pair with the wrong tag.</p>
              <p className="text-[10px] text-[#888] mt-1">No tag? That's fine — AI will still identify the brand when possible.</p>
            </div>

            <div>
              <p className="font-medium text-[#1A1A1A] text-[11px] mb-1">💡 Tips for best results</p>
              <ul className="space-y-0.5 text-[10px] text-[#888]">
                <li>• Natural light or bright room — avoid harsh shadows</li>
                <li>• Full garment visible — don't crop sleeves, hems, or straps</li>
                <li>• Lay flat or hang — avoid bunching or folding</li>
                <li>• One item per photo — don't photograph multiple items together</li>
              </ul>
            </div>

            <div>
              <p className="font-medium text-[#1A1A1A] text-[11px] mb-1">⬆️ Uploading</p>
              <ol className="list-decimal list-inside space-y-0.5 text-[11px]">
                <li>Select the client above</li>
                <li>Add all photos (item + tag pairs)</li>
                <li>Click <strong>Digitize</strong> — AI processes everything automatically (~35 sec per item)</li>
                <li>Items appear in the tabs below as they finish</li>
              </ol>
            </div>

            <div>
              <p className="font-medium text-[#1A1A1A] text-[11px] mb-1">✅ Reviewing</p>
              <ul className="space-y-0.5 text-[10px]">
                <li><strong className="text-emerald-700">QC Passed</strong> — AI verified these look good. Hit <strong>Approve All</strong> to add to the client's collection.</li>
                <li><strong className="text-amber-700">Needs Review</strong> — AI flagged an issue. Check the image, use <strong>Restyle</strong> to regenerate, or <strong>Reject</strong> if unusable.</li>
                <li><strong className="text-[#1A1A1A]">Approved</strong> — Done! Click <strong>Download for GoodPix</strong> to get the upload spreadsheet.</li>
              </ul>
            </div>

            <div className="border-t border-[#E8E4DF] pt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-[#888]">
              <span>📷 Max per batch: <strong className="text-[#1A1A1A]">500 photos</strong> (250 items)</span>
              <span>⏱ Processing: <strong className="text-[#1A1A1A]">~35 sec per item</strong></span>
              <span>📄 Formats: <strong className="text-[#1A1A1A]">JPEG, PNG, HEIC</strong></span>
              <span>📏 Max file size: <strong className="text-[#1A1A1A]">6 MB per photo</strong></span>
            </div>

            <p className="text-[9px] text-[#aaa] italic">You can close this panel and come back — processing continues in the background. Click <strong>Digitize</strong> in the nav to check progress.</p>
            </div>
          </details>

          {/* Drop zone / file list / Google Drive selection */}
          {driveFiles.length > 0 ? (
            <div className="border border-[#E8E4DF] rounded-sm p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <HardDrive className="h-4 w-4 text-[#888] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-[#1A1A1A] font-medium truncate">{driveFolder?.name}</p>
                    <p className="text-[10px] text-[#888]">
                      {driveFiles.length} photos · {(isAccessory ? driveFiles.length : Math.ceil(driveFiles.length / 2))} items from Google Drive
                      {driveFiles.length % 2 !== 0 && <span className="text-amber-600 ml-1">(odd — last item has no tag)</span>}
                    </p>
                  </div>
                </div>
                <button
                  onClick={clearDrive}
                  className="text-[10px] tracking-[0.15em] uppercase text-[#888] hover:text-[#1A1A1A] underline shrink-0"
                >
                  Clear
                </button>
              </div>
              <p className="text-[10px] text-[#aaa] mb-3">
                Photos download from Drive as they upload — keep this tab open until it finishes.
              </p>
              <button
                onClick={runPipeline}
                disabled={!selectedClientId}
                className="w-full md:w-auto flex items-center justify-center gap-2 px-6 py-3 md:py-2.5 bg-[#1A1A1A] text-white text-[11px] tracking-[0.2em] uppercase rounded-sm hover:bg-[#333] disabled:opacity-40 transition-colors"
              >
                <Upload className="h-3.5 w-3.5" />
                Digitize {batchLabel.trim() ? `"${batchLabel.trim()}"` : `${(isAccessory ? driveFiles.length : Math.ceil(driveFiles.length / 2))} Items`} · {estimateTime(driveFiles.length)}
              </button>
            </div>
          ) : files.length === 0 ? (
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              className="border-2 border-dashed border-[#E8E4DF] rounded-sm py-12 md:py-8 text-center hover:border-[#888] transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <Camera className="h-8 w-8 md:h-6 md:w-6 mx-auto text-[#ccc] mb-2" />
              <p className="text-base md:text-sm text-[#888]">Tap to add photos</p>
              <p className="text-[10px] text-[#aaa] mt-1">Item photo, tag photo — in pairs</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 md:flex md:flex-wrap gap-1.5 md:gap-2 mb-3">
                {files.map((f, i) => (
                  <div key={i} className="relative group">
                    <div className={`aspect-[4/5] rounded-sm overflow-hidden border ${i % 2 === 0 ? 'border-[#1A1A1A]' : 'border-blush'}`}>
                      <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
                    </div>
                    <span className={`absolute top-0.5 left-0.5 text-[6px] md:text-[7px] tracking-[0.1em] uppercase px-0.5 md:px-1 rounded-sm ${
                      i % 2 === 0 ? 'bg-[#1A1A1A] text-white' : 'bg-blush text-[#1A1A1A]'
                    }`}>
                      {i % 2 === 0 ? 'item' : 'tag'}
                    </span>
                    <button
                      onClick={() => removeFile(i)}
                      className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[8px] flex items-center justify-center md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
                <p className="text-[10px] text-[#888] text-center md:text-left">
                  {files.length} photos · {(isAccessory ? files.length : Math.ceil(files.length / 2))} items
                  {files.length % 2 !== 0 && <span className="text-amber-600 ml-1">(odd — last item has no tag)</span>}
                </p>
                <button
                  onClick={runPipeline}
                  disabled={!selectedClientId}
                  className="w-full md:w-auto flex items-center justify-center gap-2 px-6 py-3 md:py-2.5 bg-[#1A1A1A] text-white text-[11px] tracking-[0.2em] uppercase rounded-sm hover:bg-[#333] disabled:opacity-40 transition-colors"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Digitize {batchLabel.trim() ? `"${batchLabel.trim()}"` : `${(isAccessory ? files.length : Math.ceil(files.length / 2))} Items`} · {estimateTime(files.length)}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {(stage === 'uploading' || stage === 'processing') && (
        <div className="max-w-xl mx-auto text-center py-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1 bg-[#E8E4DF] rounded-full h-1.5">
              <div className="bg-[#1A1A1A] h-1.5 rounded-full transition-all duration-700" style={{ width: `${progressPct}%` }} />
            </div>
            <RefreshCw className="h-4 w-4 text-[#888] animate-spin" />
          </div>
          <p className="text-sm text-[#888]">{progress}</p>
        </div>
      )}

      {stage === 'complete' && (
        <div className="max-w-xl mx-auto text-center py-4">
          <div className="flex items-center justify-center gap-2">
            <Check className="h-5 w-5 text-emerald-600" />
            <p className="text-sm text-emerald-700">{progress}</p>
          </div>
        </div>
      )}

      {stage === 'error' && (
        <div className="max-w-xl mx-auto text-center py-4">
          <p className="text-sm text-red-600 mb-2">{progress}</p>
          <button
            onClick={() => { setStage('select'); setFiles([]); clearDrive() }}
            className="text-[10px] tracking-[0.15em] uppercase text-[#1A1A1A] underline"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  )
}

function MetadataField({
  label, value, editing, onChange, options,
}: {
  label: string
  value: string
  editing: boolean
  onChange: (v: string) => void
  options?: string[]
}) {
  return (
    <div>
      <label className="block text-[9px] tracking-[0.15em] uppercase text-[#888] mb-0.5">{label}</label>
      {editing ? (
        options ? (
          <select
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full border border-[#E8E4DF] rounded-sm px-2 py-1.5 text-sm text-[#1A1A1A] bg-white"
          >
            <option value="">—</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full border border-[#E8E4DF] rounded-sm px-2 py-1.5 text-sm text-[#1A1A1A]"
          />
        )
      ) : (
        <p className="text-sm text-[#1A1A1A] font-medium">{value || '—'}</p>
      )}
    </div>
  )
}
