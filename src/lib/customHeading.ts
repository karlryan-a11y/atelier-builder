// The heading over a client's own categories (Bag, Casual, Ski...) on her lookbook's Collection
// sidebar and in her Edit details picker. It says "Custom" unless a stylist names it for this
// client in Categorize > Nesting (Cynthia for Keil Cadieux, 11/04).
//
// Stored in gp_clients.raw.custom_heading. The lookbook reads it with the twin of this file,
// atelier-looks src/lib/customHeading.ts (scripts/check-custom-heading.mjs keeps them in step).

export const DEFAULT_CUSTOM_HEADING = 'Custom'
export const CUSTOM_HEADING_MAX = 40

/** A typed name, tidied: spaces collapsed, capped. Empty means "use Custom". */
export function cleanCustomHeading(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, CUSTOM_HEADING_MAX).trim()
}

/** The name a stylist saved for this client, or '' when she still gets "Custom". */
export function savedCustomHeading(raw: unknown): string {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return cleanCustomHeading(r.custom_heading)
}

/** Her raw with the heading set, or taken off (an empty name puts "Custom" back). Nothing else moves. */
export function withCustomHeading(raw: unknown, name: string): Record<string, unknown> {
  const out = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}
  const clean = cleanCustomHeading(name)
  if (clean && clean !== DEFAULT_CUSTOM_HEADING) out.custom_heading = clean
  else delete out.custom_heading
  return out
}
