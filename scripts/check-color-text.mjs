#!/usr/bin/env node
/**
 * Colour-translation guard (ADR-0115, step 2).
 *
 * The backfill fills 20,719 empty colour sets from words already written on the pieces. Two things
 * can go wrong, and only one of them is visible afterwards.
 *
 * 1. THE TRANSLATION IS WRONG. A wrong filing colour is worse than an empty one: the piece is filed
 *    under a chip the client will never look under, and it looks correct in every list. So the
 *    dictionary is replayed here, including the cases it must REFUSE — an unrecognised word has to
 *    come back empty so the piece is left for the photo pass rather than guessed at.
 *
 * 2. THE BACKFILL OVERWRITES A HUMAN. We cannot always tell who set a colour: client edits are
 *    recorded, stylist edits are not. So the protection is structural — every write is guarded
 *    `color_family=is.null` in the WHERE clause, so a row that has any colour at all cannot match.
 *    That one clause is the entire safety story, and this guard fails if it is ever removed.
 *
 * Runs in `npm run guard`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translateColorText } from '../src/lib/colorText.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let checked = 0
const failures = []

function expect(input, want) {
  checked++
  const got = translateColorText(input)
  if (got.join('|') !== want.join('|')) {
    failures.push(`"${input}" → [${got.join(', ')}], expected [${want.join(', ')}]`)
  }
}

// ── Straight palette words ───────────────────────────────────────────────────
expect('black', ['Black'])
expect('Navy', ['Navy'])
expect('light blue', ['Light Blue'])          // a palette entry that IS two words
expect('LIGHT BLUE', ['Light Blue'])

// ── Synonyms a person actually writes ────────────────────────────────────────
expect('cream', ['Ivory'])
expect('cognac', ['Brown'])
expect('charcoal gray', ['Grey'])
expect('navy blue', ['Navy'])
expect('oxblood', ['Burgundy'])
expect('noir', ['Black'])
expect('creme', ['Ivory'])
expect('chambray', ['Light Blue'])

// ── Qualifiers that do not change which colour it is ─────────────────────────
expect('chocolate brown', ['Brown'])
expect('olive green', ['Olive'])
expect('washed charcoal with cool blue undertone', ['Grey', 'Blue'])
expect('dark wash', ['Blue'])
expect('med wash', ['Blue'])

// ── THE POINT: a written list is a colour SET ────────────────────────────────
expect('Beige, Camel', ['Beige'])             // both words mean Beige — deduped, not doubled
expect('White, Brown', ['White', 'Brown'])
expect('black-white', ['Black', 'White'])     // hyphen as a separator
expect('off-white', ['Ivory'])                // hyphen INSIDE the word, not a separator
expect('blue and gold', ['Blue', 'Gold'])
expect('gold/ diamonds', ['Gold'])
expect('red, white and blue', ['Red', 'White', 'Blue'])

// ── Prints ───────────────────────────────────────────────────────────────────
expect('multi', ['Multicolor'])
expect('floral', ['Multicolor'])
expect('leopard print', ['Multicolor'])
// A named colour beats the catch-all when a separator produced both.
expect('black, printed', ['Black'])

// ── REFUSALS — the piece must be LEFT ALONE, not guessed at ─────────────────
expect('Lychee Print', ['Multicolor'])        // "print" is real information; the shade is not
expect('clear', [])
expect('diamond', [])
expect('murph', [])
expect('', [])
expect('n/a', [])
expect(null, [])
expect(undefined, [])

// ── A set is capped, so one rambling string cannot file a piece under everything ──
checked++
const many = translateColorText('red, blue, green, yellow, pink, purple, orange')
if (many.length > 4) failures.push(`a single string produced ${many.length} colours; the cap is 4`)

// ── THE SAFETY CLAUSE ────────────────────────────────────────────────────────
const SCRIPT = 'scripts/backfill-color-families.mjs'
const src = fs.readFileSync(path.join(root, SCRIPT), 'utf8')
checked++
const writes = [...src.matchAll(/method:\s*'PATCH'/g)]
if (writes.length !== 1) failures.push(`${SCRIPT}: expected exactly 1 PATCH, found ${writes.length} — every write must carry the guard below.`)
checked++
if (!/id=in\.\(\$\{chunk\.join\(','\)\}\)&color_family=is\.null/.test(src)) {
  failures.push(
    `${SCRIPT}: the write no longer carries \`color_family=is.null\` in its WHERE clause.\n` +
    `      That clause is the ONLY thing stopping this from overwriting a colour a stylist or a\n` +
    `      client chose. There is no stylist-edit trace to fall back on.`)
}
checked++
if (!/const APPLY = process\.argv\.includes\('--apply'\)/.test(src) || !/if \(!APPLY\)/.test(src)) {
  failures.push(`${SCRIPT}: a dry run is no longer the default. Running it by accident would write to 20,000 live pieces.`)
}
checked++
if (!/console\.error\('FAIL: inspected nothing\.'\)/.test(src)) {
  failures.push(`${SCRIPT}: no longer fails when it inspects zero rows (ADR-0106).`)
}

console.log(`colour translation: ${checked} assertions replayed through translateColorText + ${SCRIPT}`)
if (checked === 0) { console.error('FAIL: the guard inspected nothing.'); process.exit(1) }
if (failures.length) {
  console.error(`\nFAIL (${failures.length}):`)
  for (const f of failures) console.error(`  • ${f}`)
  process.exit(1)
}
console.log('OK: the dictionary answers as specified, refuses what it does not know, and the backfill can only touch blanks.')
