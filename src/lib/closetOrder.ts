/**
 * The order a client's Collection is shown in.
 *
 * 1. Most recently changed-or-added first — the order GoodPix shows the same
 *    closet in, and the one the team has read for years.
 * 2. Ties break on id, so paging is stable.
 *
 * `display_order` is deliberately NOT consulted. ADR-0118 first let it win as "the
 * stylist's arrangement", but no surface has ever written a stylist's arrangement to
 * it: the only writer is the GoodPix sync, which copies GoodPix's own `order` field —
 * 0 on 5,600 pieces across 112 clients. On 2026-09-14 Holly McClellan's 69 zero-ordered
 * pieces pinned themselves to page 1 and the 35 pieces Cynthia added on Friday sat
 * behind them: 45 of 48 tiles from the oldest quarter of her wardrobe, the exact
 * defect this file was written to end. When an arrange tool for the Collection is
 * built, give it its own column and reintroduce it here; do not reuse this one.
 *
 * Why this is computed here and not in the SQL ORDER BY: the recency of a piece
 * lives in a different column depending on where it came from. A GoodPix piece
 * has `last_modified` (always) and a piece digitized through Atelier has only
 * `added_at` (`last_modified` is null on every one of them). An ORDER BY on either
 * column alone sinks the other kind to the bottom of the wardrobe, below the
 * oldest imports — which for the clients who upload through Atelier is exactly
 * the wrong end. Both columns are on the lean row; the merge happens in memory,
 * where the whole wardrobe already is.
 *
 * Before this existed the fallback was `id ascending`, and `display_order` is null
 * on every GoodPix-sourced piece on the platform. Cynthia Lippe's Collection
 * opened on 48 of 48 pieces from a 2019 bulk import; what she bought in August
 * was on page 23.
 */
export type ClosetOrderRow = {
  id: string;
  display_order: number | null;
  last_modified: string | null;
  added_at: string | null;
};

/** Epoch millis of the moment a piece last changed or, failing that, arrived. */
export function recencyOf(row: ClosetOrderRow): number | null {
  for (const v of [row.last_modified, row.added_at]) {
    if (!v) continue;
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

export function compareClosetRecency(a: ClosetOrderRow, b: ClosetOrderRow): number {
  const ar = recencyOf(a);
  const br = recencyOf(b);
  if (ar !== br) {
    if (ar == null) return 1;
    if (br == null) return -1;
    return br - ar;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortClosetByRecency<T extends ClosetOrderRow>(rows: T[]): T[] {
  return rows.sort(compareClosetRecency);
}

/**
 * NEXT PAGE STARTS AFTER THE LAST PIECE SHE SAW (ADR-0164).
 *
 * Pages were worked out fresh on every click, newest first. Anything added or edited while she was
 * paging moved to the top and pushed every later piece down one place, so the last piece of page 1
 * reappeared as the first of page 2 (Maegan's Prayer Book dress, 2026-09-24; promised fixed, not
 * fixed until now). A Next link now carries the last piece's place in the order, and the next page
 * begins with the first piece after it in today's order. A new piece goes above her and a moved
 * piece goes to page 1: neither can repeat.
 */
export function cursorOf(row: ClosetOrderRow): string {
  return `${recencyOf(row) ?? ''}~${row.id}`;
}

/** Index of the first row that sorts strictly after the cursor, or -1 if none / unreadable. */
export function startAfter<T extends ClosetOrderRow>(rows: T[], cursor: string | null | undefined): number {
  if (!cursor) return -1;
  const cut = cursor.lastIndexOf('~');
  if (cut < 0) return -1;
  const t = cursor.slice(0, cut);
  const id = cursor.slice(cut + 1);
  if (!id) return -1;
  if (t && Number.isNaN(Number(t))) return -1;
  // The order is not only newest first any more (a suit's pieces side by side, the stylist's own
  // order: lib/closetArrangement.ts), so the piece she saw last is found by its id. Only if it has
  // changed since (or gone) does the next page fall back to its place in time, as before.
  const seen = rows.findIndex((r) => r.id === id);
  if (seen >= 0 && String(recencyOf(rows[seen]) ?? '') === t) return seen + 1;
  const at = t ? new Date(Number(t)).toISOString() : null;
  const ghost: ClosetOrderRow = { id, display_order: null, last_modified: at, added_at: null };
  return rows.findIndex((r) => compareClosetRecency(ghost, r) < 0);
}
