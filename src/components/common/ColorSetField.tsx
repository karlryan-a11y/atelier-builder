import { X, Plus, Star } from 'lucide-react'
import { COLOR_ORDER, COLOR_SWATCH, MULTI_SWATCH, CUSTOM_SWATCH, normalizeColorName } from '@/lib/colorFamily'

const LIGHT_COLORS = new Set(['White', 'Ivory', 'Blush', 'Light Blue', 'Yellow'])

export function colorDot(c: string) {
  const bg = c === 'Multicolor' ? MULTI_SWATCH : (COLOR_SWATCH[c] ?? CUSTOM_SWATCH)
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full align-middle"
      style={{ background: bg, boxShadow: LIGHT_COLORS.has(c) ? 'inset 0 0 0 1px rgba(0,0,0,.2)' : undefined }}
    />
  )
}

/**
 * The one colour-set editor (ADR-0115). A piece is rarely one colour, so every surface that assigns
 * a colour assigns the SET: the first chip is the primary (stored in color_family) and the rest go
 * to color_families[]. This lives at the choke point on purpose — the multi-CATEGORY editor was
 * copied per surface and four of five surfaces silently went without it for months (ADR-0099).
 *
 * `value` is primary-first. The caller owns persistence; this component only edits the list.
 */
export function ColorSetField({
  value,
  onChange,
  label = 'Colors',
  note,
}: {
  value: string[]
  onChange: (next: string[]) => void
  label?: string
  /** Optional slot under the label, e.g. the "client set this" heads-up. */
  note?: React.ReactNode
}) {
  const addable = COLOR_ORDER.filter((c) => !value.includes(c))
  const add = (c: string) => { if (c && !value.includes(c)) onChange([...value, c]) }
  const remove = (c: string) => onChange(value.filter((x) => x !== c))
  const makePrimary = (c: string) => onChange([c, ...value.filter((x) => x !== c)])

  return (
    <div>
      <label className="text-[10px] tracking-[0.3em] uppercase text-text-muted/60 block mb-1.5">{label}</label>
      {note}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {value.map((c, i) => (
            <span
              key={c}
              className={`inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-full text-[11px] border ${
                i === 0 ? 'border-text bg-tile text-text' : 'border-border text-text-muted'
              }`}
            >
              {i === 0 ? (
                <Star className="h-2.5 w-2.5 fill-current" />
              ) : (
                <button onClick={() => makePrimary(c)} title="Make primary" className="hover:text-text">
                  <Star className="h-2.5 w-2.5" />
                </button>
              )}
              {colorDot(c)}
              {c}
              <button
                onClick={() => remove(c)}
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
            if (v === '__new__') { const n = window.prompt('New color name (e.g. Hot Pink):'); if (n && n.trim()) add(normalizeColorName(n)) }
            else add(v)
            e.currentTarget.value = ''
          }}
          className="w-full bg-tile rounded-sm pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blush"
        >
          <option value="">Add a color…</option>
          {addable.map((c) => <option key={c} value={c}>{c}</option>)}
          <option value="__new__">＋ New color…</option>
        </select>
      </div>
      <p className="text-[9px] tracking-[0.15em] uppercase text-text-muted/40 mt-1">
        The first color is primary. Add more than one — the piece shows under each color in the client’s lookbook.
      </p>
    </div>
  )
}
