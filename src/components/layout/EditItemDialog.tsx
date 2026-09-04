import { useState, useRef } from 'react'
import { X, Save, Eraser, Upload, Archive, RotateCw, Plus, Star } from 'lucide-react'
import type { ClosetItem } from '@/lib/images'
import { CATEGORY_LABELS } from '@/lib/categorize'
import { slugifyCategory, labelForCategory } from '@/lib/garmentCategory'
import { COLOR_ORDER, COLOR_SWATCH, MULTI_SWATCH, CUSTOM_SWATCH, colorsOf, normalizeColorName } from '@/lib/colorFamily'

const LIGHT_COLORS = new Set(['White', 'Ivory', 'Blush', 'Light Blue', 'Yellow'])
function colorDot(c: string) {
  const bg = c === 'Multicolor' ? MULTI_SWATCH : (COLOR_SWATCH[c] ?? CUSTOM_SWATCH)
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full align-middle"
      style={{ background: bg, boxShadow: LIGHT_COLORS.has(c) ? 'inset 0 0 0 1px rgba(0,0,0,.2)' : undefined }}
    />
  )
}

interface EditItemDialogProps {
  item: ClosetItem
  saving: boolean
  /** Custom categories already used by this client, offered alongside the fixed ones. */
  customCategories?: { slug: string; label: string }[]
  /**
   * The slugs of this client's HOMES. A home is not a garment type, so naming one in
   * Category is redirected to "Also in" rather than overwriting what the piece IS. Passed in
   * because which slugs are homes is a property of her rows, not of the word (ADR-0111):
   * "aspen" is a home for one client and an ordinary category for another. A Map rather than
   * a Set so the warning can call the home what SHE calls it: the slug is permanent and the
   * label is hers to rename, so labelForCategory would say "Chicago" long after she renamed
   * it to Lake House.
   */
  residenceSlugs?: Map<string, string>
  /** CORS-safe URL of the item's current image, shown as a preview so image tools (rotate) are legible. */
  imageUrl?: string | null
  /** When true, show the "Also in" multi-category editor (writes custom_categories[]). Only the
   *  Collection tab opts in; other consumers (Audit, canvas closet) keep single-category editing. */
  enableMultiCategory?: boolean
  /** When true, show the "Colors" chip editor (writes color_family primary + color_families[] extras).
   *  Only the Collection tab opts in; other consumers keep the plain free-text color field. */
  enableMultiColor?: boolean
  onSave: (data: { name_override: string | null; brand: string | null; color: string | null; style_note: string | null; category: string | null; custom_categories?: string[] | null; color_family?: string | null; color_families?: string[] | null }) => void
  onClose: () => void
  /** When provided, shows a "Remove BG" button that strips the item's image to transparent. */
  onRemoveBackground?: () => void
  removingBg?: boolean
  /** When provided, shows a "Replace Photo" button that uploads a new image for this item. */
  onReplacePhoto?: (file: File) => void
  replacing?: boolean
  /** When provided, shows a "Rotate 90°" button that turns the item's image a quarter-turn clockwise. */
  onRotate?: () => void
  rotating?: boolean
  /** When provided, shows an "Archive" button that removes the item from the client's collection & lookbook (reversible soft-delete). */
  onArchive?: () => void
  archiving?: boolean
  onTransitionOut?: () => void
  transitioning?: boolean
  /** Fields the client set from their lookbook (migration 015) + the client's first name, to warn
   *  the stylist before overwriting them. */
  clientEditedFields?: string[] | null
  clientFirst?: string
}

export function EditItemDialog({ item, saving, customCategories = [], residenceSlugs, imageUrl, enableMultiCategory = false, enableMultiColor = false, onSave, onClose, onRemoveBackground, removingBg, onReplacePhoto, replacing, onRotate, rotating, onArchive, archiving, onTransitionOut, transitioning, clientEditedFields, clientFirst }: EditItemDialogProps) {
  // Level-2 heads-up: warn before overwriting a field the client set themselves.
  const clientOwns = (f: string) => (clientEditedFields ?? []).includes(f)
  const who = clientFirst || 'The client'
  const ClientNote = ({ field }: { field: string }) =>
    clientOwns(field)
      ? <p className="text-[9px] tracking-[0.12em] uppercase text-[#a98b5b] mt-1">✦ {who} set this — change anyway?</p>
      : null
  // Any in-flight image operation locks the others (they all mutate the same stored image).
  const imgBusy = !!removingBg || !!replacing || !!rotating
  const fileRef = useRef<HTMLInputElement>(null)
  // The name field is pre-filled with the effective name (override or scraped).
  const [name, setName] = useState(item.name_override?.trim() || item.name || '')
  const [brand, setBrand] = useState(item.brand ?? '')
  const [color, setColor] = useState(item.color ?? '')
  const [styleNote, setStyleNote] = useState(item.style_note ?? '')
  const [category, setCategory] = useState(item.category ?? '')
  const [customMode, setCustomMode] = useState(false)
  const [customName, setCustomName] = useState('')
  // "Also in" — additional categories beyond the primary garment one (stored in custom_categories[]).
  const [alsoIn, setAlsoIn] = useState<string[]>(() =>
    (item.custom_categories ?? []).map((c) => slugifyCategory(String(c))).filter(Boolean),
  )
  // Color set, primary first (stored as color_family + color_families[]). Only used when enableMultiColor.
  const [colorSet, setColorSet] = useState<string[]>(() => colorsOf(item))
  const addableColors = COLOR_ORDER.filter((c) => !colorSet.includes(c))
  function addColor(c: string) {
    if (c && !colorSet.includes(c)) setColorSet((p) => [...p, c])
  }
  function removeColor(c: string) {
    setColorSet((p) => p.filter((x) => x !== c))
  }
  function makeColorPrimary(c: string) {
    setColorSet((p) => [c, ...p.filter((x) => x !== c)])
  }

  const primarySlug = customMode ? slugifyCategory(customName) : category
  // Offer every fixed category + this client's customs, minus the current primary and ones already added.
  const alsoInOptions: { slug: string; label: string }[] = [
    ...Object.entries(CATEGORY_LABELS).filter(([s]) => s !== 'other').map(([slug, label]) => ({ slug, label })),
    ...customCategories,
  ].filter((o, i, arr) => arr.findIndex((x) => x.slug === o.slug) === i)
    .filter((o) => o.slug !== primarySlug && !alsoIn.includes(o.slug))

  function addAlsoIn(slug: string) {
    const s = slugifyCategory(slug)
    if (s && s !== primarySlug && !alsoIn.includes(s)) setAlsoIn((p) => [...p, s])
  }

  function handleSave() {
    const trimmedName = name.trim()
    let finalCategory = customMode ? slugifyCategory(customName) : category
    let alsoInFinal = alsoIn
    // A home is not a garment type. Typing one into Category replaces what the piece IS, so the
    // coat stops being Outerwear everywhere — the mistake that cost 119 of Margaux Ellery's
    // pieces their garment type. Move it to "Also in", where it is additive, and say so.
    if (residenceSlugs?.has(finalCategory)) {
      const label = residenceSlugs.get(finalCategory) || labelForCategory(finalCategory)
      alert(
        `"${label}" is a home, not a garment type.\n\n` +
        `Category replaces what this piece IS — it would drop out of Tops, Shoes and Outerwear.\n\n` +
        `Adding it to ${label} under "Also in" instead, which keeps its garment type. ` +
        `Set Category to what the piece actually is.`,
      )
      alsoInFinal = [...new Set([...alsoIn, finalCategory])]
      finalCategory = ''
    }
    onSave({
      // Only persist an override when it actually differs from the scraped name.
      name_override: trimmedName && trimmedName !== item.name ? trimmedName : null,
      brand: brand.trim() || null,
      color: color.trim() || null,
      style_note: styleNote.trim() || null,
      category: finalCategory || null, // '' = Auto (clear override, fall back to detection)
      // Only the Collection tab manages "Also in"; when disabled, omit the key so other
      // consumers' saves never touch custom_categories.
      ...(enableMultiCategory
        ? { custom_categories: alsoInFinal.filter((s) => s && s !== finalCategory) }
        : {}),
      // Only the Collection tab manages the color set; when disabled, omit the keys so other
      // consumers' saves never touch color_family / color_families.
      ...(enableMultiColor
        ? { color_family: colorSet[0] ?? null, color_families: colorSet.slice(1) }
        : {}),
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
          {imageUrl && (
            <div className="relative bg-tile rounded-sm aspect-square flex items-center justify-center overflow-hidden">
              <img src={imageUrl} alt="" className="max-w-full max-h-full object-contain p-3" />
              {rotating && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/60 text-[10px] tracking-[0.2em] uppercase text-text-muted">
                  Rotating…
                </div>
              )}
            </div>
          )}

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
            <ClientNote field="name" />
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
            <ClientNote field="brand" />
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
            <ClientNote field="category" />
          </div>

          {enableMultiCategory && (
            <div>
              <label className="text-[10px] tracking-[0.3em] uppercase text-text-muted/60 block mb-1.5">Also in</label>
              {alsoIn.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {alsoIn.map((slug) => (
                    <span key={slug} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-tile text-[11px] text-text">
                      {labelForCategory(slug)}
                      <button
                        onClick={() => setAlsoIn((p) => p.filter((s) => s !== slug))}
                        className="p-0.5 rounded-full hover:bg-black/10 text-text-muted hover:text-text"
                        title="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Plus className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted/50 pointer-events-none" />
                  <select
                    value=""
                    onChange={(e) => {
                      const v = e.target.value
                      if (!v) return
                      if (v === '__new__') { const n = window.prompt('New category name (e.g. 49ers):'); if (n && n.trim()) addAlsoIn(n) }
                      else addAlsoIn(v)
                      e.currentTarget.value = ''
                    }}
                    className="w-full bg-tile rounded-sm pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blush"
                  >
                    <option value="">Add another category…</option>
                    {alsoInOptions.map((o) => (
                      <option key={o.slug} value={o.slug}>{o.label}</option>
                    ))}
                    <option value="__new__">＋ New category…</option>
                  </select>
                </div>
              </div>
              <p className="text-[9px] tracking-[0.15em] uppercase text-text-muted/40 mt-1">
                Put this piece in more than one place — e.g. Tops AND a custom category like 49ers. It shows under each.
              </p>
            </div>
          )}

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

          {enableMultiColor && (
            <div>
              <label className="text-[10px] tracking-[0.3em] uppercase text-text-muted/60 block mb-1.5">Colors</label>
              <ClientNote field="color" />
              {colorSet.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {colorSet.map((c, i) => (
                    <span
                      key={c}
                      className={`inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-full text-[11px] border ${
                        i === 0 ? 'border-text bg-tile text-text' : 'border-border text-text-muted'
                      }`}
                    >
                      {i === 0 ? (
                        <Star className="h-2.5 w-2.5 fill-current" />
                      ) : (
                        <button onClick={() => makeColorPrimary(c)} title="Make primary" className="hover:text-text">
                          <Star className="h-2.5 w-2.5" />
                        </button>
                      )}
                      {colorDot(c)}
                      {c}
                      <button
                        onClick={() => removeColor(c)}
                        className="p-0.5 rounded-full hover:bg-black/10 text-text-muted hover:text-text"
                        title="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="relative">
                <Plus className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted/50 pointer-events-none" />
                <select
                  value=""
                  onChange={(e) => {
                    const v = e.target.value
                    if (!v) return
                    if (v === '__new__') { const n = window.prompt('New color name (e.g. Hot Pink):'); if (n && n.trim()) addColor(normalizeColorName(n)) }
                    else addColor(v)
                    e.currentTarget.value = ''
                  }}
                  className="w-full bg-tile rounded-sm pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blush"
                >
                  <option value="">Add a color…</option>
                  {addableColors.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                  <option value="__new__">＋ New color…</option>
                </select>
              </div>
              <p className="text-[9px] tracking-[0.15em] uppercase text-text-muted/40 mt-1">
                The first color is primary. Add more than one, or “New color” to name one that isn’t listed. The piece shows under each color in the client’s lookbook.
              </p>
            </div>
          )}

          <div>
            <label className="text-[10px] tracking-[0.3em] uppercase text-text-muted/60 block mb-1.5">
              Internal Note
            </label>
            <textarea
              value={styleNote}
              onChange={(e) => setStyleNote(e.target.value)}
              placeholder='e.g. "Must be styled with heels"'
              rows={3}
              className="w-full bg-tile rounded-sm px-3 py-2 text-sm placeholder:text-text-muted/40 focus:outline-none focus:ring-1 focus:ring-blush resize-none"
            />
            {/* Every other field on this dialog IS client-facing (name, brand, color, category).
                This one deliberately is not — say so, or stylists assume the client reads it. */}
            <p className="text-[9px] tracking-[0.15em] uppercase text-text-muted/40 mt-1">
              Team only — never shown to the client
            </p>
          </div>
        </div>

        <div className="border-t border-border">
          {/* Image tools — secondary, on their own row so they don't crowd Save. */}
          {(onRemoveBackground || onReplacePhoto || onRotate) && (
            <div className="flex items-center gap-2 px-5 pt-3 pb-1 flex-wrap">
              {onRotate && (
                <button
                  onClick={onRotate}
                  disabled={imgBusy}
                  title="Rotate this item's photo a quarter-turn clockwise (updates it everywhere; reversible)"
                  className="flex items-center gap-1.5 px-3 py-2 text-[10px] tracking-[0.15em] uppercase text-text-muted border border-border rounded-sm hover:text-text hover:border-[#ccc] transition-colors disabled:opacity-50"
                >
                  <RotateCw className="h-3 w-3" />
                  {rotating ? 'Rotating…' : 'Rotate 90°'}
                </button>
              )}
              {onRemoveBackground && (
                <button
                  onClick={onRemoveBackground}
                  disabled={imgBusy}
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
                    disabled={imgBusy}
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
            <div className="flex items-center gap-2">
              {onArchive ? (
                <button
                  onClick={onArchive}
                  disabled={!!archiving || !!transitioning || imgBusy}
                  title="Archive this item — removes it from the client's collection & lookbook (restorable)"
                  className="flex items-center gap-1.5 px-3 py-2 text-[10px] tracking-[0.15em] uppercase text-[#a33] border border-[#e3c9c9] rounded-sm hover:bg-[#fbf3f3] hover:border-[#d9a8a8] transition-colors disabled:opacity-50"
                >
                  <Archive className="h-3 w-3" />
                  {archiving ? 'Archiving…' : 'Archive'}
                </button>
              ) : <span />}
              {onTransitionOut && (
                <button
                  onClick={onTransitionOut}
                  disabled={!!transitioning || !!archiving || imgBusy}
                  title="Client no longer owns this — removes the piece AND the looks styled with it from the lookbook (restorable in the Transitions tab)"
                  className="flex items-center gap-1.5 px-3 py-2 text-[10px] tracking-[0.15em] uppercase text-text-muted border border-[#E8E4DF] rounded-sm hover:bg-tile transition-colors disabled:opacity-50"
                >
                  {transitioning ? 'Transitioning…' : 'Transition out'}
                </button>
              )}
            </div>
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
