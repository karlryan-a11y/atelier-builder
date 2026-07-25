export interface ClosetItem {
  id: string
  client_id: string
  name: string
  /** Stylist-set override; UI shows this in place of `name` when present. Scraper never writes it. */
  name_override?: string | null
  /** Stylist-only note pinned to this garment (e.g. "must be styled with heels"). */
  style_note?: string | null
  /** Stylist garment-category override (Phase B). Wins over auto-detection; the
   *  lookbook Collection sidebar reads it. Scraper never writes it. */
  category?: string | null
  custom_categories?: string[] | null
  brand: string
  color: string | null
  /** Normalized primary/dominant color (palette term). Written by the pipeline + the Colors audit. */
  color_family?: string | null
  /** Additional colors beyond the primary (mirrors custom_categories). Effective set =
   *  dedupe([color_family, ...color_families]). May contain off-palette custom color names. */
  color_families?: string[] | null
  /** Vision color-audit verdict, surfaced in the Colors audit tab. */
  color_audit?: {
    suggested?: string; is_print?: boolean; confidence?: number; reason?: string
    flag?: boolean; priority?: 'print' | 'recolor' | 'neutral'; status?: string; applied?: string
  } | null
  content_tag_ids: string[]
  is_deleted: boolean
  /** Set when the client or stylist transitioned the piece out (no longer owned). NULL = still owned.
   *  Dedicated column — the scraper never writes it (unlike is_deleted). See migration 014. */
  transitioned_at?: string | null
  transition_reason?: string | null  // donated | sold | discarded | unspecified
  transition_source?: string | null  // client | stylist
  /** Fields the CLIENT set from their lookbook (subset of name/brand/category). Drives the
   *  "set by client" badge + the stylist "change anyway?" heads-up. See migration 015. */
  client_edited_fields?: string[] | null
  client_edited_at?: string | null
  /** Set when a stylist confirmed this piece against the Google Drive folder (verification sweep). */
  drive_verified_at?: string | null
  drive_verified_by?: string | null
  raw: {
    image?: string
    processed_image?: string
    images?: string[]
    description?: string
    [key: string]: unknown
  }
  primary_image_hash: string | null
  processed_image_hash: string | null
  source: string | null
  added_at: string | null
}

/** Effective display name: stylist override wins over the scraped name. */
export function displayName(item: Pick<ClosetItem, 'name' | 'name_override'>): string {
  return (item.name_override?.trim() || item.name) ?? ''
}

export function resolveItemImage(item: ClosetItem): string | null {
  // useClosetItems injects signed R2 URLs into raw.processed_image for intake items,
  // so this works for both GoodPix items (original URLs) and intake items (signed URLs).
  return item.raw?.processed_image ?? item.raw?.image ?? item.raw?.images?.[0] ?? null
}

const S3_HOST = 'https://goodpix-co.s3.amazonaws.com/'

export function proxyImageUrl(url: string): string {
  if (url.startsWith(S3_HOST)) {
    return '/img-proxy/' + url.slice(S3_HOST.length)
  }
  return url
}
