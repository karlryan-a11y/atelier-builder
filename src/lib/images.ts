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
}

export function resolveItemImage(item: ClosetItem): string | null {
  return item.raw?.processed_image ?? item.raw?.image ?? item.raw?.images?.[0] ?? null
}

const S3_HOST = 'https://goodpix-co.s3.amazonaws.com/'

export function proxyImageUrl(url: string): string {
  if (url.startsWith(S3_HOST)) {
    return '/img-proxy/' + url.slice(S3_HOST.length)
  }
  return url
}
