import { useState } from 'react'
import { Check, X, RefreshCw, ExternalLink, ChevronDown, ImagePlus, Loader2 } from 'lucide-react'
import { useBoardStore, type BoardOption } from '@/stores/boardStore'
import { useShoppingStore } from '@/stores/shoppingStore'
import { uploadOptionImage, persistOptionImage } from '@/lib/shopping-persistence'
import { ProductImage } from './ProductImage'

const REJECTION_REASONS = [
  'Color', 'Silhouette', 'Brand', 'Price', 'Fit risk', 'Off-vibe',
]

export function OptionCard({ option }: { option: BoardOption; round: number }) {
  const { reviewOption } = useBoardStore()
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [showSwapForm, setShowSwapForm] = useState(false)
  const [selectedReasons, setSelectedReasons] = useState<string[]>([])
  const [feedbackNote, setFeedbackNote] = useState('')
  const [sizeOverride, setSizeOverride] = useState(option.recommended_size)
  const [colorOverride, setColorOverride] = useState(option.recommended_color)
  const [expanded, setExpanded] = useState(false)
  const [uploadingImg, setUploadingImg] = useState(false)
  const [imgError, setImgError] = useState(false)
  const setOptionImageUrl = useBoardStore((s) => s.setOptionImageUrl)
  const sessionId = useShoppingStore((s) => s.session.id)

  async function handleImageBlob(blob: Blob | null | undefined) {
    if (!blob || !blob.type.startsWith('image/')) return
    setUploadingImg(true)
    setImgError(false)
    try {
      const url = await uploadOptionImage(blob, sessionId)
      if (!url) throw new Error('no url')
      setOptionImageUrl(option.id, url)
      await persistOptionImage(option.id, url).catch(() => {})
    } catch {
      setImgError(true)
    } finally {
      setUploadingImg(false)
    }
  }

  const isReviewed = option.status !== 'pending'

  function handleApprove() {
    reviewOption(option.id, 'approve', {
      size_override: sizeOverride,
      color_override: colorOverride,
    })
  }

  function handleReject() {
    reviewOption(option.id, 'reject', {
      rejection_reasons: selectedReasons,
      feedback_note: feedbackNote,
    })
    setShowRejectForm(false)
  }

  function handleSwap() {
    reviewOption(option.id, 'swap', {
      feedback_note: feedbackNote,
    })
    setShowSwapForm(false)
  }

  return (
    <div
      className={`border rounded-sm overflow-hidden transition-all ${
        option.status === 'approved'
          ? 'border-text/40 bg-tile/50'
          : option.status === 'rejected'
          ? 'border-wsg-border bg-white opacity-50'
          : option.status === 'swapped'
          ? 'border-blush bg-blush/20'
          : 'border-wsg-border bg-white'
      }`}
    >
      {/* Product image (branded fallback on load failure). Drop/paste/upload to
          fix a missing image — works for retailers that block automated fetch. */}
      <div
        className="group/img aspect-[3/4] relative"
        onPaste={(e) => {
          const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/'))
          if (item) handleImageBlob(item.getAsFile())
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          handleImageBlob(e.dataTransfer?.files?.[0])
        }}
        tabIndex={0}
      >
        <ProductImage
          src={option.image_url}
          alt={option.product_name}
          brand={option.brand}
          url={option.url}
        />
        {/* Add/replace image control */}
        <label
          className={`absolute bottom-2 left-2 flex items-center gap-1 px-2 py-1 rounded-sm bg-white/90 border border-wsg-border text-[9px] tracking-[0.1em] uppercase text-text-muted hover:text-text cursor-pointer transition-opacity ${
            option.image_url ? 'opacity-0 group-hover/img:opacity-100' : 'opacity-100'
          }`}
          title="Upload, drop, or paste an image"
        >
          {uploadingImg ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
          {uploadingImg ? 'Saving…' : option.image_url ? 'Replace' : 'Add image'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleImageBlob(e.target.files?.[0])}
          />
        </label>
        {imgError && (
          <span className="absolute bottom-2 right-2 text-[9px] text-red-600 bg-white/90 px-1 rounded-sm">
            save failed
          </span>
        )}

        {/* Confidence badge */}
        <div
          className={`absolute top-2 left-2 px-1.5 py-0.5 rounded-sm text-[9px] tracking-[0.1em] uppercase ${
            option.confidence === 'high'
              ? 'bg-text text-white'
              : option.confidence === 'medium'
              ? 'bg-blush text-text'
              : 'bg-white/80 text-text-muted'
          }`}
        >
          {option.confidence}
        </div>

        {/* Status badge */}
        {isReviewed && (
          <div
            className={`absolute top-2 right-2 px-1.5 py-0.5 rounded-sm text-[9px] tracking-[0.1em] uppercase ${
              option.status === 'approved'
                ? 'bg-text text-white'
                : option.status === 'rejected'
                ? 'bg-white border border-wsg-border text-text-muted'
                : 'bg-blush text-text'
            }`}
          >
            {option.status}
          </div>
        )}
      </div>

      {/* Card body */}
      <div className="p-3 space-y-2">
        {/* Brand & price */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-medium text-text uppercase tracking-[0.1em]">
              {option.brand || 'Unknown brand'}
            </p>
            <p className="text-[11px] text-text-muted line-clamp-2">{option.product_name}</p>
          </div>
          <p className="text-sm font-medium text-text whitespace-nowrap">
            {option.price ? `$${option.price}` : '—'}
          </p>
        </div>

        {/* Quick info */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-muted">
          <span>{option.retailer}</span>
          {option.recommended_size && <span>Size: {option.recommended_size}</span>}
          {option.recommended_color && <span>Color: {option.recommended_color}</span>}
        </div>

        {/* Expandable details */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-[10px] tracking-[0.1em] uppercase text-text-muted/60 hover:text-text-muted transition-colors"
        >
          Details
          <ChevronDown className={`h-2.5 w-2.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>

        {expanded && (
          <div className="space-y-1.5 text-[10px] text-text-muted pt-1 border-t border-wsg-border/50">
            {option.ship_timeline && <p>Ship: {option.ship_timeline}</p>}
            {option.return_policy && <p>Returns: {option.return_policy}</p>}
            {option.sizes_available && <p>Sizes in stock: {option.sizes_available}</p>}
            {option.colors_available && <p>Colors: {option.colors_available}</p>}
            {option.url && (
              <a
                href={option.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-blush-hover hover:underline"
              >
                View product <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}

            {/* Size/color override for approve */}
            {!isReviewed && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="block text-[9px] uppercase text-text-muted/50 mb-0.5">Size</label>
                  <input
                    type="text"
                    value={sizeOverride}
                    onChange={(e) => setSizeOverride(e.target.value)}
                    className="w-full bg-transparent border-0 border-b border-wsg-border/50 text-[11px] pb-0.5 focus:outline-none focus:border-text"
                  />
                </div>
                <div>
                  <label className="block text-[9px] uppercase text-text-muted/50 mb-0.5">Color</label>
                  <input
                    type="text"
                    value={colorOverride}
                    onChange={(e) => setColorOverride(e.target.value)}
                    className="w-full bg-transparent border-0 border-b border-wsg-border/50 text-[11px] pb-0.5 focus:outline-none focus:border-text"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        {!isReviewed && (
          <div className="flex gap-1.5 pt-1">
            <button
              onClick={handleApprove}
              className="flex-1 flex items-center justify-center gap-1 py-2 bg-text text-white text-[10px] tracking-[0.1em] uppercase rounded-sm hover:bg-text/90 transition-colors"
            >
              <Check className="h-3 w-3" />
              Approve
            </button>
            <button
              onClick={() => { setShowRejectForm(!showRejectForm); setShowSwapForm(false) }}
              className="flex-1 flex items-center justify-center gap-1 py-2 bg-white border border-wsg-border text-text text-[10px] tracking-[0.1em] uppercase rounded-sm hover:bg-tile transition-colors"
            >
              <X className="h-3 w-3" />
              Reject
            </button>
            <button
              onClick={() => { setShowSwapForm(!showSwapForm); setShowRejectForm(false) }}
              className="flex-1 flex items-center justify-center gap-1 py-2 bg-white border border-wsg-border text-text text-[10px] tracking-[0.1em] uppercase rounded-sm hover:bg-tile transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              Swap
            </button>
          </div>
        )}

        {/* Reject form */}
        {showRejectForm && !isReviewed && (
          <div className="pt-2 space-y-2 border-t border-wsg-border/50">
            <p className="text-[10px] tracking-[0.1em] uppercase text-text-muted">Reason</p>
            <div className="flex flex-wrap gap-1.5">
              {REJECTION_REASONS.map((reason) => (
                <button
                  key={reason}
                  onClick={() => {
                    setSelectedReasons((prev) =>
                      prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason]
                    )
                  }}
                  className={`px-2 py-1 text-[10px] rounded-sm border transition-colors ${
                    selectedReasons.includes(reason)
                      ? 'bg-text text-white border-text'
                      : 'bg-transparent border-wsg-border text-text-muted hover:border-text/30'
                  }`}
                >
                  {reason}
                </button>
              ))}
            </div>
            <button
              onClick={handleReject}
              className="w-full py-1.5 bg-text text-white text-[10px] tracking-[0.1em] uppercase rounded-sm hover:bg-text/90 transition-colors"
            >
              Confirm Reject
            </button>
          </div>
        )}

        {/* Swap form */}
        {showSwapForm && !isReviewed && (
          <div className="pt-2 space-y-2 border-t border-wsg-border/50">
            <input
              type="text"
              value={feedbackNote}
              onChange={(e) => setFeedbackNote(e.target.value)}
              placeholder="More drape, less structure..."
              className="w-full bg-transparent border-0 border-b border-wsg-border text-[11px] pb-1 focus:outline-none focus:border-text placeholder:text-text-muted/40"
            />
            <button
              onClick={handleSwap}
              className="w-full py-1.5 bg-text text-white text-[10px] tracking-[0.1em] uppercase rounded-sm hover:bg-text/90 transition-colors"
            >
              Request Swap
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
