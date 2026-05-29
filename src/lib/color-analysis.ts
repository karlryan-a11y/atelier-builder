// Watson Style Group Color Analysis SOP
// Framework (always in this order): Temperature -> Chroma -> Depth -> Season
// Season mapping:
//   Warm + Bright = Spring
//   Cool + Bright = Winter
//   Warm + Soft   = Autumn
//   Cool + Soft   = Summer
// Source: "WSG Color Analysis SOP 2026"

export type Temperature = '' | 'warm' | 'cool'
export type Chroma = '' | 'bright' | 'soft'
export type Depth = '' | 'light' | 'deep'
export type Season = '' | 'spring' | 'summer' | 'autumn' | 'winter'

export const SEASONAL_SWATCHES_URL =
  'https://drive.google.com/drive/folders/1BBm_YFCBIs9FiV4CfA7yef8hGmMIt0_6?usp=drive_link'

export interface ColorAnalysis {
  temperature: Temperature
  chroma: Chroma
  depth: Depth
  season: Season
  notes: string
}

/**
 * Derive the season from temperature + chroma per the SOP.
 * Returns '' until both temperature and chroma are set.
 */
export function deriveSeason(temperature: Temperature, chroma: Chroma): Season {
  if (!temperature || !chroma) return ''
  if (temperature === 'warm' && chroma === 'bright') return 'spring'
  if (temperature === 'cool' && chroma === 'bright') return 'winter'
  if (temperature === 'warm' && chroma === 'soft') return 'autumn'
  if (temperature === 'cool' && chroma === 'soft') return 'summer'
  return ''
}

export const SEASON_LABEL: Record<Exclude<Season, ''>, string> = {
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
  winter: 'Winter',
}

// Plain-language palette guidance per season, used in the Cowork shopping brief
// so near-face items are sourced in the right direction.
export const SEASON_PALETTE: Record<Exclude<Season, ''>, string> = {
  spring:
    'Warm, clear, fresh colors — coral, peach, warm/golden yellow, apple green, periwinkle, ivory, camel. Avoid muted, dusty, or icy tones.',
  summer:
    'Cool, soft, muted colors — soft blue, lavender, rose, dusty pink, mauve, slate, soft navy, cool gray. Avoid hot, bright, or earthy warm tones.',
  autumn:
    'Warm, soft, deep earthy colors — olive, rust, mustard, terracotta, warm brown, cream, forest green. Avoid icy, neon, or cool pastel tones.',
  winter:
    'Cool, clear, high-contrast colors — true white, black, navy, jewel tones (emerald, sapphire, fuchsia), icy blue. Avoid muted, earthy, or warm-dusty tones.',
}

// Short summary of the season's defining attributes for the brief header.
export const SEASON_ATTRS: Record<Exclude<Season, ''>, string> = {
  spring: 'Warm + Bright',
  summer: 'Cool + Soft',
  autumn: 'Warm + Soft',
  winter: 'Cool + Bright',
}

/**
 * The Watson shopping rules tied to color analysis. Emitted into the Cowork
 * brief so sourcing stays season-precise.
 */
export const WATSON_COLOR_RULES = [
  'Stick to ONE season while shopping — the client is exactly one of Spring / Summer / Autumn / Winter.',
  'Placement matters: anything worn near the face MUST match the seasonal palette; pieces worn away from the face are flexible.',
  'Watson Decision Filter — before including any item: (1) Temperature match? (2) Chroma match? (3) Does it enhance face impact? If no → do not include.',
]
