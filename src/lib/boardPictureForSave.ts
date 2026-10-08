import { useCanvasStore, exportCanvasImage, settleCanvasTransforms, unusablePhotoNodeIds } from '@/stores/canvasStore'
import { reportBuilderError } from '@/lib/reportError'

/**
 * The picture a Save writes, or the reason it cannot be made. EVERY board save asks this first
 * (Save Look, Save as Capsule). ADR-0168.
 *
 * 2026-10-07: Holly McClellan's look "mh" saved with no picture. The board could not be exported
 * (a tainted photo), the export came back empty, and Save quietly wrote the look anyway. Now a
 * Save that cannot make its picture does not happen, and the stylist is told why, in her words,
 * with her board left exactly as it was.
 */
export type BoardPicture = { ok: true; base64: string } | { ok: false; message: string }

export function boardPictureForSave(): BoardPicture {
  // Settle FIRST, so the picture and the saved state cannot disagree (see canvasStore).
  settleCanvasTransforms()

  if (useCanvasStore.getState().state.nodes.length === 0) {
    return { ok: false, message: 'This board is empty. Add a piece before saving.' }
  }

  // A hidden piece is off the picture (ADR-0146), so its photo cannot spoil it.
  const hidden = new Set(useCanvasStore.getState().state.nodes
    .filter((n) => n.type === 'closet_item' && (n as { hidden?: boolean }).hidden).map((n) => n.id))
  // ONLY pieces still on this board. The unusable list outlives a piece: removed, or left behind on
  // an earlier board this session, it kept blocking every later Save until a reload (review 10/8).
  const onBoard = new Set(useCanvasStore.getState().state.nodes.map((n) => n.id))
  const unusable = unusablePhotoNodeIds().filter((id) => onBoard.has(id) && !hidden.has(id))
  if (unusable.length > 0) {
    const n = unusable.length
    reportBuilderError('save_blocked_unusable_photo', `${n} piece(s) with no usable photo`, { nodeIds: unusable })
    return {
      ok: false,
      message: `${n === 1 ? 'One piece on this board has' : `${n} pieces on this board have`} no usable photo (the "Photo unavailable" box). ` +
        'Replace the photo in Edit item, or remove the piece, then save again. Nothing was saved, and your board is still here.',
    }
  }

  let png: string | null = null
  try {
    png = exportCanvasImage({ pixelRatio: 2 })
  } catch (err) {
    reportBuilderError('save_failed', err, { step: 'export' })
  }
  if (!png || !png.startsWith('data:image/png;base64,') || png.length < 200) {
    reportBuilderError('save_failed', 'board picture came out empty', { length: png?.length ?? 0 })
    return {
      ok: false,
      message: "The look's picture could not be made, so nothing was saved. Your board is still here. " +
        'Reload the page and save again. If it happens twice, tell Karl which client and look.',
    }
  }
  return { ok: true, base64: png.replace(/^data:image\/png;base64,/, '') }
}
