import { supabase } from '@/lib/supabase'

/**
 * The client list every builder picker reads (ADR-0122).
 *
 * `client_directory()` (migration 023) returns each client with a `note` and a
 * `badge` whenever another client has the same or a near-identical name, so a
 * stylist can tell Holly McClellan (558 pieces, 285 looks) from the empty
 * "Holly Klus McClellan" shell beside her. The wording and the matching rule live
 * in that one database function, which the dashboard's Client Lookbooks list reads
 * too, so render `note` and `badge` as they arrive. Do not rebuild them here.
 *
 * Pickers on this function: layout/ClientBar.tsx (via useClients) and the Digitize
 * upload picker in intake/IntakeInbox.tsx.
 */
export interface ClientEntry {
  id: string
  name: string
  /** e.g. "558 pieces · 285 looks · 22 capsules · updated Sep 15, 2026". Null when she has no twin. */
  note: string | null
  /** "Most looks" | "Most pieces" | "Most recent" | "Kept separate" | null */
  badge: string | null
}

export async function fetchClientDirectory(): Promise<ClientEntry[]> {
  const { data, error } = await supabase.rpc('client_directory')
  if (!error && Array.isArray(data)) {
    return (data as ClientEntry[]).map((c) => ({ id: c.id, name: c.name, note: c.note ?? null, badge: c.badge ?? null }))
  }
  // A picker that cannot open blocks every screen behind it, so fall back to the plain
  // list (no notes) and say so loudly rather than rendering nothing.
  console.error('[clientDirectory] client_directory() failed; picker shows names without duplicate notes', error)
  const { data: plain } = await supabase.from('clients').select('id, name').order('name')
  return (plain ?? []).map((c) => ({ id: c.id, name: c.name, note: null, badge: null }))
}
