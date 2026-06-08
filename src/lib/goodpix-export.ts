/**
 * Export approved intake items as a GoodPix Bulk Closet Uploader .xlsx file.
 *
 * Image URLs point at the intake pipeline's public `image-proxy` Edge Function, which
 * streams the R2 object with the correct `image/*` content-type and permissive CORS.
 * These URLs are public and permanent (keyed by the stable R2 key), so the GoodPix
 * uploader and the in-sheet `=IMAGE()` preview can fetch them directly — no copy to a
 * separate Storage bucket is needed (that path required a client-side write the
 * `goodpix-exports` bucket had no RLS policy for, so every image came out blank).
 */

import * as XLSX from 'xlsx'
import { supabase } from './supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

interface ApprovedItem {
  id: string
  extracted_name: string | null
  extracted_brand: string | null
  extracted_category: string | null
  extracted_color: string | null
  ai_image_primary_r2_key: string | null
  garment_photo_id: string | null
}

/**
 * Build a public, permanent URL that streams an R2 object via the image-proxy Edge Function.
 */
function imageProxyUrl(r2Key: string): string {
  return `${SUPABASE_URL}/functions/v1/image-proxy?key=${encodeURIComponent(r2Key)}`
}

/**
 * Get the R2 key for an item's best image.
 */
async function getImageR2Key(item: ApprovedItem): Promise<string | null> {
  if (item.ai_image_primary_r2_key) return item.ai_image_primary_r2_key

  if (item.garment_photo_id) {
    const { data } = await supabase
      .from('intake_photos')
      .select('r2_key')
      .eq('id', item.garment_photo_id)
      .single()
    return data?.r2_key ?? null
  }

  return null
}

/**
 * Export all approved intake items for a client as a GoodPix-compatible .xlsx file.
 * Copies images to Supabase Storage for permanent public URLs.
 */
export async function exportGoodPixXlsx(
  clientId: string,
  clientName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const { data: items, error } = await supabase
    .from('intake_items')
    .select('id, extracted_name, extracted_brand, extracted_category, extracted_color, ai_image_primary_r2_key, garment_photo_id')
    .eq('client_id', clientId)
    .eq('status', 'approved')
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Failed to load approved items: ${error.message}`)
  if (!items || items.length === 0) throw new Error('No approved items to export')

  const total = items.length
  const rows: Array<Record<string, string>> = []
  let imagesResolved = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i] as ApprovedItem
    onProgress?.(i + 1, total)

    // Resolve the item's R2 key and point the spreadsheet at the public image-proxy URL.
    const r2Key = await getImageR2Key(item)
    const imageUrl = r2Key ? imageProxyUrl(r2Key) : ''
    if (imageUrl) imagesResolved++

    rows.push({
      'Image Preview': imageUrl ? `=IMAGE("${imageUrl}")` : '',
      'Image URL': imageUrl,
      'Name of Item': item.extracted_name ?? 'Untitled',
      'Brand': item.extracted_brand ?? 'Unknown',
      'Categories (separate by comma)': item.extracted_category ?? '',
      'Color': item.extracted_color ?? '',
      'Size': '',
      'Remove Image Background, Yes? (Leave blank if BG is already removed or unnecessary)': '',
      'Skip this one as it was added already, yes? (Leave blank to upload OR write YES if we should NOT add this one)': '',
    })
  }

  // None of the approved items resolved to an image — the spreadsheet would be useless.
  if (imagesResolved === 0) {
    throw new Error(
      `Export failed: none of the ${total} approved items have an image. No file was downloaded.`,
    )
  }

  // Create workbook
  const wb = XLSX.utils.book_new()
  const date = new Date().toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }).replace(/\//g, '')
  const sheetName = `${clientName.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 20)}-${date}`.slice(0, 31)
  const ws = XLSX.utils.json_to_sheet(rows)

  ws['!cols'] = [
    { wch: 15 },  // Image Preview
    { wch: 80 },  // Image URL
    { wch: 40 },  // Name
    { wch: 25 },  // Brand
    { wch: 30 },  // Categories
    { wch: 25 },  // Color
    { wch: 10 },  // Size
    { wch: 15 },  // Remove BG
    { wch: 15 },  // Skip
  ]

  XLSX.utils.book_append_sheet(wb, ws, sheetName)

  const filename = `GoodPix-Upload-${clientName.replace(/\s+/g, '-')}-${date}.xlsx`
  XLSX.writeFile(wb, filename)
}
