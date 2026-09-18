import { Trash2, Plus, Copy } from 'lucide-react'
import type { LookRow } from '@/hooks/useLooks'
import { lookImageUrl } from '@/lib/lookImage'
import { LoadError } from '@/components/common/LoadError'
import { TileImage } from '@/components/common/TileImage'
import { LOOK_TILE_WIDTH } from '@/lib/derivedImage'

interface LookGalleryProps {
  looks: LookRow[]
  loading: boolean
  /** Set when the read failed: show Couldn't load + Retry, never "No saved looks yet". */
  error?: string | null
  onRetry?: () => void
  currentLookId: string | null
  onSelect: (look: LookRow) => void
  onDuplicate: (look: LookRow) => void
  onDelete: (id: string) => void
  onNew: () => void
}

export function LookGallery({ looks, loading, error, onRetry, currentLookId, onSelect, onDuplicate, onDelete, onNew }: LookGalleryProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-2 p-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="aspect-[4/5] shimmer rounded-sm" />
        ))}
      </div>
    )
  }

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] tracking-[0.3em] uppercase text-text-muted/60">
          Looks ({looks.length})
        </p>
        <button
          onClick={onNew}
          className="flex items-center gap-1 text-[9px] tracking-[0.2em] uppercase text-text-muted hover:text-text transition-colors"
        >
          <Plus className="h-3 w-3" />
          New
        </button>
      </div>

      {error && onRetry ? (
        <LoadError what="the looks" onRetry={onRetry} />
      ) : looks.length === 0 ? (
        <p className="text-[10px] tracking-[0.2em] uppercase text-text-muted/30 text-center py-4">
          No saved looks yet
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {looks.map((look) => {
            const image = lookImageUrl(look.raw)
            return (
            <div
              key={look.id}
              onClick={() => onSelect(look)}
              className={`group cursor-pointer rounded-sm border transition-colors ${
                currentLookId === look.id
                  ? 'border-blush ring-1 ring-blush'
                  : 'border-border hover:border-blush/50'
              }`}
            >
              <div className="aspect-[4/5] bg-tile rounded-t-sm overflow-hidden relative">
                {image ? (
                  <TileImage
                    src={image}
                    width={LOOK_TILE_WIDTH}
                    alt={look.name}
                    className="w-full h-full object-contain"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-[8px] tracking-[0.2em] uppercase text-text-muted/30">
                      No preview
                    </span>
                  </div>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDuplicate(look)
                  }}
                  title="Duplicate this look"
                  className="absolute top-1 left-1 p-1 bg-white/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blush/20"
                >
                  <Copy className="h-2.5 w-2.5 text-text-muted" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm('Delete this look?')) onDelete(look.id)
                  }}
                  className="absolute top-1 right-1 p-1 bg-white/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50"
                >
                  <Trash2 className="h-2.5 w-2.5 text-red-400" />
                </button>
              </div>
              <div className="px-1.5 py-1">
                <p className="text-[9px] font-medium text-text truncate">{look.name}</p>
                {look.tags && look.tags.length > 0 && (
                  <p className="text-[8px] text-text-muted/60 truncate">
                    {look.tags.join(', ')}
                  </p>
                )}
              </div>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
