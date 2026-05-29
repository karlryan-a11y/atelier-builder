import { ExternalLink } from 'lucide-react'
import { useShoppingStore } from '@/stores/shoppingStore'
import {
  deriveSeason,
  SEASON_LABEL,
  SEASON_PALETTE,
  SEASON_ATTRS,
  SEASONAL_SWATCHES_URL,
  WATSON_COLOR_RULES,
  type Temperature,
  type Chroma,
  type Depth,
  type Season,
} from '@/lib/color-analysis'

function Choice<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string
  hint?: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div>
      <label className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60 mb-2">
        {label}
      </label>
      <div className="flex gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(value === opt.value ? ('' as T) : opt.value)}
            className={`px-3 py-1.5 text-[10px] tracking-[0.1em] uppercase rounded-sm border transition-colors ${
              value === opt.value
                ? 'bg-text text-white border-text'
                : 'bg-transparent text-text-muted border-wsg-border hover:border-text/30'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1.5 text-[10px] text-text-muted/50 italic">{hint}</p>}
    </div>
  )
}

const SEASONS: Exclude<Season, ''>[] = ['spring', 'summer', 'autumn', 'winter']

export function ColorAnalysis() {
  const { session, setProfile } = useShoppingStore()
  const { profile } = session
  const season = profile.color_season

  function selectTemperature(t: Temperature) {
    const next = deriveSeason(t, profile.color_chroma)
    setProfile({ color_temperature: t, ...(next ? { color_season: next } : {}) })
  }

  function selectChroma(c: Chroma) {
    const next = deriveSeason(profile.color_temperature, c)
    setProfile({ color_chroma: c, ...(next ? { color_season: next } : {}) })
  }

  function selectDepth(d: Depth) {
    setProfile({ color_depth: d })
  }

  function selectSeason(s: Season) {
    setProfile({ color_season: profile.color_season === s ? '' : s })
  }

  return (
    <div className="space-y-6">
      <p className="text-[11px] leading-relaxed text-text-muted/70">
        Work the framework in order — Temperature, then Chroma, then Depth. Season is
        assigned automatically from Temperature + Chroma (you can override below).
      </p>

      {/* Step 1: Temperature */}
      <Choice<Temperature>
        label="1 · Temperature"
        hint="Veins blue → Cool · veins green → Warm"
        value={profile.color_temperature}
        onChange={selectTemperature}
        options={[
          { value: 'warm', label: 'Warm' },
          { value: 'cool', label: 'Cool' },
        ]}
      />

      {/* Step 2: Chroma */}
      <Choice<Chroma>
        label="2 · Chroma"
        hint="Freckles or muted/blended eyes → Soft · bright, clear, defined eyes → Bright"
        value={profile.color_chroma}
        onChange={selectChroma}
        options={[
          { value: 'bright', label: 'Bright' },
          { value: 'soft', label: 'Soft' },
        ]}
      />

      {/* Step 3: Depth */}
      <Choice<Depth>
        label="3 · Depth"
        hint="Overall value of hair, skin, and eyes"
        value={profile.color_depth}
        onChange={selectDepth}
        options={[
          { value: 'light', label: 'Light' },
          { value: 'deep', label: 'Deep' },
        ]}
      />

      {/* Step 4: Season */}
      <div>
        <label className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60 mb-2">
          4 · Season
        </label>
        <div className="flex flex-wrap gap-2">
          {SEASONS.map((s) => (
            <button
              key={s}
              onClick={() => selectSeason(s)}
              className={`px-3 py-1.5 text-[10px] tracking-[0.1em] uppercase rounded-sm border transition-colors ${
                season === s
                  ? 'bg-text text-white border-text'
                  : 'bg-transparent text-text-muted border-wsg-border hover:border-text/30'
              }`}
            >
              {SEASON_LABEL[s]}
            </button>
          ))}
        </div>

        {season && (
          <div className="mt-3 rounded-sm border border-wsg-border bg-tile/50 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-serif text-base text-text">
                {SEASON_LABEL[season]}
              </span>
              <span className="text-[10px] tracking-[0.15em] uppercase text-text-muted/60">
                {SEASON_ATTRS[season]}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">
              {SEASON_PALETTE[season]}
            </p>
          </div>
        )}

        <a
          href={SEASONAL_SWATCHES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase text-text-muted hover:text-text transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          Seasonal color swatches
        </a>
      </div>

      {/* Watson shopping rules */}
      <div className="rounded-sm border border-wsg-border bg-white p-3">
        <span className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60 mb-2">
          Shopping Rules
        </span>
        <ul className="space-y-1.5">
          {WATSON_COLOR_RULES.map((rule, i) => (
            <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-text-muted">
              <span className="text-text-muted/40">·</span>
              <span>{rule}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-[10px] tracking-[0.2em] uppercase text-text-muted/60 mb-2">
          Color Analysis Notes
        </label>
        <textarea
          value={profile.color_analysis_notes}
          onChange={(e) => setProfile({ color_analysis_notes: e.target.value })}
          placeholder="Observations from the analysis — what brightened the skin, which tones to push or avoid near the face, exceptions..."
          rows={2}
          className="w-full bg-tile/50 rounded-sm border border-wsg-border p-3 text-sm focus:outline-none focus:border-text transition-colors placeholder:text-text-muted/40 resize-y"
        />
      </div>
    </div>
  )
}
