import { Plus, X } from 'lucide-react'
import { useShoppingStore } from '@/stores/shoppingStore'

const CATEGORIES = ['top', 'bottom', 'dress', 'outerwear', 'shoe', 'intimates', 'accessory'] as const
const PREFERENCES = ['preferred', 'neutral', 'blocked'] as const

export function BrandIntelligence() {
  const {
    brandSizing,
    addBrandSizing,
    updateBrandSizing,
    removeBrandSizing,
    brandPrefs,
    addBrandPref,
    updateBrandPref,
    removeBrandPref,
  } = useShoppingStore()

  return (
    <div className="space-y-8">
      {/* Brand sizing — the moat: which size this client wears in each brand */}
      <div className="space-y-3">
        <div>
          <span className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60">
            Brand Sizing
          </span>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted/60">
            What size this client wears per brand and category. Updated on every keep/return.
          </p>
        </div>

        {brandSizing.length === 0 && (
          <p className="text-[11px] text-text-muted/50 italic">No brand sizing on file.</p>
        )}

        <div className="space-y-2">
          {brandSizing.map((row, i) => (
            <div key={row.id ?? `bs_${i}`} className="flex items-center gap-2">
              <input
                type="text"
                value={row.brand}
                onChange={(e) => updateBrandSizing(i, { brand: e.target.value })}
                placeholder="Brand"
                className="flex-1 min-w-0 bg-transparent border-0 border-b border-wsg-border text-sm pb-1.5 focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/30"
              />
              <select
                value={row.category}
                onChange={(e) => updateBrandSizing(i, { category: e.target.value })}
                className="w-28 bg-transparent border-0 border-b border-wsg-border text-[12px] text-text-muted pb-1.5 focus:outline-none focus:border-text transition-colors"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={row.size}
                onChange={(e) => updateBrandSizing(i, { size: e.target.value })}
                placeholder="Size"
                className="w-16 bg-transparent border-0 border-b border-wsg-border text-sm pb-1.5 focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/30"
              />
              <input
                type="text"
                value={row.fit_note}
                onChange={(e) => updateBrandSizing(i, { fit_note: e.target.value })}
                placeholder="Fit note"
                className="flex-1 min-w-0 bg-transparent border-0 border-b border-wsg-border text-sm pb-1.5 focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/30"
              />
              <button
                onClick={() => removeBrandSizing(i)}
                className="text-text-muted/40 hover:text-text transition-colors p-1"
                aria-label="Remove brand sizing"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={addBrandSizing}
          className="flex items-center gap-2 text-[10px] tracking-[0.15em] uppercase text-text-muted hover:text-text transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add brand sizing
        </button>
      </div>

      {/* Brand preferences — preferred / neutral / blocked, with a note */}
      <div className="space-y-3">
        <div>
          <span className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60">
            Brand Preferences
          </span>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted/60">
            Brands to favor or avoid, with context. Preferred / blocked flow into the Cowork brief.
          </p>
        </div>

        {brandPrefs.length === 0 && (
          <p className="text-[11px] text-text-muted/50 italic">No brand preferences on file.</p>
        )}

        <div className="space-y-2">
          {brandPrefs.map((row, i) => (
            <div key={row.id ?? `bp_${i}`} className="flex items-center gap-2">
              <input
                type="text"
                value={row.brand}
                onChange={(e) => updateBrandPref(i, { brand: e.target.value })}
                placeholder="Brand"
                className="flex-1 min-w-0 bg-transparent border-0 border-b border-wsg-border text-sm pb-1.5 focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/30"
              />
              <select
                value={row.preference}
                onChange={(e) =>
                  updateBrandPref(i, { preference: e.target.value as (typeof PREFERENCES)[number] })
                }
                className="w-28 bg-transparent border-0 border-b border-wsg-border text-[12px] text-text-muted pb-1.5 focus:outline-none focus:border-text transition-colors"
              >
                {PREFERENCES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={row.note}
                onChange={(e) => updateBrandPref(i, { note: e.target.value })}
                placeholder="Note"
                className="flex-[2] min-w-0 bg-transparent border-0 border-b border-wsg-border text-sm pb-1.5 focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/30"
              />
              <button
                onClick={() => removeBrandPref(i)}
                className="text-text-muted/40 hover:text-text transition-colors p-1"
                aria-label="Remove brand preference"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={addBrandPref}
          className="flex items-center gap-2 text-[10px] tracking-[0.15em] uppercase text-text-muted hover:text-text transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add brand preference
        </button>
      </div>
    </div>
  )
}
