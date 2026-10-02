/**
 * The order of a client's look categories, as a stylist drags it in Categorize. (ADR-0162)
 *
 * Maegan Watson and Paige Berndt, #watson-atelier, 2026-10-01: "Is there a way we can move and
 * change the order of categories?" There was not. look_categories.sort_order is what her Looks
 * page orders its chips by (atelier-looks getLookCategories: sort_order, then label), and nothing
 * in the builder ever wrote it except createCategory appending to the end. Janet Foutty's order
 * was set by hand in SQL.
 *
 * THE RULE. The stylist sees and drags only her VISIBLE categories, so the visible ones take
 * positions 0..n-1 in the order she left them, and the hidden ones follow after in the order
 * they already had. Writing a position for every row, hidden ones included, is deliberate:
 * stored sort_orders are full of ties today (Janet had three at 0 and two at 20), ties fall
 * back to the label, and a drag that wrote only the moved row would land it among ties and
 * come back alphabetical. After a drag, a category she unhides comes back at the bottom,
 * which is where a stylist looks for it.
 */

export interface OrderableCategory {
  id: string
  is_hidden?: boolean | null
  sort_order?: number | null
  label?: string | null
}

/** Her categories in the order she sees them: sort_order, then label. Same as her Looks page. */
export function byCategoryOrder(a: OrderableCategory, b: OrderableCategory): number {
  const x = a.sort_order ?? 0
  const y = b.sort_order ?? 0
  if (x !== y) return x - y
  return (a.label ?? '').localeCompare(b.label ?? '')
}

/**
 * Every category id, in the order to save, after moving `activeId` to where `overId` was among
 * the visible ones. Returns null when nothing would change (dropped on itself, an unknown id,
 * or a hidden one), so the caller writes nothing.
 */
export function planCategoryOrder(
  categories: OrderableCategory[],
  activeId: string,
  overId: string,
): string[] | null {
  if (activeId === overId) return null
  const sorted = [...categories].sort(byCategoryOrder)
  const visible = sorted.filter((c) => !c.is_hidden).map((c) => c.id)
  const hidden = sorted.filter((c) => c.is_hidden).map((c) => c.id)
  const from = visible.indexOf(activeId)
  const to = visible.indexOf(overId)
  if (from < 0 || to < 0) return null
  const next = [...visible]
  next.splice(from, 1)
  next.splice(to, 0, activeId)
  return [...next, ...hidden]
}
