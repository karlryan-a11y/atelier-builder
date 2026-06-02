import { useState } from 'react'
import { ExternalLink } from 'lucide-react'

/**
 * Product image with a branded fallback. Retailer hero URLs sometimes 403 on
 * hotlink even after we try to re-host them server-side; rather than a blank
 * tile or a broken-image icon, we show an editorial WSG placeholder with the
 * brand name and a link out to the retailer.
 */
export function ProductImage({
  src,
  alt,
  brand,
  url,
  compact = false,
}: {
  src?: string | null
  alt?: string
  brand?: string
  url?: string
  compact?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const showImg = src && !failed

  return (
    <div className="absolute inset-0 bg-tile flex items-center justify-center overflow-hidden">
      {showImg ? (
        <img
          src={src as string}
          alt={alt || brand || 'Product'}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-1.5 px-3 text-center">
          <span
            className={`font-serif italic text-text/35 leading-none ${compact ? 'text-base' : 'text-2xl'}`}
          >
            {(brand && brand.trim()) || 'Atelier'}
          </span>
          {!compact && (
            <span className="text-[9px] tracking-[0.2em] uppercase text-text-muted/40">
              Image unavailable
            </span>
          )}
          {!compact && url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="mt-1 inline-flex items-center gap-1 text-[9px] tracking-[0.15em] uppercase text-text-muted/70 hover:text-text transition-colors"
            >
              View at retailer <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
      )}
    </div>
  )
}
