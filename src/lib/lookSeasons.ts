/**
 * WHICH SEASON A LOOK IS IN, AND WHETHER A CLIENT IS READY FOR SEASONS. ADR-0154.
 *
 * A look is in a season because it is filed in one of her season categories (a category whose
 * `season` a stylist set, ADR-0147). Nothing else records it: the look's name is numbered
 * ("Janet Foutty Look 272"), and nothing reads the calendar.
 *
 * The one other place a season is written down is GoodPix's own tag on the look, "ss office
 * casual". Atelier never filed by it. It is offered here as a SUGGESTION a stylist accepts with
 * one click, never applied behind her back. 16 of Janet Foutty's 36 unfiled looks carry one.
 *
 * Pure functions only, so the rules can be tested without a browser or a database.
 */

export type Season = 'ss' | 'fw'

const SS_WORDS = new Set(['ss', 'spring', 'summer', 'springsummer'])
const FW_WORDS = new Set(['fw', 'fall', 'winter', 'autumn', 'fallwinter'])

/**
 * The season a GoodPix tag names, or null. Whole words only, so "classic" never reads as "ss"
 * and "waterfall" never reads as "fall". A tag naming BOTH seasons is null: that is a
 * year-round look, and guessing one would be wrong half the time.
 */
export function seasonOfTag(name: string): Season | null {
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  let ss = false, fw = false
  for (const w of words) {
    const base = w.replace(/\d+$/, '')   // ss25, fw2024
    if (SS_WORDS.has(base)) ss = true
    if (FW_WORDS.has(base)) fw = true
  }
  if (ss === fw) return null
  return ss ? 'ss' : 'fw'
}

/** The single season a look's GoodPix tags agree on, or null when they name none or both. */
export function seasonFromGoodPixRaw(raw: unknown): Season | null {
  const tags = (raw as { content_tags?: unknown } | null)?.content_tags
  if (!Array.isArray(tags)) return null
  const found = new Set<Season>()
  for (const t of tags) {
    const name = typeof t === 'string' ? t : (t as { name?: unknown } | null)?.name
    if (typeof name !== 'string') continue
    const s = seasonOfTag(name)
    if (s) found.add(s)
  }
  return found.size === 1 ? [...found][0] : null
}

export interface SeasonCategory { id: string; season: Season | null; sort_order: number | null; is_hidden?: boolean }

/**
 * The category a season is FILED INTO: her first visible category tagged with it, in her own
 * order. A client with both "Spring" and "Summer" tagged ss files into whichever she put first.
 */
export function seasonTargets(categories: SeasonCategory[]): Partial<Record<Season, string>> {
  const out: Partial<Record<Season, string>> = {}
  const sorted = [...categories]
    .filter((c) => c.season && !c.is_hidden)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  for (const c of sorted) if (c.season && !out[c.season]) out[c.season] = c.id
  return out
}

/** Every season a look is filed in. */
export function seasonsOfLook(categoryIds: string[], categories: SeasonCategory[]): Set<Season> {
  const bySeason = new Map(categories.filter((c) => c.season).map((c) => [c.id, c.season as Season]))
  const out = new Set<Season>()
  for (const id of categoryIds) { const s = bySeason.get(id); if (s) out.add(s) }
  return out
}

export interface SeasonLook { id: string; categoryIds: string[]; published: boolean; archived: boolean; gpSeason?: Season | null }

/**
 * The looks that stand between her and seasons: every look she can SEE (published, not
 * archived) that is in no season. Drafts do not count, because the switch is about what the
 * client's page shows, and a draft is not on it.
 */
export function looksNeedingSeason<T extends SeasonLook>(looks: T[], categories: SeasonCategory[]): T[] {
  return looks.filter((l) => l.published && !l.archived && seasonsOfLook(l.categoryIds, categories).size === 0)
}

export type SeasonChoice = Season | 'both'

/** Which category ids to add for a choice. Empty when she has no category for that season yet. */
export function categoryIdsForChoice(choice: SeasonChoice, categories: SeasonCategory[]): string[] {
  const t = seasonTargets(categories)
  const want: Season[] = choice === 'both' ? ['ss', 'fw'] : [choice]
  const ids = want.map((s) => t[s]).filter((x): x is string => !!x)
  return ids.length === want.length ? ids : []
}

export interface SwitchState {
  /** Both seasons have a category to file into. Without that, SS/FW/Both cannot be offered. */
  hasBothSeasons: boolean
  /** Looks she can see with no season. The switch unlocks at zero. */
  needing: number
  /** Of those, how many GoodPix already names a season for. */
  suggestable: number
  canTurnOn: boolean
}

export function switchState(looks: SeasonLook[], categories: SeasonCategory[]): SwitchState {
  const t = seasonTargets(categories)
  const hasBothSeasons = !!t.ss && !!t.fw
  const need = looksNeedingSeason(looks, categories)
  const suggestable = need.filter((l) => l.gpSeason).length
  return { hasBothSeasons, needing: need.length, suggestable, canTurnOn: hasBothSeasons && need.length === 0 }
}

/**
 * WHAT ONE CLICK ON A CATEGORY'S SEASON BUTTON DOES, AND WHETHER TO ASK FIRST.
 *
 * Cynthia Dada, 2026-09-29, following SOP 14 on Janet Foutty: "I tried tagging the small FW and SS
 * buttons and now they went away." Both were already tagged; the button cycles blank, SS, FW,
 * blank, so her clicks cleared them. Setting a tag on a blank category stays one click. Changing
 * or clearing one that is already set asks first, in words, because that is the click that undoes
 * work and shows no sign of it.
 */
export function nextSeasonClick(label: string, current: Season | null | undefined): { next: Season | null; confirm: string | null } {
  const name = (s: Season) => (s === 'ss' ? 'Spring/Summer (SS)' : 'Fall/Winter (FW)')
  if (!current) return { next: 'ss', confirm: null }
  if (current === 'ss') return { next: 'fw', confirm: `${label} is already tagged ${name('ss')}. Change it to ${name('fw')}?` }
  return { next: null, confirm: `${label} is already tagged ${name('fw')}. Stop it being a season?` }
}
