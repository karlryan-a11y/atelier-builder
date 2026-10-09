/**
 * Dates on a look or a capsule (migration 041; Karl and Maegan, 2026-10-09). Calendar dates
 * ("2026-10-14"), no time or zone: a trip is Oct 14 to Oct 18 wherever she is. Twin of
 * atelier-looks src/lib/eventDates.ts: same wording on both sides.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const parts = (d: string) => { const [y, m, day] = d.split('-').map(Number); return { y, m, day } }

/** "Oct 14", "Oct 14–18", "Oct 30 – Nov 2", "Dec 30, 2026 – Jan 3, 2027". Empty when no date. */
export function formatEventDates(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return ''
  const a = parts(start)
  const one = `${MONTHS[a.m - 1]} ${a.day}`
  if (!end || end === start) return one
  const b = parts(end)
  if (a.y !== b.y) return `${one}, ${a.y} – ${MONTHS[b.m - 1]} ${b.day}, ${b.y}`
  if (a.m === b.m) return `${one}–${b.day}`
  return `${one} – ${MONTHS[b.m - 1]} ${b.day}`
}

/** Today as a calendar date in Central time, the team's clock. */
export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Over: its last day is before today. A look with one date is over the day after. */
export function isEventPast(start: string | null | undefined, end: string | null | undefined, today = todayISO()): boolean {
  const last = end || start
  return !!last && last < today
}
