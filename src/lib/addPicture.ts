/**
 * ADD AN IMAGE TO A LOOK. ADR-0171.
 *
 * Cynthia Dada, #watson-atelier, 2026-09-15, 09-23 and 10-01: "add an image of this scarf tied
 * around the waist but need to keep the item on the board invisible so it's still linked to this
 * look." Hiding the flat scarf shipped 9/23 (ADR-0146). This is the other half: her own photo on
 * the board.
 *
 * It lands as a PictureNode, the type that already carries GoodPix shop images (ADR-0127): drawn,
 * moved, resized, flipped and saved into the look's picture, and NEVER a piece. It is not in
 * closet_item_ids, not under "Pieces in this look", and a transition cannot pull a look because of
 * it. The hidden scarf stays the thing she shops.
 *
 * Storage: looks/pictures/<client>/<time>-<rand>.<ext> through upload-image (signed in, prefix
 * allowed). The node stores the permanent image-proxy URL like every other picture; r2KeyOf()
 * recovers the key for Remove background.
 */

import { ensureJpegFiles } from '@/lib/heic'
import { authHeader } from '@/lib/authHeader'
import { storedProxyUrl } from '@/lib/imageUrls'
import type { PictureNode } from '@/types/canvas'

/** Longest side a picture is stored at. Big enough for a full-board photo, small enough to upload fast. */
export const PICTURE_MAX_SIDE = 2000

/** Where an added picture is stored. The client folder keeps each client's pictures together. */
export function pictureKey(clientId: string | null | undefined, ext: 'png' | 'jpg', now = Date.now(), rand = Math.random().toString(36).slice(2, 8)): string {
  const folder = (clientId ?? '').replace(/[^A-Za-z0-9_-]/g, '') || 'unassigned'
  return `looks/pictures/${folder}/${now}-${rand}.${ext}`
}

/**
 * Where a new picture sits: centred, as tall as ~45% of the board (never upscaled past its own
 * pixels), and never wider than 80% of it. She resizes from there.
 */
export function fitPictureOnBoard(naturalW: number, naturalH: number, board: { width: number; height: number }) {
  const w0 = Math.max(1, naturalW)
  const h0 = Math.max(1, naturalH)
  let height = Math.min(board.height * 0.45, h0)
  let width = (w0 / h0) * height
  const maxW = board.width * 0.8
  if (width > maxW) { width = maxW; height = (h0 / w0) * width }
  return {
    width: Math.round(width),
    height: Math.round(height),
    x: Math.round((board.width - width) / 2),
    y: Math.round((board.height - height) / 2),
  }
}

/** True for files the board can take: images, including iPhone HEIC (often typed as empty). */
export function isPictureFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(file.name)
}

/** HEIC to JPEG, then down to PICTURE_MAX_SIDE. PNG/WebP keep their transparency as PNG. */
export async function preparePicture(file: File): Promise<{ base64: string; mime: 'image/png' | 'image/jpeg'; ext: 'png' | 'jpg'; width: number; height: number }> {
  const [ready] = await ensureJpegFiles([file])
  const keepAlpha = /png|webp/i.test(ready.type)
  const bitmap = await createImageBitmap(ready)
  const k = Math.min(1, PICTURE_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * k))
  const height = Math.max(1, Math.round(bitmap.height * k))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser could not read the picture.')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  const mime = keepAlpha ? 'image/png' : 'image/jpeg'
  const dataUrl = canvas.toDataURL(mime, 0.9)
  return { base64: dataUrl.split(',')[1] ?? '', mime, ext: keepAlpha ? 'png' : 'jpg', width, height }
}

/** Upload the prepared picture. Throws a sentence a stylist can read. */
export async function uploadPicture(file: File, clientId: string | null | undefined): Promise<{ key: string; url: string; width: number; height: number }> {
  const p = await preparePicture(file)
  const key = pictureKey(clientId, p.ext)
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ base64: p.base64, content_type: p.mime, key }),
  })
  if (!resp.ok) {
    throw new Error(resp.status === 401 ? 'Your sign-in has expired. Refresh the page and try again.' : `The picture didn't upload (${resp.status}). Try again.`)
  }
  return { key, url: storedProxyUrl(key), width: p.width, height: p.height }
}

/** The node for an uploaded picture, placed by fitPictureOnBoard, on top of everything. */
export function pictureNodeFor(url: string, naturalW: number, naturalH: number, board: { width: number; height: number }, zIndex: number): PictureNode {
  const box = fitPictureOnBoard(naturalW, naturalH, board)
  return {
    id: `pic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'picture',
    src: url,
    ...box,
    rotation: 0,
    flipped: false,
    z_index: zIndex,
    locked: false,
    product_id: null,
  }
}

/** Remove the background of an added picture. Returns the new URL, or throws a readable reason. */
export async function removePictureBackground(key: string): Promise<string> {
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/canvas-picture-remove-bg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ key }),
  })
  const d = await resp.json().catch(() => ({} as Record<string, unknown>))
  if (!resp.ok || !d?.ok || typeof d?.key !== 'string') {
    throw new Error((d?.reason as string) || (d?.error as string) || 'Could not remove the background.')
  }
  return storedProxyUrl(d.key as string)
}

/**
 * Upload each picture and put it on the board, selected, ready to move. Shared by the toolbar's
 * Add image and dropping a file on the board. Returns how many landed; a failure is said out loud.
 */
export async function addPictureFilesToBoard(files: File[], clientId: string | null | undefined): Promise<number> {
  const { useCanvasStore } = await import('@/stores/canvasStore')
  const pictures = files.filter(isPictureFile)
  if (pictures.length === 0) { window.alert('That file is not a picture. Use a JPG, PNG or iPhone photo.'); return 0 }
  let added = 0
  for (const file of pictures) {
    try {
      const up = await uploadPicture(file, clientId)
      const store = useCanvasStore.getState()
      const node = pictureNodeFor(up.url, up.width, up.height, store.state.canvas, store.state.nodes.length)
      store.addNode(node)
      store.setSelectedNodeIds([node.id])
      added++
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "The picture didn't upload. Try again.")
    }
  }
  return added
}
