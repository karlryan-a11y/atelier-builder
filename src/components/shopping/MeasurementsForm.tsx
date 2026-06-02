import { Plus, X } from 'lucide-react'
import { useShoppingStore } from '@/stores/shoppingStore'

// Friendly display label for a snake_case measurement key
function prettyKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

export function MeasurementsForm() {
  const { measurements, measuredOn, addMeasurement, updateMeasurement, removeMeasurement } =
    useShoppingStore()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] leading-relaxed text-text-muted/70">
          Body measurements. Editing these and saving records a new dated snapshot
          (history is preserved).
        </p>
        {measuredOn && (
          <span className="shrink-0 text-[10px] tracking-[0.15em] uppercase text-text-muted/50">
            Last: {measuredOn}
          </span>
        )}
      </div>

      {measurements.length === 0 && (
        <p className="text-[11px] text-text-muted/50 italic">
          No measurements on file. Add rows below.
        </p>
      )}

      <div className="space-y-2">
        {measurements.map((m, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={m.key}
              onChange={(e) => updateMeasurement(i, { key: e.target.value })}
              placeholder="measurement"
              title={m.key ? prettyKey(m.key) : undefined}
              className="flex-1 bg-transparent border-0 border-b border-wsg-border text-sm pb-1.5 focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/30"
            />
            <input
              type="text"
              value={m.value}
              onChange={(e) => updateMeasurement(i, { value: e.target.value })}
              placeholder="value"
              className="w-28 bg-transparent border-0 border-b border-wsg-border text-sm pb-1.5 focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/30"
            />
            <button
              onClick={() => removeMeasurement(i)}
              className="text-text-muted/40 hover:text-text transition-colors p-1"
              aria-label="Remove measurement"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={addMeasurement}
        className="flex items-center gap-2 text-[10px] tracking-[0.15em] uppercase text-text-muted hover:text-text transition-colors"
      >
        <Plus className="h-3 w-3" />
        Add measurement
      </button>
    </div>
  )
}
