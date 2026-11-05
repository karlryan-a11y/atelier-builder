/**
 * WHICH SEASON A PIECE IS IN, AND WHETHER HER COLLECTION SHOWS SEASONS. Cynthia Dada, 2026-11-05,
 * Peyton Wheeler: "SS, FW, and ALL at the top of her collections".
 *
 * A piece's season is written on the piece as a marker in `client_edited_fields`: 'season-ss',
 * 'season-fw', or both for a year-round piece. That column, because nothing else writes it:
 * GoodPix's sync replaces `raw` and the tags, and the builder's and the lookbook's saves keep any
 * marker they do not own (the same reason the "she picked this home" marker lives there,
 * residences.ts HOME_PICKED). A piece with no marker is in no season and shows under All only.
 *
 * The switch is per client, `gp_clients.raw.collection_seasons_on`, set in the builder (Style >
 * Categorize > Collection). Off is the page every client has today.
 *
 * The builder has the same file, byte for byte (atelier-builder/src/lib/pieceSeasons.ts): its
 * scripts/check-piece-seasons.mjs and this app's tests/collectionSeasons.test.ts fail if the two
 * stop agreeing.
 *
 * Pure functions only, so the rules can be tested without a browser or a database.
 */

export type PieceSeason = 'ss' | 'fw'

export const SEASON_MARKERS: Record<PieceSeason, string> = { ss: 'season-ss', fw: 'season-fw' }

/** The seasons a piece is in: none, one, or both (a year-round piece). */
export function seasonsOfPiece(p: { client_edited_fields?: string[] | null }): Set<PieceSeason> {
  const f = p.client_edited_fields ?? []
  const out = new Set<PieceSeason>()
  if (f.includes(SEASON_MARKERS.ss)) out.add('ss')
  if (f.includes(SEASON_MARKERS.fw)) out.add('fw')
  return out
}

/** Is this one of the season markers (so a "set by the client" badge can leave it out)? */
export function isSeasonMarker(field: string): boolean {
  return field === SEASON_MARKERS.ss || field === SEASON_MARKERS.fw
}

/** Is the season switch on for this client? Off unless a stylist turned it on. */
export function collectionSeasonsOn(client: { raw?: unknown } | null | undefined): boolean {
  const raw = client?.raw as { collection_seasons_on?: unknown } | null | undefined
  return raw?.collection_seasons_on === true
}

/** The season the page was asked for: 'ss', 'fw', or '' for All. Anything else is All. */
export function parseSeason(v: string | null | undefined): PieceSeason | '' {
  const s = (v ?? '').toLowerCase()
  return s === 'ss' || s === 'fw' ? s : ''
}

/** Pieces in that season (a both-seasons piece is in each). '' keeps every piece. */
export function inSeason<T extends { client_edited_fields?: string[] | null }>(pieces: T[], season: PieceSeason | ''): T[] {
  if (!season) return pieces
  return pieces.filter((p) => seasonsOfPiece(p).has(season))
}

/**
 * The tabs to show, in order SS, FW, All. A season is offered only when it holds a piece, so a tab
 * she can tap always returns something (ADR-0108); All is always there. No tabs at all when the
 * switch is off or no piece has a season yet: the page is then exactly what it was.
 */
export function seasonTabs(on: boolean, pieces: { client_edited_fields?: string[] | null }[]): { key: PieceSeason | ''; label: string; count: number }[] {
  if (!on) return []
  let ss = 0, fw = 0
  for (const p of pieces) {
    const s = seasonsOfPiece(p)
    if (s.has('ss')) ss++
    if (s.has('fw')) fw++
  }
  if (ss === 0 && fw === 0) return []
  const tabs: { key: PieceSeason | ''; label: string; count: number }[] = []
  if (ss) tabs.push({ key: 'ss', label: 'SS', count: ss })
  if (fw) tabs.push({ key: 'fw', label: 'FW', count: fw })
  tabs.push({ key: '', label: 'All', count: pieces.length })
  return tabs
}

/** What a stylist picks for a piece in the builder: SS, FW, Both (year-round), or no season. */
export type SeasonChoice = PieceSeason | 'both' | 'none'

/**
 * The piece's `client_edited_fields` after a choice: its season markers replaced, every other
 * marker kept as it was (a name she set, the home she picked). null when nothing is left.
 */
export function withSeasonChoice(fields: string[] | null | undefined, choice: SeasonChoice): string[] | null {
  const kept = (fields ?? []).filter((f) => !isSeasonMarker(f))
  if (choice === 'ss' || choice === 'both') kept.push(SEASON_MARKERS.ss)
  if (choice === 'fw' || choice === 'both') kept.push(SEASON_MARKERS.fw)
  return kept.length ? kept : null
}

/** The choice a piece is at now, so a button can show it. */
export function choiceOfPiece(p: { client_edited_fields?: string[] | null }): SeasonChoice {
  const s = seasonsOfPiece(p)
  return s.size === 2 ? 'both' : s.has('ss') ? 'ss' : s.has('fw') ? 'fw' : 'none'
}

const SS_WORDS = new Set(['ss', 'spring', 'summer', 'springsummer'])
const FW_WORDS = new Set(['fw', 'fall', 'winter', 'autumn', 'fallwinter'])

/**
 * The season her GoodPix tags name for a piece ("summer dresses", "winter 2023/2024"), as a
 * SUGGESTION a stylist accepts with one click, never applied behind her back. Whole words only,
 * so "waterfall" is not fall. Tags naming both seasons, across one tag or several, are Both.
 * null when no tag names a season.
 */
export function seasonOfTagNames(names: string[]): SeasonChoice | null {
  let ss = false, fw = false
  for (const name of names) {
    for (const w of name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
      const base = w.replace(/\d+$/, '')
      if (SS_WORDS.has(base)) ss = true
      if (FW_WORDS.has(base)) fw = true
    }
  }
  return ss && fw ? 'both' : ss ? 'ss' : fw ? 'fw' : null
}
