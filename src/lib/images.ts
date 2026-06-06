export interface ClosetItem {
  id: string
  client_id: string
  name: string
  brand: string
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

export function resolveItemImage(item: ClosetItem): string | null {
  // useClosetItems injects signed R2 URLs into raw.processed_image for intake items,
  // so this works for both GoodPix items (original URLs) and intake items (signed URLs).
  return item.raw?.processed_image ?? item.raw?.image ?? item.raw?.images?.[0] ?? null
}

const S3_HOST = 'https://goodpix-co.s3.amazonaws.com/'
const R2_HOST = 'https://images.atelierbywatson.com/'

// Route external image hosts through same-origin proxies so they load
// CORS-clean and never taint the Konva canvas (which would break toDataURL /
// look export). Both hosts are rewritten in vercel.json (builder + dashboard).
export function proxyImageUrl(url: string): string {
  if (url.startsWith(S3_HOST)) {
    return '/img-proxy/' + url.slice(S3_HOST.length)
  }
  if (url.startsWith(R2_HOST)) {
    return '/r2-img/' + url.slice(R2_HOST.length)
  }
  return url
}
