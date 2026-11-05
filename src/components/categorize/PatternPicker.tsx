import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { PATTERNS, patternLabel, type PatternSlug } from '@/lib/piecePatterns'

/**
 * A piece's patterns on its Collection card (Patterns & Textures, lib/piecePatterns.ts). Shows what
 * Atelier sorted it into; "Patterns" opens the ten, and each tap saves at once, so Cynthia can go
 * down the grid checking and fixing without a dialog per piece.
 */
export function PatternPicker({ value, onChange }: {
  value: PatternSlug[]
  onChange: (next: PatternSlug[]) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  async function toggle(slug: PatternSlug) {
    if (busy) return
    setBusy(slug)
    const next = value.includes(slug) ? value.filter((s) => s !== slug) : [...value, slug]
    const ok = await onChange(next)
    setBusy(null)
    if (!ok) window.alert("That didn't save. Refresh the page and try again.")
  }
  return (
    <div data-piece-patterns className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="See or change this piece's patterns"
        className={`text-left text-[10px] tracking-[0.12em] uppercase truncate max-w-full hover:text-[#1A1A1A] transition-colors ${value.length ? 'text-[#6b5a48]' : 'text-[#c4c0ba]'}`}
      >
        {value.length ? value.map(patternLabel).join(' · ') : '+ Pattern'}
      </button>
      {open && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {PATTERNS.map((p) => {
            const on = value.includes(p.slug)
            return (
              <button
                key={p.slug}
                type="button"
                data-pattern={p.slug}
                aria-pressed={on}
                disabled={!!busy}
                onClick={() => void toggle(p.slug)}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border text-[10px] tracking-[0.04em] transition-colors disabled:opacity-60 ${on ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' : 'border-[#E8E4DF] text-[#888] hover:text-[#1A1A1A] hover:border-[#c9c2b8]'}`}
              >
                {busy === p.slug ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : on ? <Check className="h-2.5 w-2.5" /> : null}
                {p.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
