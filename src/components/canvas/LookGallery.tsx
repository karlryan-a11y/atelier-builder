import { Trash2, Plus } from 'lucide-react'
import type { LookRow } from '@/hooks/useLooks'

interface LookGalleryProps {
  looks: LookRow[]
  loading: boolean
  currentLookId: string | null
  onSelect: (look: LookRow) => void
  onDelete: (id: string) => void
  onNew: () => void
}

export function LookGallery({ looks, loading, currentLookId, onSelect, onDelete, onNew }: LookGalleryProps) {
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

      {looks.length === 0 ? (
        <p className="text-[10px] tracking-[0.2em] uppercase text-text-muted/30 text-center py-4">
          No saved looks yet
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {looks.map((look) => (
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
                {look.thumbnail_url ? (
                  <img
                    src={look.thumbnail_url}
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
          ))}
        </div>
      )}
    </div>
  )
}
