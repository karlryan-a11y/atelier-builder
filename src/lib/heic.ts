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
  // Rename the output to .jpg. The pipeline + the upload validator treat a .heic/.heif FILENAME
  // as un-converted and reject it even when the BYTES are now JPEG — which silently bounced every
  // converted photo. The numeric part is preserved, so filename-order pairing is unaffected.
  const jpgName = file.name.replace(/\.hei[cf]$/i, '.jpg')
  // PRIMARY: server-side conversion (Node, reliable). The browser converter (heic2any) is
  // flaky on some HEIC variants — notably Drive-downloaded files — and strands whole batches.
  // The /api/heic-convert endpoint runs heic-convert on Node, which handles them cleanly.
  try {
    // Absolute URL to the builder's own deployment: when the app is served at
    // atelierbywatson.com/style/* a relative /api/* hits the apex (a different project) and
    // 307s, so we post to the builder alias directly. The endpoint sets CORS for this.
    const resp = await fetch('https://atelier-builder.vercel.app/api/heic-convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    })
    if (resp.ok) {
      const jpegBlob = await resp.blob()
      const small = await downscaleJpeg(jpegBlob)
      return new File([small], jpgName, { type: 'image/jpeg', lastModified: file.lastModified })
    }
  } catch (e) {
    console.error(`server HEIC convert failed for ${file.name}, falling back to browser`, e)
  }
  // FALLBACK: browser heic2any (kept for the rare case the endpoint is unreachable or the
  // file exceeds the serverless body limit).
  const { default: heic2any } = await import('heic2any')
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: QUALITY })
  const jpeg = Array.isArray(converted) ? converted[0] : converted
  const small = await downscaleJpeg(jpeg)
  return new File([small], file.name, { type: 'image/jpeg', lastModified: file.lastModified })
}

// Anything larger than this gets downscaled before upload. Camera/iPhone photos at full
// resolution (~12MP) reliably make the gpt-image-2 generation step fail, after which the cron
// re-fires the item FOREVER (a costly loop). The browser is the only place we can downscale
// safely — the Edge runtime OOMs on a 12MP decode — so we cap everything here.
const DOWNSCALE_OVER_BYTES = 1_200_000

// Prepare a list of files for upload: HEIC → JPEG (converted + downscaled), and any LARGE
// non-HEIC image → downscaled too. Filenames are preserved (pairing is by filename order).
// On a per-file failure we keep the original — the server then flags that one photo with a
// clear "please re-upload this one" rather than the whole batch crashing.
export async function ensureJpegFiles(files: File[]): Promise<File[]> {
  // Process SEQUENTIALLY — running multiple heic2any/libheif WASM decodes at once spikes
  // browser memory and is a likely cause of whole-batch conversion failures.
  const out: File[] = []
  for (const f of files) {
    if (isHeic(f)) {
      // Retry once — the WASM decode is occasionally flaky on the first attempt.
      let converted: File | null = null
      for (let attempt = 0; attempt < 2 && !converted; attempt++) {
        try {
          converted = await convertHeicToJpeg(f)
        } catch (e) {
          console.error(`HEIC→JPEG conversion failed for ${f.name} (attempt ${attempt + 1})`, e)
        }
      }
      out.push(converted ?? f)
    } else if (/^image\//.test(f.type) && f.size > DOWNSCALE_OVER_BYTES) {
      // Large non-HEIC image (e.g. a full-res JPEG from Google Drive) — downscale so it can't
      // OOM/loop the generation step. No heic2any here, just a canvas resize.
      try {
        const small = await downscaleJpeg(f)
        out.push(new File([small], f.name, { type: 'image/jpeg', lastModified: f.lastModified }))
      } catch (e) {
        console.error(`downscale failed for ${f.name}`, e)
        out.push(f)
      }
    } else {
      out.push(f)
    }
  }
  return out
}
