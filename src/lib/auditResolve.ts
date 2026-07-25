// Per-client record of Drive photos a stylist has REVIEWED and dismissed from the gap list —
// either "it's already in the lookbook" or "it's a tag / not a garment". Persisted so re-running
// the audit never resurfaces a photo someone already cleared, which is what lets the audit reach
// a finished state. Stored in localStorage (per-browser) for now; can be promoted to a shared
// table later without changing callers.

export type ResolveReason = 'in_lookbook' | 'tag' | 'dismissed'
type Entry = { id: string; base: string; reason: ResolveReason }

const KEY = (clientId: string) => `atelier-audit-resolved:${clientId}`
const baseKey = (n: string | null | undefined) => (n ?? '').trim().toLowerCase().replace(/\.[a-z0-9]+$/i, '')

function read(clientId: string): Entry[] {
  try { const v = JSON.parse(localStorage.getItem(KEY(clientId)) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}

export interface ResolvedSet { ids: Set<string>; bases: Set<string>; count: number }

export function getResolved(clientId: string): ResolvedSet {
  const e = read(clientId)
  return { ids: new Set(e.map((x) => x.id).filter(Boolean)), bases: new Set(e.map((x) => x.base).filter(Boolean)), count: e.length }
}

// A Drive file counts as resolved if its id OR its filename basename was cleared — basename too,
// so the same photo re-exported under a new Drive id still stays dismissed.
export function isResolved(r: ResolvedSet, f: { id: string; name: string }): boolean {
  return r.ids.has(f.id) || r.bases.has(baseKey(f.name))
}

export function addResolved(clientId: string, files: { id: string; name: string }[], reason: ResolveReason): void {
  const e = read(clientId)
  const have = new Set(e.map((x) => x.id))
  for (const f of files) if (!have.has(f.id)) { e.push({ id: f.id, base: baseKey(f.name), reason }); have.add(f.id) }
  try { localStorage.setItem(KEY(clientId), JSON.stringify(e)) } catch { /* quota / private mode — non-fatal */ }
}

export function clearResolved(clientId: string): void {
  try { localStorage.removeItem(KEY(clientId)) } catch { /* ignore */ }
}
