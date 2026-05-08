import { useState, useEffect } from 'react'
import { Check, X, Edit3 } from 'lucide-react'
import type { IntakeItem } from '@/hooks/useIntakeItems'
import { SignedImage } from './IntakeItemCard'
import { supabase } from '@/lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

interface IntakeItemDetailProps {
  item: IntakeItem
  onBack: () => void
  onAction: () => void
}

const CATEGORIES = [
  'Dresses', 'Tops', 'Bottoms', 'Outerwear', 'Knitwear',
  'Shoes', 'Bags', 'Accessories', 'Jewelry', 'Swimwear',
  'Activewear', 'Intimates',
]

export function IntakeItemDetail({ item, onBack, onAction }: IntakeItemDetailProps) {
  const [editing, setEditing] = useState(false)
  const [brand, setBrand] = useState(item.extracted_brand || '')
  const [name, setName] = useState(item.extracted_name || '')
  const [color, setColor] = useState(item.extracted_color || '')
  const [category, setCategory] = useState(item.extracted_category || '')
  const [material, setMaterial] = useState(item.extracted_material || '')
  const [rejecting, setRejecting] = useState(false)
  const [rejectionReasons, setRejectionReasons] = useState<Array<{ id: string; code: string; label: string }>>([])
  const [selectedReason, setSelectedReason] = useState('')
  const [rejectionNote, setRejectionNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('intake_rejection_reasons')
        .select('id, code, label')
        .eq('active', true)
        .order('display_order')
      setRejectionReasons(data ?? [])
    }
    load()
  }, [])

  const handleApprove = async () => {
    setSubmitting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-approve-item`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
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
        }),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Approve failed' }))
        throw new Error(err.error || 'Approve failed')
      }

      onAction()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to approve')
    } finally {
      setSubmitting(false)
    }
  }

  const handleReject = async () => {
    if (!selectedReason) {
      alert('Please select a rejection reason')
      return
    }

    setSubmitting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-reject-item`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          item_id: item.id,
          rejection_reason_id: selectedReason,
          rejection_note: rejectionNote || null,
        }),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Reject failed' }))
        throw new Error(err.error || 'Reject failed')
      }

      onAction()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reject')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10">
        {/* Left: Images */}
        <div className="space-y-4">
          {item.ai_image_primary_r2_key && (
            <div>
              <p className="text-[10px] tracking-[0.2em] uppercase text-[#888] mb-2">
                AI Product Photo
              </p>
              <div className="aspect-[3/4] bg-[#F8F7F5] rounded-sm overflow-hidden border border-[#E8E4DF]">
                <SignedImage
                  r2Key={item.ai_image_primary_r2_key}
                  alt="AI generated"
                  className="w-full h-full object-contain"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {item.garment_photo?.r2_key && (
              <div>
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#888] mb-2">Original</p>
                <div className="aspect-[3/4] bg-[#F8F7F5] rounded-sm overflow-hidden border border-[#E8E4DF]">
                  <SignedImage r2Key={item.garment_photo.r2_key} alt="Original garment" className="w-full h-full object-cover" />
                </div>
              </div>
            )}
            {item.tag_photo?.r2_key && (
              <div>
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#888] mb-2">Tag</p>
                <div className="aspect-[3/4] bg-[#F8F7F5] rounded-sm overflow-hidden border border-[#E8E4DF]">
                  <SignedImage r2Key={item.tag_photo.r2_key} alt="Tag" className="w-full h-full object-cover" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Metadata + Actions */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-[10px] tracking-[0.2em] uppercase text-blush">{item.client_name}</p>
              <h2 className="text-xl font-serif text-[#1A1A1A] mt-1">
                {item.extracted_name || 'Untitled Item'}
              </h2>
            </div>
            {item.status === 'pending_review' && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-[#888] hover:text-[#1A1A1A] transition-colors"
              >
                <Edit3 className="h-3.5 w-3.5" />
                Edit
              </button>
            )}
          </div>

          <div className="space-y-4 mb-8">
            <MetadataField label="Brand" value={brand} editing={editing} onChange={setBrand} />
            <MetadataField label="Item Name" value={name} editing={editing} onChange={setName} />
            <MetadataField label="Color" value={color} editing={editing} onChange={setColor} />
            <MetadataField label="Category" value={category} editing={editing} onChange={setCategory} options={CATEGORIES} />
            <MetadataField label="Material" value={material} editing={editing} onChange={setMaterial} />
          </div>

          {item.status === 'pending_review' && !rejecting && (
            <div className="flex gap-3">
              <button
                onClick={handleApprove}
                disabled={submitting}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-[#1A1A1A] text-white text-[11px] tracking-[0.2em] uppercase rounded-sm hover:bg-[#333] transition-colors disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                {submitting ? 'Approving...' : 'Approve'}
              </button>
              <button
                onClick={() => setRejecting(true)}
                disabled={submitting}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border border-[#E8E4DF] text-[#1A1A1A] text-[11px] tracking-[0.2em] uppercase rounded-sm hover:border-red-200 hover:text-red-600 transition-colors disabled:opacity-50"
              >
                <X className="h-4 w-4" />
                Reject
              </button>
            </div>
          )}

          {rejecting && (
            <div className="border border-red-100 rounded-sm p-4 bg-red-50/30">
              <p className="text-[11px] tracking-[0.15em] uppercase text-red-600 font-medium mb-3">Reject Item</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] tracking-[0.15em] uppercase text-[#888] mb-1">Reason</label>
                  <select
                    value={selectedReason}
                    onChange={e => setSelectedReason(e.target.value)}
                    className="w-full border border-[#E8E4DF] rounded-sm px-3 py-2 text-sm text-[#1A1A1A] bg-white"
                  >
                    <option value="">Select a reason...</option>
                    {rejectionReasons.map(r => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] tracking-[0.15em] uppercase text-[#888] mb-1">Note (optional)</label>
                  <textarea
                    value={rejectionNote}
                    onChange={e => setRejectionNote(e.target.value)}
                    placeholder="Add context for the client..."
                    className="w-full border border-[#E8E4DF] rounded-sm px-3 py-2 text-sm text-[#1A1A1A] resize-none h-20"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleReject}
                    disabled={submitting}
                    className="flex-1 px-4 py-2 bg-red-600 text-white text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-red-700 disabled:opacity-50"
                  >
                    {submitting ? 'Rejecting...' : 'Confirm Reject'}
                  </button>
                  <button
                    onClick={() => setRejecting(false)}
                    className="px-4 py-2 border border-[#E8E4DF] text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#F8F7F5]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {item.status === 'approved' && (
            <div className="flex items-center gap-2 p-4 bg-emerald-50 rounded-sm">
              <Check className="h-5 w-5 text-emerald-600" />
              <span className="text-sm text-emerald-700">Approved and added to collection</span>
            </div>
          )}
          {(item.status === 'rejected' || item.status === 'rejected_final') && (
            <div className="flex items-center gap-2 p-4 bg-red-50 rounded-sm">
              <X className="h-5 w-5 text-red-500" />
              <span className="text-sm text-red-600">Rejected</span>
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-[#E8E4DF]">
            <p className="text-[10px] text-[#aaa]">
              Item #{item.pair_index} · Created {new Date(item.created_at).toLocaleDateString()}
              {item.metadata_extracted_at && ` · Metadata extracted ${new Date(item.metadata_extracted_at).toLocaleTimeString()}`}
            </p>
          </div>
        </div>
      </div>
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
      <label className="block text-[10px] tracking-[0.15em] uppercase text-[#888] mb-1">{label}</label>
      {editing ? (
        options ? (
          <select
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full border border-[#E8E4DF] rounded-sm px-3 py-2 text-sm text-[#1A1A1A] bg-white"
          >
            <option value="">—</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full border border-[#E8E4DF] rounded-sm px-3 py-2 text-sm text-[#1A1A1A]"
          />
        )
      ) : (
        <p className="text-sm text-[#1A1A1A]">{value || '—'}</p>
      )}
    </div>
  )
}
