#!/usr/bin/env node
/**
 * Category reorder guard. (ADR-0162)
 *
 * Maegan Watson and Paige Berndt asked on 2026-10-01 whether stylists can change the order of a
 * client's categories. They could not: nothing in the builder wrote look_categories.sort_order
 * except createCategory appending to the end, so Janet Foutty's order was set by hand in SQL.
 *
 * This holds three things:
 *   1. planCategoryOrder moves a visible category to where it was dropped, keeps every hidden
 *      one after the visible ones, writes a position for every row (ties are common, and a tie
 *      falls back to the label, which would undo the drag), and writes nothing on a no-op.
 *   2. The hook saves through look_categories.sort_order and asks each row back, because an
 *      update RLS declines is a 200 with no rows: without .select a refused save looks saved.
 *   3. The rail renders the grip and calls the planner, so the feature cannot quietly drop off
 *      the screen while the function still passes.
 *
 * Fails on the code before ADR-0162 (no src/lib/categoryOrder.ts, no reorderCategories, no grip).
 */
import { readFileSync, existsSync } from 'node:fs'

let checked = 0
const failures = []
const ok = (cond, msg) => { checked++; if (!cond) failures.push(msg) }

const libPath = new URL('../src/lib/categoryOrder.ts', import.meta.url)
if (!existsSync(libPath)) {
  console.error('check-category-reorder: FAIL - src/lib/categoryOrder.ts does not exist, so stylists cannot reorder categories')
  process.exit(1)
}
const { planCategoryOrder, byCategoryOrder } = await import('../src/lib/categoryOrder.ts')

// Janet Foutty as she was on 2026-10-01: ties at 0 and 20, one hidden.
const janet = [
  { id: 'dinner', label: 'Dinner & Theater', sort_order: 0 },
  { id: 'event', label: 'Event', sort_order: 0 },
  { id: 'holiday', label: 'Holiday', sort_order: 0 },
  { id: 'speaking', label: 'Speaking & Panel', sort_order: 16 },
  { id: 'office', label: 'Office Casual', sort_order: 20 },
  { id: 'travel', label: 'Travel', sort_order: 20 },
  { id: 'colorado', label: 'Colorado', sort_order: 0, is_hidden: true },
]
const seen = () => [...janet].sort(byCategoryOrder).filter((c) => !c.is_hidden).map((c) => c.id).join(',')
ok(seen() === 'dinner,event,holiday,speaking,office,travel', `the rail order does not match her Looks page (sort_order, then label): ${seen()}`)

// Drag the last visible one to the top.
let plan = planCategoryOrder(janet, 'travel', 'dinner')
ok(Array.isArray(plan), 'dragging Travel onto Dinner & Theater planned nothing')
if (plan) {
  ok(plan.join(',') === 'travel,dinner,event,holiday,speaking,office,colorado', `drag to top gave ${plan.join(',')}`)
  ok(plan.length === janet.length, `plan has ${plan.length} rows, expected every category (${janet.length}) so ties cannot fall back to the label`)
  ok(plan[plan.length - 1] === 'colorado', 'a hidden category was not kept after the visible ones')
}

// Drag the first one down to the bottom of the visible list.
plan = planCategoryOrder(janet, 'dinner', 'travel')
ok(plan && plan.join(',') === 'event,holiday,speaking,office,travel,dinner,colorado', `drag to bottom gave ${plan && plan.join(',')}`)

// Applying the plan as sort_order and re-sorting reproduces exactly the dragged order: the whole
// point, since her Looks page sorts by sort_order then label.
if (plan) {
  const applied = janet.map((c) => ({ ...c, sort_order: plan.indexOf(c.id) }))
  const after = applied.sort(byCategoryOrder).filter((c) => !c.is_hidden).map((c) => c.id).join(',')
  ok(after === 'event,holiday,speaking,office,travel,dinner', `saved order reads back as ${after}`)
}

// No-ops write nothing.
ok(planCategoryOrder(janet, 'office', 'office') === null, 'dropping a category on itself still planned a write')
ok(planCategoryOrder(janet, 'nope', 'office') === null, 'an unknown id planned a write')
ok(planCategoryOrder(janet, 'colorado', 'office') === null, 'a hidden category could be dragged')

// The hook writes sort_order and reads each row back.
const hook = readFileSync(new URL('../src/hooks/useLookCategories.ts', import.meta.url), 'utf8')
const fn = hook.slice(hook.indexOf('const reorderCategories'), hook.indexOf('const reorderCategories') + 1400)
ok(hook.includes('const reorderCategories'), 'useLookCategories has no reorderCategories')
ok(/from\('look_categories'\)\.update\(\{ sort_order: i \}\)/.test(fn), 'reorderCategories does not write look_categories.sort_order')
ok(/\.select\('id'\)/.test(fn), 'reorderCategories does not ask the rows back, so a refused save would look saved')
ok(/return false/.test(fn), 'reorderCategories never reports a failed save')
ok(/reorderLooks, reorderCapsules, reorderCategories/.test(hook), 'reorderCategories is not returned from the hook')

// The rail renders it.
const panel = readFileSync(new URL('../src/components/categorize/CategorizePanel.tsx', import.meta.url), 'utf8')
ok(panel.includes('<CategorySortList') && panel.includes('<SortableCategoryRow'), 'the category rail does not render the sortable list')
ok(panel.includes('{grip}'), 'the category rows do not show the drag grip')
ok(/planCategoryOrder\(categories, activeId, overId\)/.test(panel), 'the rail does not use planCategoryOrder')
ok(/didn't save/.test(panel), 'a refused category order is silent')
const sortable = readFileSync(new URL('../src/components/categorize/CategorySortable.tsx', import.meta.url), 'utf8')
ok(/touch-none/.test(sortable) && /TouchSensor/.test(sortable), 'the grip will not drag on an iPad (no TouchSensor / touch-none)')
ok(!/[—]/.test(sortable.match(/aria-label="[^"]*"|title="[^"]*"/g)?.join('') ?? ''), 'stylist-facing copy on the grip has an em dash')

if (failures.length) {
  console.error(`check-category-reorder: FAIL (${failures.length} of ${checked})`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log(`check-category-reorder: ok (${checked} assertions: planner on Janet Foutty's real order, hook save + read-back, rail wiring)`)
