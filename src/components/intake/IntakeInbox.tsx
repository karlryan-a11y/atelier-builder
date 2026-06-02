import { useState, useEffect, useRef, useCallback } from 'react'
import { Inbox, Check, X, ChevronLeft, Edit3, RefreshCw, Upload, Camera } from 'lucide-react'
import { useIntakeItems, type IntakeItem } from '@/hooks/useIntakeItems'
import { ClickableSignedImage, LightboxProvider } from './IntakeItemCard'
import { supabase } from '@/lib/supabase'
import { useClientStore } from '@/stores/clientStore'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

const CATEGORIES = [
  'Dresses', 'Tops', 'Bottoms', 'Outerwear', 'Knitwear',
  'Shoes', 'Bags', 'Accessories', 'Jewelry', 'Swimwear',
  'Activewear', 'Intimates',
]

interface IntakeInboxProps {
  onClose: () => void
}

export function IntakeInbox({ onClose }: IntakeInboxProps) {
  const [filter, setFilter] = useState<'qc_passed' | 'pending_review' | 'approved' | 'rejected_final' | 'all'>('qc_passed')
  const [bulkApproving, setBulkApproving] = useState(false)
  const [bulkProgress, setBulkProgress] = useState('')
  const [showBulkConfirm, setShowBulkConfirm] = useState(false)
  const { activeClient } = useClientStore()
  const [selectedClientId, setSelectedClientId] = useState<string | null>(activeClient?.id ?? null)
  const { items, loading, error, refresh, counts } = useIntakeItems(filter, selectedClientId)
  const [showUpload, setShowUpload] = useState(false)
  const [clientOptions, setClientOptions] = useState<Array<{ id: string; name: string }>>([])

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
    { key: 'qc_passed' as const, label: 'QC Passed', count: counts.qc_passed },
    { key: 'pending_review' as const, label: 'Needs Review', count: counts.pending },
    { key: 'approved' as const, label: 'Approved', count: counts.approved },
    { key: 'rejected_final' as const, label: 'Rejected', count: counts.rejected },
  ]

  const handleBulkApprove = async () => {
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

  return (
    <LightboxProvider>
    <div className="fixed inset-0 bg-[#F8F7F5] z-50 flex flex-col">
      {/* Header */}
      <div className="h-14 bg-[#1A1A1A] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white transition-colors flex items-center gap-1"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="text-[11px] tracking-[0.15em] uppercase">Builder</span>
          </button>
          <div className="w-px h-5 bg-white/10" />
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-blush" />
            <span className="text-[11px] tracking-[0.15em] uppercase text-white">Intake Inbox</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {counts.pending > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] tracking-[0.2em] uppercase text-white/40">
                {counts.pending} pending
              </span>
              <div className="w-2 h-2 rounded-full bg-blush animate-pulse" />
            </div>
          )}
          <button
            onClick={() => setShowUpload(!showUpload)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-[0.15em] uppercase rounded transition-colors ${
              showUpload ? 'bg-blush text-[#1A1A1A]' : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            <Camera className="h-3.5 w-3.5" />
            Upload
          </button>
        </div>
      </div>

      {/* Upload panel — collapsible */}
      {showUpload && (
        <UploadPanel
          onRefreshItems={refresh}
          onComplete={() => {
            setShowUpload(false)
            setFilter('qc_passed')
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
            {tab.label}
            {tab.count > 0 && (
              <span className={`
                ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px]
                rounded-full text-[9px] font-medium px-1
                ${tab.key === 'pending_review' ? 'bg-blush text-[#1A1A1A]' : 'bg-[#E8E4DF] text-[#888]'}
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

      {/* Content — scrollable list of inline cards */}
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
                      className="flex-1 px-4 py-2.5 bg-emerald-600 text-white text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-emerald-700"
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

            {items.map(item => (
              <InlineItemCard key={item.id} item={item} onAction={refresh} />
            ))}
          </div>
        )}
      </div>
    </div>
    </LightboxProvider>
  )
}

/**
 * Inline item card — everything visible at once, built for speed.
 * AI photo large on left, original + tag small below it,
 * metadata + actions on the right. One-tap approve.
 */
function InlineItemCard({ item, onAction }: { item: IntakeItem; onAction: () => void }) {
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
  const [rejectionReasons, setRejectionReasons] = useState<Array<{ code: string; label: string }>>([])
  const [selectedReason, setSelectedReason] = useState('')
  const [rejectionNote, setRejectionNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [actionResult, setActionResult] = useState<'approved' | 'rejected' | null>(null)

  useEffect(() => {
    if (rejecting && rejectionReasons.length === 0) {
      supabase
        .from('intake_rejection_reasons')
        .select('code, label')
        .eq('active', true)
        .order('display_order')
        .then(({ data }) => setRejectionReasons(data ?? []))
    }
  }, [rejecting])

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

  const handleApprove = async () => {
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
    if (!selectedReason) {
      alert('Select a rejection reason')
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
          rejection_reason_code: selectedReason,
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
            <><X className="h-5 w-5 text-red-500" /><span className="text-sm text-red-600">Rejected</span></>
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
              <div className="aspect-square bg-[#F8F7F5] rounded-sm overflow-hidden border border-[#E8E4DF] relative">
                <ClickableSignedImage
                  r2Key={heroKey}
                  alt={item.extracted_name ?? 'Product photo'}
                  className={`w-full h-full ${currentAiKey ? 'object-contain' : 'object-cover'}`}
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
            {item.garment_photo?.r2_key ? (
              <div>
                <p className="text-[9px] tracking-[0.15em] uppercase text-[#aaa] mb-1">Original</p>
                <div className="aspect-[3/4] bg-[#F8F7F5] rounded-sm overflow-hidden border border-[#E8E4DF]">
                  <ClickableSignedImage r2Key={item.garment_photo.r2_key} alt="Original" className="w-full h-full object-cover" label="Original iPhone Photo" />
                </div>
              </div>
            ) : (
              <div className="aspect-[3/4] bg-[#F8F7F5] rounded-sm border border-dashed border-[#ddd]" />
            )}
            {item.tag_photo?.r2_key ? (
              <div>
                <p className="text-[9px] tracking-[0.15em] uppercase text-[#aaa] mb-1">Tag</p>
                <div className="aspect-[3/4] bg-[#F8F7F5] rounded-sm overflow-hidden border border-[#E8E4DF]">
                  <ClickableSignedImage r2Key={item.tag_photo.r2_key} alt="Tag" className="w-full h-full object-cover" label="Brand/Care Tag" />
                </div>
              </div>
            ) : (
              <div>
                <p className="text-[9px] tracking-[0.15em] uppercase text-[#aaa] mb-1">Tag</p>
                <div className="aspect-[3/4] bg-[#F8F7F5] rounded-sm border border-dashed border-[#ddd] flex items-center justify-center">
                  <span className="text-[9px] text-[#ccc]">No tag</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Metadata + Actions */}
        <div className="flex-1 p-4 md:p-6 flex flex-col">
          {/* Client + Item header */}
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-[10px] tracking-[0.2em] uppercase text-blush">{item.client_name}</p>
              <h3 className="text-lg font-serif text-[#1A1A1A] mt-0.5 leading-tight">
                {editing ? name || 'Untitled Item' : item.extracted_name || 'Untitled Item'}
              </h3>
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

          {/* Rejection panel */}
          {rejecting && (
            <div className="border border-red-100 rounded-sm p-3 bg-red-50/30 mb-3">
              <div className="space-y-2">
                <select
                  value={selectedReason}
                  onChange={e => setSelectedReason(e.target.value)}
                  className="w-full border border-[#E8E4DF] rounded-sm px-3 py-2 text-sm text-[#1A1A1A] bg-white"
                >
                  <option value="">Select reason...</option>
                  {rejectionReasons.map(r => (
                    <option key={r.code} value={r.code}>{r.label}</option>
                  ))}
                </select>
                <textarea
                  value={rejectionNote}
                  onChange={e => setRejectionNote(e.target.value)}
                  placeholder="Note (optional)..."
                  className="w-full border border-[#E8E4DF] rounded-sm px-3 py-2 text-sm resize-none h-14"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleReject}
                    disabled={submitting}
                    className="flex-1 px-3 py-2 bg-red-600 text-white text-[10px] tracking-[0.15em] uppercase rounded-sm hover:bg-red-700 disabled:opacity-50"
                  >
                    {submitting ? 'Rejecting...' : 'Confirm Reject'}
                  </button>
                  <button
                    onClick={() => setRejecting(false)}
                    className="px-3 py-2 border border-[#E8E4DF] text-[10px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#F8F7F5]"
                  >
                    Cancel
                  </button>
                </div>
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
                onClick={() => setShowRestyle(!showRestyle)}
                disabled={restyling}
                className={`flex items-center justify-center gap-1.5 px-4 py-3 border text-[11px] tracking-[0.2em] uppercase rounded-sm transition-colors ${
                  showRestyle
                    ? 'border-[#1A1A1A] text-[#1A1A1A] bg-[#F8F7F5]'
                    : 'border-[#E8E4DF] text-[#888] hover:border-[#888] hover:text-[#1A1A1A]'
                } disabled:opacity-50`}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${restyling ? 'animate-spin' : ''}`} />
                {currentAiKey ? 'Restyle' : 'Generate'}
              </button>
              <button
                onClick={() => setRejecting(true)}
                disabled={submitting || restyling}
                className="flex items-center justify-center gap-1.5 px-4 py-3 border border-[#E8E4DF] text-[#888] text-[11px] tracking-[0.2em] uppercase rounded-sm hover:border-red-200 hover:text-red-600 transition-colors disabled:opacity-50"
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
          {(item.status === 'rejected' || item.status === 'rejected_final') && (
            <div className="flex items-center gap-2 p-3 bg-red-50 rounded-sm">
              <X className="h-4 w-4 text-red-500" />
              <span className="text-sm text-red-600">Rejected</span>
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
function UploadPanel({ onComplete, onRefreshItems }: { onComplete: () => void; onRefreshItems: () => void }) {
  const { activeClient } = useClientStore()
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])
  const [selectedClientId, setSelectedClientId] = useState(activeClient?.id ?? '')
  const [files, setFiles] = useState<File[]>([])
  const [stage, setStage] = useState<'select' | 'uploading' | 'processing' | 'complete' | 'error'>('select')
  const [progress, setProgress] = useState('')
  const [progressPct, setProgressPct] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clean up polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [])

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
    setFiles(prev => [...prev, ...valid])
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    handleFiles(Array.from(e.dataTransfer.files))
  }, [handleFiles])

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx))
  }

  // Time estimates: ~1s per photo upload, ~2s per photo classify, ~2s per item metadata
  const estimateTime = (photoCount: number) => {
    const items = Math.ceil(photoCount / 2)
    const uploadSec = Math.ceil(photoCount * 1.5) // ~1.5s per photo upload (chunked)
    const classifySec = Math.ceil(photoCount * 2) // ~2s per photo for Haiku
    const metadataSec = Math.ceil(items * 3) // ~3s per item for Sonnet
    const totalSec = uploadSec + classifySec + metadataSec
    const totalMin = Math.ceil(totalSec / 60)
    return totalMin <= 1 ? '~1 min' : `~${totalMin} min`
  }

  const runPipeline = async () => {
    if (!selectedClientId) { alert('Select a client'); return }
    if (files.length === 0) { alert('Add photos'); return }

    const itemCount = Math.ceil(files.length / 2)
    const timeEst = estimateTime(files.length)

    setStage('uploading')
    setProgress(`Uploading ${files.length} photos (${itemCount} items)... ${timeEst} total`)
    setProgressPct(5)

    try {
      // Upload in chunks of 2 (Edge Functions have ~6MB body limit)
      let batchId: string | null = null
      const CHUNK = 4
      let uploadedCount = 0

      for (let i = 0; i < files.length; i += CHUNK) {
        const chunk = files.slice(i, i + CHUNK)
        const formData = new FormData()
        if (batchId) formData.append('batch_id', batchId)
        formData.append('client_id', selectedClientId)
        chunk.forEach(f => formData.append('photos', f))

        const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-upload-photos`, {
          method: 'POST',
          body: formData,
        })

        if (!resp.ok) {
          const errBody = await resp.json().catch(() => ({ error: `Upload failed (${resp.status})` }))
          throw new Error(errBody.error || `Upload failed at photo ${i + 1}`)
        }

        const result = await resp.json()
        batchId = result.batch_id
        uploadedCount += chunk.length
        const pct = Math.round((uploadedCount / files.length) * 40)
        setProgressPct(pct)
        setProgress(`Uploaded ${uploadedCount} of ${files.length} photos...`)
      }

      if (!batchId) throw new Error('No batch_id returned')

      // Finalize — triggers classify + process
      setProgress(`Classifying ${files.length} photos...`)
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

      // Poll for completion — items appear one by one as they finish
      setStage('processing')
      setProgress(`Processing ${itemCount} items — they'll appear below as they finish (~35s each)...`)
      setProgressPct(55)

      let polls = 0
      const MAX_POLLS = 240 // 20 min at 5s intervals

      pollIntervalRef.current = setInterval(async () => {
        polls++
        if (polls > MAX_POLLS) {
          clearInterval(pollIntervalRef.current!); pollIntervalRef.current = null
          setStage('complete')
          setProgress('Processing is taking a while — items will appear as they finish.')
          setTimeout(() => onComplete(), 3000)
          return
        }

        try {
          const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-batch-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batch_id: batchId }),
          })

          if (!resp.ok) return
          const batch = await resp.json()

          switch (batch.status) {
            case 'verifying_order':
              setProgressPct(50)
              setProgress(`Classifying photos...`)
              break
            case 'processing': {
              const items = batch.items ?? {}
              const done = (items.qc_passed ?? 0) + (items.pending_review ?? 0)
              const total = batch.estimated_pairs ?? itemCount
              const pct = total > 0 ? Math.round(55 + (done / total) * 40) : 70
              setProgressPct(pct)
              setProgress(done > 0
                ? `${done} of ${total} items ready — ${total - done} still processing...`
                : `Processing ${total} items — they'll appear below as they finish...`)
              if (done > 0) onRefreshItems()
              break
            }
            case 'complete':
              clearInterval(pollIntervalRef.current!); pollIntervalRef.current = null
              setStage('complete')
              setProgressPct(100)
              setProgress(`Done! ${batch.estimated_pairs ?? itemCount} items ready for review.`)
              setTimeout(() => onComplete(), 2000)
              break
            case 'partial':
              clearInterval(pollIntervalRef.current!); pollIntervalRef.current = null
              setStage('complete')
              setProgressPct(100)
              setProgress(`${batch.estimated_pairs ?? itemCount} items processed. Some may need review.`)
              setTimeout(() => onComplete(), 2000)
              break
            case 'failed':
              clearInterval(pollIntervalRef.current!); pollIntervalRef.current = null
              setStage('error')
              setProgress('Processing failed. Photos are saved — contact support.')
              break
            case 'order_broken':
              clearInterval(pollIntervalRef.current!); pollIntervalRef.current = null
              setStage('error')
              setProgress('Photo order issue detected. Ensure photos alternate: garment, tag, garment, tag. Some photos may have been misidentified.')
              break
          }
        } catch { /* retry silently */ }
      }, 5000)
    } catch (err) {
      setStage('error')
      setProgress(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  return (
    <div className="bg-white border-b border-[#E8E4DF] px-4 md:px-6 py-4 shrink-0">
      {stage === 'select' && (
        <div className="max-w-3xl mx-auto">
          {/* Client picker + file count */}
          <div className="flex items-end gap-4 mb-4">
            <div className="flex-1 relative">
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
                className="w-full border border-[#E8E4DF] rounded-sm px-3 py-2 text-sm text-[#1A1A1A] bg-white"
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
                        className="w-full text-left px-3 py-2 text-sm hover:bg-[#F8F7F5] transition-colors"
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
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,.heic"
              multiple
              onChange={e => { handleFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-4 py-2 border border-[#E8E4DF] text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#F8F7F5] transition-colors shrink-0"
            >
              <Upload className="h-3.5 w-3.5" />
              Add Photos
            </button>
          </div>

          {/* Drop zone / file list */}
          {files.length === 0 ? (
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              className="border-2 border-dashed border-[#E8E4DF] rounded-sm py-8 text-center hover:border-[#888] transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <Camera className="h-6 w-6 mx-auto text-[#ccc] mb-2" />
              <p className="text-sm text-[#888]">Drop photos here or click to browse</p>
              <p className="text-[10px] text-[#aaa] mt-1">Garment, tag, garment, tag — in order</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-3">
                {files.map((f, i) => (
                  <div key={i} className="relative group">
                    <div className={`w-16 h-20 rounded-sm overflow-hidden border ${i % 2 === 0 ? 'border-[#1A1A1A]' : 'border-blush'}`}>
                      <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
                    </div>
                    <span className={`absolute top-0.5 left-0.5 text-[7px] tracking-[0.1em] uppercase px-1 rounded-sm ${
                      i % 2 === 0 ? 'bg-[#1A1A1A] text-white' : 'bg-blush text-[#1A1A1A]'
                    }`}>
                      {i % 2 === 0 ? 'item' : 'tag'}
                    </span>
                    <button
                      onClick={() => removeFile(i)}
                      className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-[#888]">
                  {files.length} photos · {Math.ceil(files.length / 2)} items
                  {files.length % 2 !== 0 && <span className="text-amber-600 ml-1">(odd — last item has no tag)</span>}
                </p>
                <button
                  onClick={runPipeline}
                  disabled={!selectedClientId}
                  className="flex items-center gap-2 px-6 py-2.5 bg-[#1A1A1A] text-white text-[11px] tracking-[0.2em] uppercase rounded-sm hover:bg-[#333] disabled:opacity-40 transition-colors"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Digitize {Math.ceil(files.length / 2)} Items · {estimateTime(files.length)}
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
            onClick={() => { setStage('select'); setFiles([]) }}
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
