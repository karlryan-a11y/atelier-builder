/**
 * Export approved intake items as a GoodPix Bulk Closet Uploader .xlsx file.
 * Images are copied to Supabase Storage (public bucket) for permanent URLs.
 */

import * as XLSX from 'xlsx'
import { supabase } from './supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const STORAGE_BUCKET = 'goodpix-exports'

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
 * Get a temporary signed R2 URL to fetch the image from R2.
 */
async function getSignedR2Url(r2Key: string): Promise<string | null> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/intake-signed-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: [r2Key], expires_in: 900 }),
    })
    if (resp.ok) {
      const data = await resp.json()
      return data.urls?.[r2Key] ?? null
    }
  } catch {}
  return null
}

/**
 * Copy an image from R2 to Supabase Storage (public bucket) and return the permanent URL.
 */
async function copyToPublicStorage(r2Key: string, clientName: string): Promise<string | null> {
  // Get temporary signed URL from R2
  const signedUrl = await getSignedR2Url(r2Key)
  if (!signedUrl) return null

  // Fetch the image
  const resp = await fetch(signedUrl)
  if (!resp.ok) return null
  const blob = await resp.blob()

  // Generate a clean path in the public bucket
  const ext = r2Key.endsWith('.png') ? 'png' : 'jpg'
  const cleanClient = clientName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
  const filename = r2Key.split('/').pop() ?? `image-${Date.now()}.${ext}`
  const storagePath = `${cleanClient}/${filename}`

  // Upload to Supabase Storage
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, blob, {
      contentType: `image/${ext}`,
      upsert: true,
    })

  if (error) {
    console.error('Storage upload failed:', error.message)
    return null
  }

  // Return the permanent public URL
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath)
  return data.publicUrl
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

  for (let i = 0; i < items.length; i++) {
    const item = items[i] as ApprovedItem
    onProgress?.(i + 1, total)

    // Get the R2 key, then copy to permanent public storage
    const r2Key = await getImageR2Key(item)
    let imageUrl = ''
    if (r2Key) {
      const publicUrl = await copyToPublicStorage(r2Key, clientName)
      imageUrl = publicUrl ?? ''
    }

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
