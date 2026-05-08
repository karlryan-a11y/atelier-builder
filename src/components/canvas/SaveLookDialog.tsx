import { useState } from 'react'
import { X, Save } from 'lucide-react'

interface SaveLookDialogProps {
  initialName: string
  initialNotes: string
  initialTags: string[]
  saving: boolean
  onSave: (data: { name: string; notes: string; tags: string[] }) => void
  onClose: () => void
}

const SEASON_TAGS = ['Spring', 'Summer', 'Fall', 'Winter', 'Resort', 'Holiday']
const OCCASION_TAGS = ['Work', 'Casual', 'Date Night', 'Event', 'Travel', 'Vacation', 'Brunch', 'Cocktail']

export function SaveLookDialog({ initialName, initialNotes, initialTags, saving, onSave, onClose }: SaveLookDialogProps) {
  const [name, setName] = useState(initialName)
  const [notes, setNotes] = useState(initialNotes)
  const [tags, setTags] = useState<string[]>(initialTags)

  const toggleTag = (tag: string) => {
    setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])
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

          <div>
            <label className="text-[10px] tracking-[0.3em] uppercase text-text-muted/60 block mb-1.5">Season</label>
            <div className="flex flex-wrap gap-1.5">
              {SEASON_TAGS.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`text-[9px] tracking-[0.2em] uppercase px-2.5 py-1 rounded-full border transition-colors ${
                    tags.includes(tag)
                      ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                      : 'border-border text-text-muted hover:border-blush'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] tracking-[0.3em] uppercase text-text-muted/60 block mb-1.5">Occasion</label>
            <div className="flex flex-wrap gap-1.5">
              {OCCASION_TAGS.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`text-[9px] tracking-[0.2em] uppercase px-2.5 py-1 rounded-full border transition-colors ${
                    tags.includes(tag)
                      ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                      : 'border-border text-text-muted hover:border-blush'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
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
            onClick={() => onSave({ name: name.trim() || 'Untitled Look', notes, tags })}
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
