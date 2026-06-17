export interface ClosetItem {
  id: string
  client_id: string
  name: string
  /** Stylist-set override; UI shows this in place of `name` when present. Scraper never writes it. */
  name_override?: string | null
  /** Stylist-only note pinned to this garment (e.g. "must be styled with heels"). */
  style_note?: string | null
  brand: string
  color: string | null
  content_tag_ids: string[]
  is_deleted: boolean
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
