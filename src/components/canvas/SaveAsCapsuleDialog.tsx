import { useState, useCallback } from 'react'
import { X, Package, Loader2 } from 'lucide-react'

interface SaveAsCapsuleDialogProps {
  /** Number of closet items currently on the board (shown to the stylist). */
  itemCount: number
  saving: boolean
  /** True when this board was loaded from an existing capsule (Categorize → Capsules → Edit) —
   *  saving will UPDATE that capsule instead of creating a new one. Changes header/button copy. */
  isEditing?: boolean
  initialName?: string
  initialDescription?: string
  onSave: (data: { name: string; description: string }) => void
  onClose: () => void
}

/**
 * Save the CURRENT board (the canvas exactly as arranged — e.g. a Landscape
 * packing capsule) as a single capsule. Unlike CreateCapsuleDialog (which bundles
 * several already-saved looks into a grid), this captures the board itself as the
 * capsule image + its closet items as the packing list. No look selection.
 */
export function SaveAsCapsuleDialog({ itemCount, saving, isEditing, initialName = '', initialDescription = '', onSave, onClose }: SaveAsCapsuleDialogProps) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)

  const handleSave = useCallback(() => {
    if (!name.trim()) return
    onSave({ name: name.trim(), description: description.trim() })
  }, [name, description, onSave])

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-sm shadow-xl w-[480px] max-h-[80vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E4DF]">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-blush" />
            <h2 className="text-sm font-medium tracking-[0.1em] uppercase text-[#1A1A1A]">{isEditing ? 'Edit Capsule' : 'Save as Capsule'}</h2>
          </div>
          <button onClick={onClose} className="text-[#888] hover:text-[#1A1A1A]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          <p className="text-[12px] leading-relaxed text-[#6b6b6b]">
            {isEditing ? (
              <>Updates this capsule to match the board exactly as arranged
              {itemCount > 0 ? <> — {itemCount} {itemCount === 1 ? 'piece' : 'pieces'} become the new packing list.</> : '.'}{' '}
              Its publish status on the client's lookbook is unchanged.</>
            ) : (
              <>Saves this board exactly as arranged as a capsule
              {itemCount > 0 ? <> — {itemCount} {itemCount === 1 ? 'piece' : 'pieces'} become the packing list.</> : '.'}{' '}
              It lands as a <span className="text-[#1A1A1A]">Draft</span>; publish it from Categorize → Capsules to show it on the client's lookbook.</>
            )}
          </p>

          <div>
            <label className="block text-[9px] tracking-[0.15em] uppercase text-[#888] mb-1">Capsule Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
              placeholder="e.g. Lakehouse Packing Capsule"
              className="w-full border border-[#E8E4DF] rounded-sm px-3 py-2 text-sm text-[#1A1A1A] focus:border-[#888] focus:outline-none"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[9px] tracking-[0.15em] uppercase text-[#888] mb-1">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
              placeholder="Notes for the client..."
              className="w-full border border-[#E8E4DF] rounded-sm px-3 py-2 text-sm text-[#1A1A1A] focus:border-[#888] focus:outline-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[#E8E4DF] flex gap-3">
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#1A1A1A] text-white text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#333] disabled:opacity-40 transition-colors"
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {isEditing ? 'Updating...' : 'Saving...'}
              </>
            ) : (
              <>
                <Package className="h-3.5 w-3.5" />
                {isEditing ? 'Update Capsule' : 'Save as Capsule'}
              </>
            )}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2.5 border border-[#E8E4DF] text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#F8F7F5] disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
