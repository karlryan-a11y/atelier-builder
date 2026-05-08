import { useState, useEffect } from 'react'
import { Clock, Check, X } from 'lucide-react'
import type { IntakeItem } from '@/hooks/useIntakeItems'
import { supabase } from '@/lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

interface IntakeItemCardProps {
  item: IntakeItem
  onClick: () => void
}

export function IntakeItemCard({ item, onClick }: IntakeItemCardProps) {
  const displayKey = item.ai_image_primary_r2_key ?? item.garment_photo?.r2_key

  const statusConfig = {
    pending_review: { icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50', label: 'Pending' },
    approved: { icon: Check, color: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Approved' },
    rejected: { icon: X, color: 'text-red-500', bg: 'bg-red-50', label: 'Rejected' },
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
 * Loads an image from R2 via the signed URL Edge Function.
 * Caches signed URLs in memory to avoid re-fetching.
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
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-signed-url`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ keys: [r2Key], expires_in: 900 }),
        })

        if (!resp.ok) return
        const data = await resp.json()
        const url = data.urls?.[r2Key]

        if (url && !cancelled) {
          signedUrlCache.set(r2Key, { url, expires: Date.now() + 840_000 }) // Cache for 14 min
          setSrc(url)
        }
      } catch {
        // Silent fail — image just won't load
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
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = 'none'
      }}
    />
  )
}
