import { useState, useRef } from 'react'
import { X, Save, Eraser, Upload, Archive } from 'lucide-react'
import type { ClosetItem } from '@/lib/images'
import { CATEGORY_LABELS } from '@/lib/categorize'
import { slugifyCategory } from '@/lib/garmentCategory'

interface EditItemDialogProps {
  item: ClosetItem
  saving: boolean
  /** Custom categories already used by this client, offered alongside the fixed ones. */
  customCategories?: { slug: string; label: string }[]
  onSave: (data: { name_override: string | null; brand: string | null; color: string | null; style_note: string | null; category: string | null }) => void
  onClose: () => void
  /** When provided, shows a "Remove BG" button that strips the item's image to transparent. */
  onRemoveBackground?: () => void
  removingBg?: boolean
  /** When provided, shows a "Replace Photo" button that uploads a new image for this item. */
  onReplacePhoto?: (file: File) => void
  replacing?: boolean
  /** When provided, shows an "Archive" button that removes the item from the client's collection & lookbook (reversible soft-delete). */
  onArchive?: () => void
  archiving?: boolean
}

export function EditItemDialog({ item, saving, customCategories = [], onSave, onClose, onRemoveBackground, removingBg, onReplacePhoto, replacing, onArchive, archiving }: EditItemDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  // The name field is pre-filled with the effective name (override or scraped).
  const [name, setName] = useState(item.name_override?.trim() || item.name || '')
  const [brand, setBrand] = useState(item.brand ?? '')
  const [color, setColor] = useState(item.color ?? '')
  const [styleNote, setStyleNote] = useState(item.style_note ?? '')
  const [category, setCategory] = useState(item.category ?? '')
  const [customMode, setCustomMode] = useState(false)
  const [customName, setCustomName] = useState('')

  function handleSave() {
    const trimmedName = name.trim()
    const finalCategory = customMode ? slugifyCategory(customName) : category
    onSave({
      // Only persist an override when it actually differs from the scraped name.
      name_override: trimmedName && trimmedName !== item.name ? trimmedName : null,
      brand: brand.trim() || null,
      color: color.trim() || null,
      style_note: styleNote.trim() || null,
      category: finalCategory || null, // '' = Auto (clear override, fall back to detection)
    })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white rounded-sm shadow-xl w-[480px] max-h-[80vh] flex flex-col border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-medium tracking-[0.1em] uppercase text-text">Edit Item</h2>
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
              placeholder="e.g. Navy Valentino Pants"
              autoFocus
              className="w-full bg-tile rounded-sm px-3 py-2 text-sm placeholder:text-text-muted/40 focus:outline-none focus:ring-1 focus:ring-blush"
            />
            {item.name_override?.trim() && item.name && (
              <p className="text-[9px] tracking-[0.15em] uppercase text-text-muted/40 mt-1">
                Original: {item.name}
              </p>
            )}
          </div>

          <div>
            <label className="text-[10px] tracking-[0.3em] uppercase text-text-muted/60 block mb-1.5">Brand</label>
            <input
              type="text"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="e.g. The Row"
              className="w-full bg-tile rounded-sm px-3 py-2 text-sm placeholder:text-text-muted/40 focus:outline-none focus:ring-1 focus:ring-blush"
            />
          </div>

          <div>
            <label className="text-[10px] tracking-[0.3em] uppercase text-text-muted/60 block mb-1.5">Category</label>
            {customMode ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="e.g. Rompers"
                  autoFocus
                  className="flex-1 bg-tile rounded-sm px-3 py-2 text-sm placeholder:text-text-muted/40 focus:outline-none focus:ring-1 focus:ring-blush"
                />
                <button
                  onClick={() => { setCustomMode(false); setCustomName('') }}
                  className="px-2 py-2 text-[10px] tracking-[0.15em] uppercase text-text-muted hover:text-text"
                >Cancel</button>
              </div>
            ) : (
              <select
                value={category}
                onChange={(e) => {
                  if (e.target.value === '__new__') { setCustomMode(true); setCustomName('') }
                  else setCategory(e.target.value)
                }}
                className="w-full bg-tile rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blush"
              >
                <option value="">Auto — detect from name</option>
                {Object.entries(CATEGORY_LABELS)
                  .filter(([slug]) => slug !== 'other')
                  .map(([slug, label]) => (
                    <option key={slug} value={slug}>{label}</option>
                  ))}
                {customCategories.length > 0 && (
                  <optgroup label="Custom">
                    {customCategories.map((c) => (
                      <option key={c.slug} value={c.slug}>{c.label}</option>
                    ))}
                  </optgroup>
                )}
                <option value="__new__">＋ New category…</option>
              </select>
            )}
            <p className="text-[9px] tracking-[0.15em] uppercase text-text-muted/40 mt-1">
              Sets where this piece appears in the client's Collection. Pick "New category" to add a custom one (e.g. Rompers).
            </p>
          </div>

          <div>
            <label className="text-[10px] tracking-[0.3em] uppercase text-text-muted/60 block mb-1.5">Color</label>
            <input
              type="text"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="e.g. Navy"
              className="w-full bg-tile rounded-sm px-3 py-2 text-sm placeholder:text-text-muted/40 focus:outline-none focus:ring-1 focus:ring-blush"
            />
            <p className="text-[9px] tracking-[0.15em] uppercase text-text-muted/40 mt-1">
              Used for color search (e.g. distinguishing black vs navy of the same piece)
            </p>
          </div>

          <div>
            <label className="text-[10px] tracking-[0.3em] uppercase text-text-muted/60 block mb-1.5">
              Styling Note
            </label>
            <textarea
              value={styleNote}
              onChange={(e) => setStyleNote(e.target.value)}
              placeholder='e.g. "Must be styled with heels" (stylist-only)'
              rows={3}
              className="w-full bg-tile rounded-sm px-3 py-2 text-sm placeholder:text-text-muted/40 focus:outline-none focus:ring-1 focus:ring-blush resize-none"
            />
          </div>
        </div>

        <div className="border-t border-border">
          {/* Image tools — secondary, on their own row so they don't crowd Save. */}
          {(onRemoveBackground || onReplacePhoto) && (
            <div className="flex items-center gap-2 px-5 pt-3 pb-1">
              {onRemoveBackground && (
                <button
                  onClick={onRemoveBackground}
                  disabled={!!removingBg || !!replacing}
                  title="Remove this item's background → transparent (for items that came in with a background)"
                  className="flex items-center gap-1.5 px-3 py-2 text-[10px] tracking-[0.15em] uppercase text-text-muted border border-border rounded-sm hover:text-text hover:border-[#ccc] transition-colors disabled:opacity-50"
                >
                  <Eraser className="h-3 w-3" />
                  {removingBg ? 'Removing…' : 'Remove BG'}
                </button>
              )}
              {onReplacePhoto && (
                <>
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={!!replacing || !!removingBg}
                    title="Upload a better photo to replace this item's image (cleaned automatically)"
                    className="flex items-center gap-1.5 px-3 py-2 text-[10px] tracking-[0.15em] uppercase text-text-muted border border-border rounded-sm hover:text-text hover:border-[#ccc] transition-colors disabled:opacity-50"
                  >
                    <Upload className="h-3 w-3" />
                    {replacing ? 'Replacing…' : 'Replace Photo'}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onReplacePhoto(f); e.target.value = '' }}
                  />
                </>
              )}
            </div>
          )}
          {/* Commit row: Archive (destructive, far left) · Cancel + Save (right). */}
          <div className="px-5 py-4 flex items-center justify-between gap-2">
            {onArchive ? (
              <button
                onClick={onArchive}
                disabled={!!archiving || !!removingBg || !!replacing}
                title="Archive this item — removes it from the client's collection & lookbook (restorable)"
                className="flex items-center gap-1.5 px-3 py-2 text-[10px] tracking-[0.15em] uppercase text-[#a33] border border-[#e3c9c9] rounded-sm hover:bg-[#fbf3f3] hover:border-[#d9a8a8] transition-colors disabled:opacity-50"
              >
                <Archive className="h-3 w-3" />
                {archiving ? 'Archiving…' : 'Archive'}
              </button>
            ) : <span />}
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-[10px] tracking-[0.2em] uppercase text-text-muted hover:bg-tile rounded-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-6 py-2.5 bg-[#1A1A1A] text-white text-[11px] font-medium tracking-[0.18em] uppercase rounded-sm hover:bg-[#333] transition-colors disabled:opacity-50 shadow-sm"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
