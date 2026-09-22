import { Check } from 'lucide-react'

/**
 * THE WAY INTO A SELECTION. ADR-0137.
 *
 * Cynthia Dada, 2026-09-22: "Can we please have a select button when adding looks to other
 * categories? I don't always need to select all. Right now I'm selecting all and then deselecting
 * the looks I don't want in the category I'm adding to."
 *
 * Picking looks one at a time already worked. It was just invisible: the FIRST one had to be
 * shift-clicked (lib/lookCategoryFilter.ts, cardClickAction), and after that a plain click
 * selected and deselected. Which is exactly why deselecting felt natural to her and starting did
 * not, and why the only route she could find was Select all and then undo 20 of 23.
 *
 * So the shortcut gets a face. One component, used by BOTH card renderers — the arrange grid on
 * "On lookbook" and the plain grid everywhere else — because this shipped once already as a
 * behaviour that only one of them advertised.
 *
 * It appears on hover, and stays put once anything is selected, so a half-made selection never
 * disappears from under her.
 */
export function SelectCheckbox({
  checked,
  anySelected,
  onToggle,
  label,
}: {
  checked: boolean
  /** True when a selection is in progress, so every box stays visible rather than hover-only. */
  anySelected: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? `Deselect ${label}` : `Select ${label}`}
      title={checked ? 'Deselect' : 'Select'}
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      className={`absolute top-1.5 left-1.5 z-20 w-5 h-5 rounded-sm border flex items-center justify-center transition-opacity ${
        checked
          ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white opacity-100'
          : 'bg-white/90 border-[#E8E4DF] text-transparent hover:border-[#1A1A1A]'
      } ${checked || anySelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
    >
      <Check className="w-3 h-3" />
    </button>
  )
}

/**
 * How far the card's own top-left badge (the order number, the Live/Draft pill) moves across to
 * make room. Exported so both cards shift by the same amount and neither can drift.
 */
export const BADGE_OFFSET_WHEN_SELECTABLE = 'left-7'
