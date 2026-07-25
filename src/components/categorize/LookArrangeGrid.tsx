import { useEffect, useState } from 'react'
import {
  DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, rectSortingStrategy, useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronLeft, ChevronRight, GripVertical, Tag, X } from 'lucide-react'

/**
 * "On lookbook" arrange view. The card order here IS the order the client sees
 * in her Looks / Capsules gallery (persisted to gp_looks.sort_order or
 * gp_boards.sort_order). Reorder by dragging a card or nudging it left/right with
 * the arrows — mirrors the GoodPix workflow stylists asked for. Optimistic: the
 * parent's onReorder updates local state and writes sort_order in the background.
 *
 * Generic over looks and capsules — both satisfy ArrangeItem.
 */
export interface ArrangeItem {
  id: string
  name: string
  image: string | null
  categoryIds: string[]
}

interface Props {
  items: ArrangeItem[] // published, already in sort_order
  labelOf: (id: string) => string
  onReorder: (orderedIds: string[]) => void
  onRemove: (id: string) => void
  onArchive: (id: string) => void
  /** What the arranged set is called for the client, e.g. "Looks gallery" / "Capsules". */
  galleryName?: string
  // Tagging — same brush/multi-select behavior as the queue grid, so "On lookbook"
  // supports BOTH arranging and categorizing. Dragging only starts from the grip
  // handle, so a plain card click is free for tagging (no interaction conflict).
  activeBrushId?: string | null
  selected?: Set<string>
  onCardClick?: (item: ArrangeItem, shiftKey: boolean) => void
}

export function LookArrangeGrid({
  items, labelOf, onReorder, onRemove, onArchive, galleryName = 'Looks gallery',
  activeBrushId = null, selected, onCardClick,
}: Props) {
  // Local order for snappy arrow/drag feedback; resynced whenever the published
  // set changes identity (add/remove/refetch).
  const [ids, setIds] = useState<string[]>(() => items.map((l) => l.id))
  const propIds = items.map((l) => l.id).join(',')
  useEffect(() => { setIds(items.map((l) => l.id)) }, [propIds])

  const byId = new Map(items.map((l) => [l.id, l]))
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as ArrangeItem[]

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  function commit(next: string[]) {
    setIds(next)
    onReorder(next)
  }

  function move(id: string, dir: -1 | 1) {
    const from = ids.indexOf(id)
    const to = from + dir
    if (from < 0 || to < 0 || to >= ids.length) return
    commit(arrayMove(ids, from, to))
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    commit(arrayMove(ids, from, to))
  }

  return (
    <div>
      <p className="text-[11px] text-[#888] mb-4 leading-relaxed">
        This is the order clients see in their {galleryName}. Drag a card, or use the
        arrows, to arrange it — changes save automatically.
        {onCardClick && ' Click a card to tag it with the active category (shift-click to multi-select).'}
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-5">
            {ordered.map((item, i) => (
              <ArrangeCard
                key={item.id}
                look={item}
                index={i}
                total={ordered.length}
                labelOf={labelOf}
                onMove={move}
                onRemove={onRemove}
                onArchive={onArchive}
                isSelected={selected?.has(item.id) ?? false}
                hasBrush={!!activeBrushId && item.categoryIds.includes(activeBrushId)}
                onCardClick={onCardClick}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

interface CardProps {
  look: ArrangeItem
  index: number
  total: number
  labelOf: (id: string) => string
  onMove: (id: string, dir: -1 | 1) => void
  onRemove: (id: string) => void
  onArchive: (id: string) => void
  isSelected: boolean
  hasBrush: boolean
  onCardClick?: (item: ArrangeItem, shiftKey: boolean) => void
}

function ArrangeCard({ look, index, total, labelOf, onMove, onRemove, onArchive, isSelected, hasBrush, onCardClick }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: look.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.85 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={(e) => onCardClick?.(look, e.shiftKey)}
      className={`group relative bg-white rounded-sm border-2 transition-colors ${
        onCardClick ? 'cursor-pointer' : ''
      } ${
        isDragging
          ? 'border-[#1A1A1A] shadow-lg'
          : isSelected
            ? 'border-[#1A1A1A]'
            : hasBrush
              ? 'border-[#F8E5E7]'
              : 'border-transparent hover:border-[#E8E4DF]'
      }`}
    >
      {/* order number */}
      <span className="absolute top-1.5 left-1.5 z-10 text-[9px] tracking-[0.1em] uppercase px-1.5 py-0.5 rounded bg-[#1A1A1A] text-white tabular-nums">
        {index + 1}
      </span>

      {/* drag handle */}
      <button
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="absolute top-1.5 right-8 z-10 w-5 h-5 rounded bg-white/90 border border-[#E8E4DF] flex items-center justify-center text-[#888] opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing hover:text-[#1A1A1A]"
        aria-label={`Drag ${look.name} to reorder`}
        title="Drag to reorder"
      >
        <GripVertical className="w-3 h-3" />
      </button>

      {/* archive */}
      <button
        onClick={(e) => { e.stopPropagation(); onArchive(look.id) }}
        className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-full bg-white/90 border border-[#E8E4DF] flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[#1A1A1A] hover:text-white"
        aria-label="Archive"
        title="Archive (remove, keep recoverable)"
      >
        <X className="w-3 h-3" />
      </button>

      <div className="aspect-square flex items-center justify-center p-2 overflow-hidden">
        {look.image ? (
          <img src={look.image} alt={look.name} className="max-w-full max-h-full object-contain" loading="lazy" />
        ) : (
          <Tag className="w-6 h-6 text-[#E8E4DF]" />
        )}
      </div>

      <div className="px-2.5 pb-2.5">
        <p className="text-[11px] text-[#1A1A1A] truncate">{look.name}</p>
        <div className="flex flex-wrap gap-1 mt-1 min-h-[16px]">
          {look.categoryIds.length === 0 ? (
            <span className="text-[9px] text-[#bbb] tracking-[0.1em] uppercase">uncategorized</span>
          ) : (
            look.categoryIds.map((cid) => (
              <span key={cid} className="text-[9px] px-1.5 py-0.5 rounded bg-[#F8E5E7]/60 text-[#1A1A1A] capitalize">
                {labelOf(cid)}
              </span>
            ))
          )}
        </div>

        {/* nudge arrows */}
        <div className="mt-2 flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onMove(look.id, -1) }}
            disabled={index === 0}
            className="flex-none w-8 h-7 flex items-center justify-center rounded border border-[#E8E4DF] text-[#1A1A1A] hover:bg-[#F8F7F5] disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Move earlier"
            title="Move earlier"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="flex-1 text-center text-[9px] tracking-[0.12em] uppercase text-[#bbb] tabular-nums">
            {index + 1} / {total}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onMove(look.id, 1) }}
            disabled={index === total - 1}
            className="flex-none w-8 h-7 flex items-center justify-center rounded border border-[#E8E4DF] text-[#1A1A1A] hover:bg-[#F8F7F5] disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Move later"
            title="Move later"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); onRemove(look.id) }}
          className="mt-1 w-full py-1.5 text-[10px] tracking-[0.08em] uppercase rounded border border-[#E8E4DF] text-[#888] hover:text-[#1A1A1A]"
        >
          Remove from lookbook
        </button>
      </div>
    </div>
  )
}
