import { useState, useCallback, useEffect, useRef } from 'react'
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
  /** The capsule's team note, read from the team-only table (ADR-0166). Arrives a moment after
   *  the box opens, so it fills the field unless the stylist has already typed in it. */
  initialTeamNote?: string
  /** The trip's dates (migration 041; Karl 10/9: set them when the capsule is made). */
  initialStart?: string | null
  initialEnd?: string | null
  onSave: (data: { name: string; description: string; teamNote: string; eventStart: string | null; eventEnd: string | null }) => void
  onClose: () => void
}

/**
 * Save the CURRENT board (the canvas exactly as arranged — e.g. a Landscape
 * packing capsule) as a single capsule. Unlike CreateCapsuleDialog (which bundles
 * several already-saved looks into a grid), this captures the board itself as the
 * capsule image + its closet items as the packing list. No look selection.
 */
export function SaveAsCapsuleDialog({ itemCount, saving, isEditing, initialName = '', initialDescription = '', initialTeamNote = '', initialStart = null, initialEnd = null, onSave, onClose }: SaveAsCapsuleDialogProps) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [teamNote, setTeamNote] = useState(initialTeamNote)
  const [start, setStart] = useState(initialStart ?? '')
  const [end, setEnd] = useState(initialEnd ?? '')
  const typedNote = useRef(false)
  useEffect(() => { if (!typedNote.current) setTeamNote(initialTeamNote) }, [initialTeamNote])

  const handleSave = useCallback(() => {
    if (!name.trim()) return
    onSave({ name: name.trim(), description: description.trim(), teamNote: teamNote.trim(), eventStart: start || null, eventEnd: start && end && end >= start ? end : null })
  }, [name, description, teamNote, start, end, onSave])

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

          {/* Trip dates (migration 041). Optional; they show beneath the name on her lookbook,
              under Coming up on her home page, and on the team's Trips list. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[9px] tracking-[0.15em] uppercase text-[#888] mb-1">Leaves (optional)</label>
              <input type="date" data-capsule-start value={start} onChange={e => setStart(e.target.value)}
                className="w-full border border-[#E8E4DF] rounded-sm px-3 py-2 text-sm text-[#1A1A1A] focus:border-[#888] focus:outline-none" />
            </div>
            <div>
              <label className="block text-[9px] tracking-[0.15em] uppercase text-[#888] mb-1">Back</label>
              <input type="date" data-capsule-end value={end} min={start || undefined} onChange={e => setEnd(e.target.value)}
                className="w-full border border-[#E8E4DF] rounded-sm px-3 py-2 text-sm text-[#1A1A1A] focus:border-[#888] focus:outline-none" />
            </div>
          </div>

          {/* ADR-0166. The team's note on this capsule, in the team-only table. */}
          <div>
            <label className="block text-[9px] tracking-[0.15em] uppercase text-[#888] mb-1">Team note</label>
            <textarea
              value={teamNote}
              onChange={e => { typedNote.current = true; setTeamNote(e.target.value) }}
              rows={2}
              placeholder='e.g. "She wants to rewear the cream knit twice"'
              className="w-full border border-[#E8E4DF] rounded-sm px-3 py-2 text-sm text-[#1A1A1A] focus:border-[#888] focus:outline-none resize-none"
            />
            <p className="text-[9px] tracking-[0.15em] uppercase text-[#aaa] mt-1">Team only. Never shown to the client</p>
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
