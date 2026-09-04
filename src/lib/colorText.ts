import { COLOR_ORDER } from './colorFamily.ts'

/**
 * Free-text colour → the filing palette (ADR-0115).
 *
 * 85,476 pieces have no filing colour, so the client's colour chips are empty for all but ten
 * clients. 21,900 of those pieces ALREADY carry a colour written down — "navy blue", "ivory",
 * "Beige, Camel", "cognac" — in `gp_closet_items.color`, a free-text field nothing has ever read.
 * Nothing in the platform translated one into the other.
 *
 * This is deliberately a DICTIONARY and not a model. A stylist can read it, disagree with it and
 * correct it, and it is the same answer every time it runs. The photographs are a separate, paid
 * pass for what is left over — measured at 8.6% of the words, which the model only ever sees after
 * this has run.
 *
 * Multi-colour arrives here for free: "Beige, Camel" and "White, Brown" were always two colours,
 * written by a human, never parsed.
 */

const PALETTE = new Map(COLOR_ORDER.map((c) => [c.toLowerCase(), c as string]))

/** Words a person uses for a colour the palette names differently. The whole authored surface. */
const SYNONYMS: Record<string, string> = {
  gray: 'Grey', charcoal: 'Grey', slate: 'Grey', graphite: 'Grey', gunmetal: 'Grey', ash: 'Grey',
  cream: 'Ivory', 'off white': 'Ivory', 'off-white': 'Ivory', eggshell: 'Ivory', bone: 'Ivory',
  'winter white': 'Ivory', ecru: 'Ivory', creme: 'Ivory', chalk: 'Ivory', alabaster: 'Ivory',
  oatmeal: 'Beige', tan: 'Beige', camel: 'Beige', sand: 'Beige', khaki: 'Beige', nude: 'Beige',
  taupe: 'Beige', stone: 'Beige', biscuit: 'Beige', natural: 'Beige', putty: 'Beige', wheat: 'Beige',
  cognac: 'Brown', chocolate: 'Brown', espresso: 'Brown', mocha: 'Brown', chestnut: 'Brown',
  walnut: 'Brown', coffee: 'Brown', caramel: 'Brown', rust: 'Brown', toffee: 'Brown', saddle: 'Brown',
  tortoise: 'Brown', mahogany: 'Brown', hazelnut: 'Brown',
  wine: 'Burgundy', maroon: 'Burgundy', oxblood: 'Burgundy', merlot: 'Burgundy', bordeaux: 'Burgundy',
  plum: 'Burgundy', claret: 'Burgundy',
  crimson: 'Red', scarlet: 'Red', cherry: 'Red', ruby: 'Red',
  coral: 'Orange', tangerine: 'Orange', apricot: 'Orange', terracotta: 'Orange', papaya: 'Orange',
  peach: 'Pink',
  mustard: 'Yellow', butter: 'Yellow', lemon: 'Yellow', honey: 'Yellow', canary: 'Yellow',
  champagne: 'Gold', brass: 'Gold', bronze: 'Gold', copper: 'Gold',
  pewter: 'Silver', platinum: 'Silver', chrome: 'Silver', metallic: 'Silver', steel: 'Silver',
  rose: 'Pink', fuchsia: 'Pink', magenta: 'Pink', 'hot pink': 'Pink', raspberry: 'Pink',
  bubblegum: 'Pink', watermelon: 'Pink',
  'rose gold': 'Blush', 'dusty rose': 'Blush', 'powder pink': 'Blush', 'pale pink': 'Blush',
  violet: 'Purple', aubergine: 'Purple', eggplant: 'Purple', amethyst: 'Purple',
  lilac: 'Lavender', mauve: 'Lavender', wisteria: 'Lavender',
  midnight: 'Navy', indigo: 'Navy', 'dark blue': 'Navy', 'navy blue': 'Navy', 'ink': 'Navy',
  cobalt: 'Blue', 'royal blue': 'Blue', denim: 'Blue', sapphire: 'Blue', 'dark wash': 'Blue',
  'medium wash': 'Blue', azure: 'Blue',
  periwinkle: 'Light Blue', sky: 'Light Blue', 'baby blue': 'Light Blue', 'powder blue': 'Light Blue',
  'pale blue': 'Light Blue', chambray: 'Light Blue', 'light wash': 'Light Blue',
  turquoise: 'Teal', aqua: 'Teal', jade: 'Teal', cyan: 'Teal',
  emerald: 'Green', sage: 'Green', mint: 'Green', forest: 'Green', 'hunter green': 'Green',
  'kelly green': 'Green', seafoam: 'Green',
  'olive green': 'Olive', 'army green': 'Olive', moss: 'Olive', fatigue: 'Olive',
  noir: 'Black', onyx: 'Black', jet: 'Black', ebony: 'Black',
  pearl: 'Ivory', neutral: 'Beige', fuscia: 'Pink', fuschia: 'Pink', tortoiseshell: 'Brown',
  biege: 'Beige', salmon: 'Pink', beige: 'Beige',
  rinse: 'Blue', 'med wash': 'Blue', 'dark rinse': 'Blue', greige: 'Beige',
  // Patterns: the piece genuinely is many colours, and Multicolor is the palette's word for it.
  multi: 'Multicolor', multicolour: 'Multicolor', 'multi color': 'Multicolor',
  'multi-color': 'Multicolor', 'multi colour': 'Multicolor',
  print: 'Multicolor', printed: 'Multicolor', floral: 'Multicolor', striped: 'Multicolor',
  stripe: 'Multicolor', plaid: 'Multicolor', leopard: 'Multicolor', 'animal print': 'Multicolor',
  patterned: 'Multicolor', pattern: 'Multicolor', colorblock: 'Multicolor', 'color block': 'Multicolor',
  'tie dye': 'Multicolor', 'tie-dye': 'Multicolor', paisley: 'Multicolor', check: 'Multicolor',
  checked: 'Multicolor', gingham: 'Multicolor', tweed: 'Multicolor', camo: 'Multicolor',
  camouflage: 'Multicolor', 'polka dot': 'Multicolor', geometric: 'Multicolor',
}

/** Adjectives that qualify a colour without changing which one it is. */
const MODIFIERS =
  /\b(light|dark|pale|deep|bright|soft|muted|washed|faded|warm|cool|true|rich|heathered|heather|solid|matte|shiny|vintage|classic|dusty|burnt|antique|med|medium)\b/g

/** A written colour is a LIST when a human separated it — that is where multi-colour comes from. */
const SEPARATORS = /\s*(?:,|\/|\||&|\+|\band\b|\bwith\b)\s*/

/** Text that names no colour at all. */
const EMPTY = new Set(['', 'n/a', 'na', 'none', '-', '--', 'unknown', 'assorted', "['']", '[]'])

/** At most this many colours from one string — past four it is noise, not a filter. */
const MAX_COLORS = 4

/** A hyphen is a separator in "black-white" and part of the word in "off-white", so it is only
 *  tried as a separator once the whole term has failed to resolve. */
function splitHyphen(p: string): string[] {
  return p.includes('-') ? p.split('-').map((x) => x.trim()).filter(Boolean) : []
}

function oneTerm(part: string): string | null {
  const p = part.trim().replace(/[.;:]+$/, '')
  if (!p) return null
  if (PALETTE.has(p)) return PALETTE.get(p)!
  if (SYNONYMS[p]) return SYNONYMS[p]
  // "Light Blue" is itself a palette entry, so only strip modifiers after the exact tries above.
  const stripped = p.replace(MODIFIERS, ' ').replace(/\s+/g, ' ').trim()
  if (PALETTE.has(stripped)) return PALETTE.get(stripped)!
  if (SYNONYMS[stripped]) return SYNONYMS[stripped]
  // "chocolate brown", "olive green suede" — the last recognised word wins, which is how English
  // orders it: the qualifier comes first and the colour last.
  let hit: string | null = null
  for (const tok of stripped.split(' ')) {
    if (PALETTE.has(tok)) hit = PALETTE.get(tok)!
    else if (SYNONYMS[tok]) hit = SYNONYMS[tok]
  }
  return hit
}

/**
 * Translate one written colour into palette values, most dominant first.
 * Returns [] when nothing is recognised — the caller must then leave the piece ALONE rather than
 * guess, because a wrong filing colour is worse than an empty one: it puts the piece under a chip
 * where the client will not look for it.
 */
export function translateColorText(raw: string | null | undefined): string[] {
  const text = (raw ?? '').trim().toLowerCase()
  if (EMPTY.has(text)) return []
  const out: string[] = []
  for (const part of text.split(SEPARATORS)) {
    const term = oneTerm(part)
    if (term) { if (!out.includes(term)) out.push(term); continue }
    for (const half of splitHyphen(part)) {
      const t = oneTerm(half)
      if (t && !out.includes(t)) out.push(t)
    }
  }
  // "Black, Multicolor" is a contradiction a separator can produce; a named colour is the better
  // answer, so Multicolor only survives when it is all there is.
  const named = out.filter((c) => c !== 'Multicolor')
  const final = named.length ? named : out
  return final.slice(0, MAX_COLORS)
}
