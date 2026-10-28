import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trash2, Plus, Copy, Tag, Check } from 'lucide-react'
import type { LookRow } from '@/hooks/useLooks'
import { lookImageUrl } from '@/lib/lookImage'
import { lookTileFiling, tilePickerCategories, type TileCategory } from '@/lib/lookTileCategories'
import { LoadError } from '@/components/common/LoadError'
import { TileImage } from '@/components/common/TileImage'
import { LOOK_TILE_WIDTH } from '@/lib/derivedImage'

/** Where each look is filed (look_category_assignments) and the client's categories. */
export interface LookGalleryFiling {
  categories: TileCategory[]
  categoryIdsByLook: Map<string, string[]>
  /** Files or unfiles one look. Resolves false when it did not save. */
  onToggle: (lookId: string, categoryId: string, on: boolean) => Promise<boolean>
}

interface LookGalleryProps {
  looks: LookRow[]
  loading: boolean
  /** Set when the read failed: show Couldn't load + Retry, never "No saved looks yet". */
  error?: string | null
  onRetry?: () => void
  currentLookId: string | null
  /** Looks already on the capsule on the board (ADR-0152): marked, and a click does nothing. */
  onBoardIds?: string[]
  /** The board is a capsule, so a click ADDS the look. Each tile says so. */
  addMode?: boolean
  onSelect: (look: LookRow) => void
  onDuplicate: (look: LookRow) => void
  onDelete: (id: string) => void
  onNew: () => void
  /** Null until the filing has loaded: the tiles then show nothing rather than "No category". */
  filing?: LookGalleryFiling | null
}

export function LookGallery({ looks, loading, error, onRetry, currentLookId, onBoardIds = [], addMode = false, onSelect, onDuplicate, onDelete, onNew, filing = null }: LookGalleryProps) {
  // The look whose category list is open, and the button it opened from (for placing it).
  const [picker, setPicker] = useState<{ look: LookRow; anchor: DOMRect } | null>(null)

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
            const onBoard = onBoardIds.includes(look.id)
            return (
            <div
              key={look.id}
              onClick={() => onSelect(look)}
              title={addMode ? (onBoard ? 'Already on this capsule' : 'Add to this capsule') : undefined}
              className={`group cursor-pointer rounded-sm border transition-colors ${
                onBoard ? 'border-blush ring-1 ring-blush opacity-60'
                : currentLookId === look.id
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
                {addMode && (
                  <span className="absolute bottom-1 left-1 right-1 text-center text-[8px] tracking-[0.2em] uppercase bg-white/90 rounded-sm py-0.5 text-text">
                    {onBoard ? 'On capsule' : '+ Add'}
                  </span>
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
                {/* WHERE IT IS FILED, the same filing Categorize and her look page use (not the old
                    tags line). The whole block opens the category list; it never loads the look. */}
                {filing && filing.categoryIdsByLook.has(look.id) && (() => {
                  const f = lookTileFiling(filing.categoryIdsByLook.get(look.id) ?? [], filing.categories)
                  return (
                    <button
                      type="button"
                      data-look-categories-button
                      onClick={(e) => {
                        e.stopPropagation()
                        setPicker({ look, anchor: e.currentTarget.getBoundingClientRect() })
                      }}
                      title="Set this look's categories"
                      className="mt-0.5 w-full text-left flex items-start gap-1 rounded-sm hover:bg-blush/10"
                    >
                      <span data-look-categories className="flex flex-wrap gap-0.5 flex-1 min-w-0">
                        {f.labels.map((label) => (
                          <span key={label} className="text-[8px] leading-tight text-text bg-blush/15 rounded-sm px-1 py-px break-words">
                            {label}
                          </span>
                        ))}
                        {f.uncategorized && (
                          <span className="text-[8px] leading-tight text-amber-700 border border-amber-300 rounded-sm px-1">
                            No category
                          </span>
                        )}
                      </span>
                      <Tag className="h-2.5 w-2.5 mt-px shrink-0 text-text-muted" />
                    </button>
                  )
                })()}
              </div>
            </div>
            )
          })}
        </div>
      )}
      {picker && filing && (
        <LookCategoryPicker
          look={picker.look}
          anchor={picker.anchor}
          filing={filing}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}

/**
 * The client's categories with a tick on each one this look is filed in. A tick saves at once
 * (look_category_assignments, through Categorize's own assignLook), so the tile, Categorize and
 * her Looks page all change together. Placed on the page, not inside the narrow tile.
 */
function LookCategoryPicker({ look, anchor, filing, onClose }: {
  look: LookRow
  anchor: DOMRect
  filing: LookGalleryFiling
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [onClose])

  const filed = new Set(filing.categoryIdsByLook.get(look.id) ?? [])
  const options = tilePickerCategories(filing.categories)
  const width = 240
  const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8))
  const below = window.innerHeight - anchor.bottom
  const style = below > 260
    ? { left, top: anchor.bottom + 4, width, maxHeight: below - 16 }
    : { left, bottom: window.innerHeight - anchor.top + 4, width, maxHeight: anchor.top - 16 }

  return createPortal(
    <div
      ref={ref}
      data-look-category-picker
      onClick={(e) => e.stopPropagation()}
      style={style}
      className="fixed z-50 flex flex-col bg-white border border-border rounded-sm shadow-lg"
    >
      <div className="px-3 pt-2 pb-1.5 border-b border-border">
        <p className="text-[9px] tracking-[0.2em] uppercase text-text-muted">Categories</p>
        <p className="text-[11px] font-medium text-text truncate">{look.name}</p>
      </div>
      <div className="overflow-y-auto py-1">
        {options.length === 0 && (
          <p className="px-3 py-2 text-[11px] text-text-muted">This client has no categories yet. Make one in Categorize.</p>
        )}
        {options.map((c) => {
          const on = filed.has(c.id)
          return (
            <button
              key={c.id}
              type="button"
              data-category-option={c.label}
              aria-pressed={on}
              onClick={async () => {
                setFailed(false)
                const ok = await filing.onToggle(look.id, c.id, !on)
                if (!ok) setFailed(true)
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] text-text hover:bg-blush/10"
            >
              <span className={`h-3.5 w-3.5 shrink-0 rounded-sm border flex items-center justify-center ${on ? 'bg-text border-text' : 'border-border'}`}>
                {on && <Check className="h-2.5 w-2.5 text-white" />}
              </span>
              <span className="flex-1">{c.label}</span>
              {c.is_residence && <span className="text-[9px] text-text-muted">home</span>}
              {c.season && <span className="text-[9px] text-text-muted">season</span>}
            </button>
          )
        })}
      </div>
      {failed && (
        <p className="px-3 py-1.5 text-[10px] text-red-500 border-t border-border">
          That change did not save. The ticks show what is saved now.
        </p>
      )}
      <button
        type="button"
        onClick={onClose}
        className="px-3 py-2 text-[9px] tracking-[0.2em] uppercase text-text border-t border-border hover:bg-blush/10"
      >
        Done
      </button>
    </div>,
    document.body,
  )
}
