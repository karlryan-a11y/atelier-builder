import { useState } from 'react'
import { X, Save, Plus, StickyNote } from 'lucide-react'
import { useClientStore } from '@/stores/clientStore'
import { useLookCategoryVocab } from '@/hooks/useLookCategories'

interface SaveLookDialogProps {
  initialName: string
  initialClientNote: string
  initialToTry: boolean
  initialNotes: string
  initialTags: string[]
  saving: boolean
  onSave: (data: { name: string; notes: string; clientNote: string; tags: string[]; toTry: boolean }) => void
  onClose: () => void
}

export function SaveLookDialog({ initialName, initialClientNote, initialToTry, initialNotes, initialTags, saving, onSave, onClose }: SaveLookDialogProps) {
  const [name, setName] = useState(initialName)
  const [notes, setNotes] = useState(initialNotes)
  const [clientNote, setClientNote] = useState(initialClientNote)
  const [toTry, setToTry] = useState(initialToTry)
  const [tags, setTags] = useState<string[]>(initialTags)

  const activeClient = useClientStore((s) => s.activeClient)
  const { categories, createCategory } = useLookCategoryVocab(activeClient?.id ?? null)
  const [sessionNew, setSessionNew] = useState<string[]>([])
  const [newCat, setNewCat] = useState('')
  // Categories to show as pills: this client's persisted taxonomy (look_categories) +
  // any just-created this session + anything already selected on the look.
  const shownCats = [...new Set([...categories.map((c) => c.label), ...sessionNew, ...tags])]

  // The styling notes for the categories currently ON this look. This is the surface Amaia
  // asked for: the rule ("always a sports jacket, never jeans") has to be readable at the
  // moment the look is being filed, not somewhere she has to go and look it up. Keyed by
  // label because the pills are labels; matched case-insensitively for the same reason
  // createCategory dedupes that way. (ADR-0110)
  const selectedNotes = categories
    .filter((c) => c.description && tags.some((t) => t.toLowerCase() === c.label.toLowerCase()))
    .map((c) => ({ id: c.id, label: c.label, description: c.description as string }))

  const toggleTag = (tag: string) => {
    setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])
  }

  const addNewCat = async () => {
    const n = newCat.trim()
    if (!n) return
    if (!shownCats.some((c) => c.toLowerCase() === n.toLowerCase())) setSessionNew((p) => [...p, n])
    if (!tags.some((t) => t.toLowerCase() === n.toLowerCase())) setTags((p) => [...p, n])
    setNewCat('')
    // Persist to the client's taxonomy so it shows up in the Categorize tool too.
    await createCategory(n)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-sm shadow-xl w-[420px] max-h-[80vh] flex flex-col border border-border">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-medium tracking-[0.1em] uppercase text-text">Save Look</h2>
          <button onClick={onClose} className="p-1 hover:bg-tile rounded-sm transition-colors">
            <X className="h-4 w-4 text-text-muted" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="text-[10px] tracking-[0.3em] uppercase text-text-muted/60 block mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Spring Brunch Look"
              autoFocus
              className="w-full bg-tile rounded-sm px-3 py-2 text-sm placeholder:text-text-muted/40 focus:outline-none focus:ring-1 focus:ring-blush"
            />
          </div>

          {/* TO BE TRIED, directly under the name. ADR-0153. This is the moment she knows the
              answer: she has just freestyled the look and is typing its name. Anywhere else and
              it becomes a second trip. 478 looks currently say "to be tried" in their NAME
              because there was nowhere to put it. */}
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={toTry}
              onChange={(e) => setToTry(e.target.checked)}
              className="mt-0.5 h-4 w-4 flex-none accent-[#1A1A1A] cursor-pointer"
            />
            <span>
              <span className="text-[12px] text-text block">To be tried</span>
              <span className="text-[9px] tracking-[0.15em] uppercase text-text-muted/40 block mt-0.5">
                She has not tried this on yet
              </span>
            </span>
          </label>

          <div>
            <label className="text-[10px] tracking-[0.3em] uppercase text-text-muted/60 block mb-1.5">Categories</label>
            <div className="flex flex-wrap gap-1.5">
              {shownCats.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`text-[9px] tracking-[0.2em] uppercase px-2.5 py-1 rounded-full border transition-colors capitalize ${
                    tags.includes(tag)
                      ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                      : 'border-border text-text-muted hover:border-blush'
                  }`}
                >
                  {tag}
                </button>
              ))}
              {shownCats.length === 0 && (
                <span className="text-[10px] text-text-muted/50">Loading categories…</span>
              )}
            </div>
            {selectedNotes.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {selectedNotes.map((n) => (
                  <div key={n.id} className="flex gap-1.5 bg-tile rounded-sm px-2.5 py-2">
                    <StickyNote className="w-3 h-3 flex-none mt-0.5 text-text-muted/60" />
                    <p className="text-[11px] leading-snug text-text-muted">
                      <span className="capitalize text-text">{n.label}:</span> {n.description}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1.5 mt-2">
              <input
                type="text"
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNewCat() } }}
                placeholder="New category"
                className="flex-1 bg-tile rounded-sm px-2.5 py-1.5 text-[12px] placeholder:text-text-muted/40 focus:outline-none focus:ring-1 focus:ring-blush"
              />
              <button
                type="button"
                onClick={addNewCat}
                className="flex-none w-8 h-8 flex items-center justify-center rounded-sm bg-[#1A1A1A] text-white hover:bg-[#333] transition-colors"
                aria-label="Create category"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* HERS, THEN OURS. gp_looks.notes_client has existed on all 15,785 live looks since the
              beginning and is filled on ZERO of them: written by nothing, shown by nothing. Same
              as the piece's internal note being empty on all 1,077 of Peyton's. A field nobody
              can find anything with is a field nobody fills. ADR-0151. */}
          <div>
            <label className="text-[10px] tracking-[0.3em] uppercase text-text-muted/60 block mb-1.5">Note for her</label>
            <textarea
              value={clientNote}
              onChange={(e) => setClientNote(e.target.value)}
              placeholder='e.g. "Dinner in Positano. Flat sandals, hair up."'
              rows={2}
              className="w-full bg-tile rounded-sm px-3 py-2 text-sm placeholder:text-text-muted/40 focus:outline-none focus:ring-1 focus:ring-blush resize-none"
            />
            <p className="text-[9px] tracking-[0.15em] uppercase text-text-muted/40 mt-1">Shown to the client under this look</p>
          </div>

          <div>
            <label className="text-[10px] tracking-[0.3em] uppercase text-text-muted/60 block mb-1.5">Internal Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Styling notes (only visible to stylists)..."
              rows={3}
              className="w-full bg-tile rounded-sm px-3 py-2 text-sm placeholder:text-text-muted/40 focus:outline-none focus:ring-1 focus:ring-blush resize-none"
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[10px] tracking-[0.2em] uppercase text-text-muted hover:bg-tile rounded-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave({ name: name.trim() || 'Untitled Look', notes, clientNote, tags, toTry })}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#1A1A1A] text-white text-[10px] tracking-[0.2em] uppercase rounded-sm hover:bg-[#333] transition-colors disabled:opacity-50"
          >
            <Save className="h-3 w-3" />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
