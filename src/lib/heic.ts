// HEIC → JPEG conversion for digitization uploads.
//
// Chrome/Edge can't decode HEIC, and neither Claude (metadata) nor OpenAI (image gen)
// accept HEIC — so any HEIC file that reaches the AI pipeline silently fails and lands
// blank in "Needs Review". iPhone photos are HEIC by default, and the Google Drive import
// preserves the original HEIC bytes, which is exactly how a whole batch got stranded.
//
// We convert HEIC → JPEG in the browser at the single upload chokepoint (`getChunkFiles`
// in runPipeline), so this covers BOTH the local picker and the Google Drive import.
// Outputs are downscaled so they stay under the Edge Function's memory limit (large
// full-res JPEGs were causing WORKER_RESOURCE_LIMIT).

const MAX_DIM = 1600 // long-edge cap — plenty for metadata + 1024px image gen
const QUALITY = 0.82

export function isHeic(file: File): boolean {
  return (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    /\.hei[cf]$/i.test(file.name)
  )
}

// Downscale an image blob to <= MAX_DIM on the long edge, re-encode as JPEG.
async function downscaleJpeg(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('image decode failed'))
      el.src = url
    })
    const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('canvas toBlob failed'))),
        'image/jpeg',
        QUALITY,
      ),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Convert one HEIC File → a downscaled JPEG File. The filename is preserved on purpose:
// the pipeline pairs item→tag by filename order, so the name must not change (only the
// bytes + MIME type do). heic2any is dynamically imported so its wasm stays out of the
// main bundle until a HEIC is actually encountered.
export async function convertHeicToJpeg(file: File): Promise<File> {
  const { default: heic2any } = await import('heic2any')
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: QUALITY })
  const jpeg = Array.isArray(converted) ? converted[0] : converted
  const small = await downscaleJpeg(jpeg)
  return new File([small], file.name, { type: 'image/jpeg', lastModified: file.lastModified })
}

// Convert any HEIC files in a list to JPEG; pass everything else through unchanged.
// On a per-file failure we keep the original (the pipeline will flag that one item rather
// than the whole batch crashing).
export async function ensureJpegFiles(files: File[]): Promise<File[]> {
  if (!files.some(isHeic)) return files
  return Promise.all(
    files.map(async (f) => {
      if (!isHeic(f)) return f
      try {
        return await convertHeicToJpeg(f)
      } catch (e) {
        console.error('HEIC→JPEG conversion failed for', f.name, e)
        return f
      }
    }),
  )
}
