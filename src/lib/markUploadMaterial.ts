import { supabase } from '@/lib/supabase'
import { withMaterialConfirmed } from '@/lib/materialConfirmed'
import { saveEditedFields } from '@/lib/saveEditedFields'

/**
 * An upload card was just approved with a Material a person typed: the piece now exists, and its
 * Material and tag read are the same words, so mark it as entered (lib/materialConfirmed). The piece
 * is already posted by now, so a failure here is logged rather than stopping the approval.
 */
export async function markUploadMaterial(intakeItemId: string, typed: string) {
  const { data: piece, error } = await supabase
    .from('gp_closet_items').select('id, client_id, material').eq('intake_item_id', intakeItemId).maybeSingle()
  if (error || !piece) { console.error('markUploadMaterial: piece not found', intakeItemId, error?.message); return }
  if ((piece.material ?? '').trim() !== typed.trim()) return
  const r = await saveEditedFields(piece.id, piece.client_id, (now) => withMaterialConfirmed(now, true))
  if ('error' in r) console.error('markUploadMaterial: not saved', piece.id, r.error)
}
