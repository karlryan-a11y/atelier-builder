/**
 * The order a category dropdown offers its choices in. (Karl, 2026-10-07)
 *
 * Chris Cadieux's pieces are shirts, jackets, shoes, pants, denim, sweaters, belts, a tie, a hat,
 * shorts and a vest, and every category dropdown still opened on Dresses, Tops, Skirts... then
 * Jewelry, Handbags, Swim. Picking one by mistake is how a man's account grows a Dresses category.
 *
 * Her own categories come first, under "Her categories": the fixed ones her pieces already use
 * plus her custom ones. Everything else follows under "More categories". Nothing is removed, so a
 * stylist can still file anything anywhere. A client with no categories yet sees the plain list.
 *
 * KEEP IN STEP WITH THE TWIN: atelier-looks src/lib/categoryChoices.ts.
 */
import { CATEGORY_LABELS } from '@/lib/categorize'

export interface CategoryChoice { slug: string; label: string }

const FIXED: CategoryChoice[] = (Object.entries(CATEGORY_LABELS) as [string, string][])
  .filter(([slug]) => slug !== 'other')
  .map(([slug, label]) => ({ slug, label }))

export function splitCategoryChoices(
  custom: CategoryChoice[],
  used: Set<string> | null | undefined,
): { grouped: boolean; mine: CategoryChoice[]; more: CategoryChoice[] } {
  const customSlugs = new Set(custom.map((c) => c.slug))
  const fixedNotCustom = FIXED.filter((f) => !customSlugs.has(f.slug))
  if (!used || used.size === 0) return { grouped: false, mine: custom, more: fixedNotCustom }
  const mine = [...fixedNotCustom.filter((f) => used.has(f.slug)), ...custom]
    .sort((a, b) => a.label.localeCompare(b.label))
  const more = fixedNotCustom.filter((f) => !used.has(f.slug))
  return { grouped: true, mine, more }
}
