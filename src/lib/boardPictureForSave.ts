import { useCanvasStore, exportCanvasImage, settleCanvasTransforms, unusablePhotoNodeIds, loadingPhotoNodeIds } from '@/stores/canvasStore'
import { reportBuilderError } from '@/lib/reportError'
import { waitForPhotos, inkCoverage, NEARLY_EMPTY_COVERAGE } from '@/lib/waitForPhotos'

/**
 * The picture a Save writes, or the reason it cannot be made. EVERY board save asks this first
 * (Save Look, Save as Capsule). ADR-0168.
 *
 * 2026-10-07: Holly McClellan's look "mh" saved with no picture. The board could not be exported
 * (a tainted photo), the export came back empty, and Save quietly wrote the look anyway. Now a
 * Save that cannot make its picture does not happen, and the stylist is told why, in her words,
 * with her board left exactly as it was.
 *
 * 2026-10-20: Peyton's London capsule saved while its photos were still loading, so the picture was
 * labels with no clothes. Now Save waits until every photo on the board has arrived, and refuses if
 * one has not after 20 seconds (ADR-0194).
 */
export type BoardPicture = { ok: true; base64: string } | { ok: false; message: string }

export async function boardPictureForSave(what: { kind: 'look' | 'capsule'; name: string }): Promise<BoardPicture> {
  if (useCanvasStore.getState().state.nodes.length === 0) {
    return { ok: false, message: 'This board is empty. Add a piece before saving.' }
  }

  // Every photo that will be in the picture must be drawn before the picture is taken. Read the
  // board fresh on each look: a piece removed while waiting is no longer waited for.
  const stillLoading = () => {
    const nodes = useCanvasStore.getState().state.nodes
    const onBoard = new Set(nodes.filter((n) => !(n.type === 'closet_item' && (n as { hidden?: boolean }).hidden)).map((n) => n.id))
    return loadingPhotoNodeIds().filter((id) => onBoard.has(id))
  }
  if (!(await waitForPhotos(stillLoading))) {
    const n = stillLoading().length
    reportBuilderError('save_blocked_photos_loading', `${n} photo(s) still loading after 20 s`, { kind: what.kind, name: what.name, nodeIds: stillLoading() })
    return {
      ok: false,
      message: `${n === 1 ? 'One photo is' : `${n} photos are`} still loading, so nothing was saved. Your board is still here. ` +
        'Wait until every piece shows its photo, then save again.',
    }
  }
  // One more frame, so the board has drawn the last photo that arrived.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

  // Settle right before the picture, so the picture and the saved state cannot disagree (see canvasStore).
  settleCanvasTransforms()

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
  flagIfNearlyEmpty(png, what)
  return { ok: true, base64: png.replace(/^data:image\/png;base64,/, '') }
}

/**
 * The safety net behind the wait (ADR-0194): a picture that comes out almost all white is recorded
 * in builder_errors, which the daily look-picture-guard reports to Karl. Never blocks the save:
 * a sparse look is allowed, it is just looked at.
 */
function flagIfNearlyEmpty(png: string, what: { kind: 'look' | 'capsule'; name: string }): void {
  const photos = useCanvasStore.getState().state.nodes
    .filter((n) => (n.type === 'closet_item' && !(n as { hidden?: boolean }).hidden) || n.type === 'picture').length
  if (photos === 0) return
  const img = new Image()
  img.onload = () => {
    try {
      const w = 400, h = Math.max(1, Math.round((img.height / img.width) * 400))
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const ctx = c.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0, w, h)
      const coverage = inkCoverage(ctx.getImageData(0, 0, w, h).data)
      if (coverage < NEARLY_EMPTY_COVERAGE) {
        reportBuilderError('save_picture_nearly_empty', `${what.kind} "${what.name}" saved with a picture ${(coverage * 100).toFixed(1)}% filled (${photos} photos on the board)`,
          { kind: what.kind, name: what.name, coverage, photos })
      }
    } catch { /* the check must never be the thing that breaks a save */ }
  }
  img.src = png
}
