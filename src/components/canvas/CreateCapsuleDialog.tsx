import { useState, useCallback } from 'react'
import { X, Check, Package, Loader2 } from 'lucide-react'
import type { LookRow } from '@/hooks/useLooks'
// The composite grid renderer lives in @/render/capsuleGrid so the headless renderer box can
// re-bake this exact hero when a member look's photo changes (see renderer/ service).
import { renderCapsuleGrid } from '@/render/capsuleGrid'

interface CreateCapsuleDialogProps {
  looks: LookRow[]
  saving: boolean
  onSave: (data: { name: string; description: string; lookIds: string[]; compositeBase64: string }) => void
  onClose: () => void
}

export function CreateCapsuleDialog({ looks, saving, onSave, onClose }: CreateCapsuleDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedLookIds, setSelectedLookIds] = useState<Set<string>>(new Set())
  const [rendering, setRendering] = useState(false)

  const toggleLook = (id: string) => {
    setSelectedLookIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSave = useCallback(async () => {
    if (!name.trim() || selectedLookIds.size === 0) return
    setRendering(true)

    try {
      // Gather look data with image URLs
      const selectedLooks = looks.filter(l => selectedLookIds.has(l.id))

      // Use thumbnails directly (they're base64 data URLs, no CORS issues)
      // Thumbnails are already rendered from the canvas with brand labels included
      const lookData = selectedLooks.map((look) => ({
        name: look.name,
        imageUrl: look.thumbnail_url, // base64 data URL — always available, no CORS
        thumbnailUrl: look.thumbnail_url,
      }))

      // Render the composite grid image
      const compositeBase64 = await renderCapsuleGrid(lookData)

      onSave({
        name: name.trim(),
        description: description.trim(),
        lookIds: Array.from(selectedLookIds),
        compositeBase64,
      })
    } catch (err) {
      console.error('Failed to render capsule:', err)
      // Save without composite image
      onSave({
        name: name.trim(),
        description: description.trim(),
        lookIds: Array.from(selectedLookIds),
        compositeBase64: '',
      })
    } finally {
      setRendering(false)
    }
  }, [name, description, selectedLookIds, looks, onSave])

  const isSaving = saving || rendering

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-sm shadow-xl w-[520px] max-h-[80vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E4DF]">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-blush" />
            <h2 className="text-sm font-medium tracking-[0.1em] uppercase text-[#1A1A1A]">Create Capsule</h2>
          </div>
          <button onClick={onClose} className="text-[#888] hover:text-[#1A1A1A]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-[9px] tracking-[0.15em] uppercase text-[#888] mb-1">Capsule Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Nashville Trip, Fall Work Rotation"
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
              placeholder="Notes for the client..."
              className="w-full border border-[#E8E4DF] rounded-sm px-3 py-2 text-sm text-[#1A1A1A] focus:border-[#888] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[9px] tracking-[0.15em] uppercase text-[#888] mb-2">
              Select Looks ({selectedLookIds.size} selected)
            </label>
            {looks.length === 0 ? (
              <p className="text-sm text-[#888] py-4 text-center">No saved looks yet. Save some looks first.</p>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {looks.map(look => (
                  <button
                    key={look.id}
                    onClick={() => toggleLook(look.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-sm border transition-colors text-left ${
                      selectedLookIds.has(look.id)
                        ? 'border-[#1A1A1A] bg-[#F8F7F5]'
                        : 'border-[#E8E4DF] hover:border-[#ccc]'
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="w-12 h-12 rounded-sm bg-[#F8F7F5] overflow-hidden shrink-0">
                      {look.thumbnail_url ? (
                        <img src={look.thumbnail_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[8px] text-[#ccc]">—</div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#1A1A1A] font-medium truncate">{look.name}</p>
                      <p className="text-[10px] text-[#888]">
                        {look.tags?.join(', ') || 'No tags'}
                      </p>
                    </div>

                    {/* Checkbox */}
                    <div className={`w-5 h-5 rounded-sm border flex items-center justify-center shrink-0 ${
                      selectedLookIds.has(look.id)
                        ? 'bg-[#1A1A1A] border-[#1A1A1A]'
                        : 'border-[#ccc]'
                    }`}>
                      {selectedLookIds.has(look.id) && (
                        <Check className="h-3 w-3 text-white" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[#E8E4DF] flex gap-3">
          <button
            onClick={handleSave}
            disabled={isSaving || !name.trim() || selectedLookIds.size === 0}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#1A1A1A] text-white text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#333] disabled:opacity-40 transition-colors"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {rendering ? 'Rendering capsule...' : 'Saving...'}
              </>
            ) : (
              <>
                <Package className="h-3.5 w-3.5" />
                Create Capsule ({selectedLookIds.size} looks)
              </>
            )}
          </button>
          <button
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2.5 border border-[#E8E4DF] text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#F8F7F5] disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
