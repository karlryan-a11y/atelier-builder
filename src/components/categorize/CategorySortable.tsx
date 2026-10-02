import type { ReactNode } from 'react'
import {
  DndContext, closestCenter, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent, type DraggableAttributes, type DraggableSyntheticListeners,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'

/**
 * Drag to reorder the categories in the Categorize rail. (ADR-0162)
 *
 * The drag starts ONLY from the grip, never the row: every row is already five buttons (filter,
 * season, home, note, rename, delete) and a whole-row drag would eat their taps on the iPad.
 * The touch delay matches the Looks gallery's (LookArrangeGrid) so the two feel the same.
 */
export function CategorySortList({ ids, onMove, children }: {
  ids: string[]
  onMove: (activeId: string, overId: string) => void
  children: ReactNode
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    onMove(String(active.id), String(over.id))
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

export interface CategoryHandle {
  attributes: DraggableAttributes
  listeners: DraggableSyntheticListeners
}

/** One row of the list. `children` gets the grip to render wherever the row wants it. */
export function SortableCategoryRow({ id, disabled, children }: {
  id: string
  disabled?: boolean
  children: (grip: ReactNode) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })
  const grip = disabled ? null : (
    <button
      type="button"
      {...attributes}
      {...listeners}
      className="flex-none pl-1 py-2 cursor-grab active:cursor-grabbing opacity-40 group-hover:opacity-80 touch-none"
      aria-label="Drag to change the order of this category"
      title="Drag to change the order. Her Looks page shows categories in this order."
    >
      <GripVertical className="w-3 h-3" />
    </button>
  )
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined, position: 'relative' }}
      className={isDragging ? 'opacity-80 shadow-sm' : undefined}
    >
      {children(grip)}
    </div>
  )
}
