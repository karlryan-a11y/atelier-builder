import { useState, useEffect, createContext, useContext } from 'react'
import { Clock, Check, X, ZoomIn } from 'lucide-react'
import type { IntakeItem } from '@/hooks/useIntakeItems'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

// ── Lightbox Context ──────────────────────────────────────────────────
// Global lightbox state so any image in the inbox can open it
interface LightboxState {
  open: (src: string, label: string) => void
}
export const LightboxContext = createContext<LightboxState>({ open: () => {} })

export function LightboxProvider({ children }: { children: React.ReactNode }) {
  const [src, setSrc] = useState<string | null>(null)
  const [label, setLabel] = useState('')

  const open = (s: string, l: string) => { setSrc(s); setLabel(l) }
  const close = () => { setSrc(null); setLabel('') }

  return (
    <LightboxContext.Provider value={{ open }}>
      {children}
      {src && (
        <div
          className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center cursor-zoom-out"
          onClick={close}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <img
              src={src}
              alt={label}
              className="max-w-full max-h-[85vh] object-contain rounded-sm"
            />
            <p className="text-center text-white/60 text-[10px] tracking-[0.15em] uppercase mt-2">{label}</p>
            <button
              onClick={close}
              className="absolute -top-3 -right-3 w-8 h-8 bg-white rounded-full flex items-center justify-center text-[#1A1A1A] shadow-lg hover:bg-[#F8F7F5]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </LightboxContext.Provider>
  )
}

interface IntakeItemCardProps {
  item: IntakeItem
  onClick: () => void
}

export function IntakeItemCard({ item, onClick }: IntakeItemCardProps) {
  const displayKey = item.ai_image_primary_r2_key ?? item.garment_photo?.r2_key

  const statusConfig = {
    pending_review: { icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50', label: 'Pending' },
    qc_passed: { icon: Check, color: 'text-emerald-500', bg: 'bg-emerald-50', label: 'QC Passed' },
    approved: { icon: Check, color: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Approved' },
    rejected: { icon: X, color: 'text-red-500', bg: 'bg-red-50', label: 'Rejected' },
    rejected_final: { icon: X, color: 'text-red-500', bg: 'bg-red-50', label: 'Rejected' },
  }[item.status] ?? { icon: Clock, color: 'text-[#888]', bg: 'bg-[#E8E4DF]', label: item.status }

  const StatusIcon = statusConfig.icon

  return (
    <button
      onClick={onClick}
      className="text-left bg-white border border-[#E8E4DF] rounded-sm overflow-hidden hover:border-[#ccc] hover:shadow-sm transition-all group"
    >
      {/* Image preview */}
      <div className="aspect-[3/4] bg-[#F8F7F5] relative overflow-hidden">
        {displayKey ? (
          <SignedImage r2Key={displayKey} alt={item.extracted_name ?? 'Item'} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-[10px] tracking-[0.2em] uppercase text-[#ccc]">No image</span>
          </div>
        )}

        {/* Status badge */}
        <div className={`absolute top-2 right-2 ${statusConfig.bg} rounded-sm px-2 py-0.5 flex items-center gap-1`}>
          <StatusIcon className={`h-3 w-3 ${statusConfig.color}`} />
          <span className={`text-[9px] tracking-[0.15em] uppercase font-medium ${statusConfig.color}`}>
            {statusConfig.label}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="text-[10px] tracking-[0.15em] uppercase text-blush mb-0.5">
          {item.extracted_brand || 'Unknown Brand'}
        </p>
        <p className="text-sm text-[#1A1A1A] font-medium leading-tight truncate">
          {item.extracted_name || 'Untitled Item'}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[10px] text-[#888]">{item.extracted_color || '—'}</span>
          <span className="text-[10px] text-[#ccc]">·</span>
          <span className="text-[10px] text-[#888]">{item.extracted_category || '—'}</span>
        </div>
        <p className="text-[10px] text-[#aaa] mt-1.5">{item.client_name}</p>
      </div>
    </button>
  )
}

/**
 * Loads an image from R2 via the intake-signed-url Edge Function.
 * No auth required — the function generates pre-signed read URLs.
 * Caches URLs in memory for 14 minutes (URLs expire in 15 min).
 */
const signedUrlCache = new Map<string, { url: string; expires: number }>()

export function SignedImage({ r2Key, alt, className }: { r2Key: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      // Check cache
      const cached = signedUrlCache.get(r2Key)
      if (cached && cached.expires > Date.now()) {
        setSrc(cached.url)
        return
      }

      try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-signed-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys: [r2Key], expires_in: 900 }),
        })

        if (!resp.ok) return
        const data = await resp.json()
        const url = data.urls?.[r2Key]

        if (url && !cancelled) {
          signedUrlCache.set(r2Key, { url, expires: Date.now() + 840_000 })
          setSrc(url)
        }
      } catch {
        // Silent fail
      }
    }

    load()
    return () => { cancelled = true }
  }, [r2Key])

  if (!src) {
    return (
      <div className={`bg-[#F8F7F5] animate-pulse ${className ?? 'w-full h-full'}`} />
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className ?? 'w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300'}
      loading="lazy"
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = 'none'
      }}
    />
  )
}

/**
 * SignedImage with click-to-zoom lightbox. Wraps SignedImage with a clickable overlay.
 */
export function ClickableSignedImage({ r2Key, alt, className, label }: { r2Key: string; alt: string; className?: string; label?: string }) {
  const { open } = useContext(LightboxContext)

  return (
    <div
      className="relative cursor-zoom-in group/img"
      onClick={(e) => {
        e.stopPropagation()
        const cached = signedUrlCache.get(r2Key)
        if (cached && cached.expires > Date.now()) {
          open(cached.url, label || alt)
        }
      }}
    >
      <SignedImage r2Key={r2Key} alt={alt} className={className} />
      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/10 transition-colors flex items-center justify-center">
        <ZoomIn className="h-5 w-5 text-white opacity-0 group-hover/img:opacity-80 transition-opacity drop-shadow-lg" />
      </div>
    </div>
  )
}
