import { supabase } from '@/lib/supabase'
import { isFixedCategory, slugifyCategory } from '@/lib/garmentCategory'
import { resolveCategory } from '@/lib/categorize'

/**
 * The category an upload card's piece is filed under: the card's own category when it is one of
 * hers (her tree, her custom ones) or a standard one, else the standard category its words read as
 * ("Bottoms" is Pants). Empty when nothing fits, so the piece keeps reading its category from its
 * name, as it does today.
 */
export function uploadCategorySlug(cardCategory: string | null | undefined, pieceName: string, hers: Iterable<string> = []): string {
  const slug = slugifyCategory(cardCategory ?? '')
  if (!slug) return ''
  if (isFixedCategory(slug) || new Set(hers).has(slug)) return slug
  const read = resolveCategory({ name: `${cardCategory} ${pieceName}`, category: null }, [])
  return read === 'other' ? '' : read
}

/**
 * Approve on Needs Review > Uploads files the piece under the category on the card. (Paige Berndt,
 * 2026-11-11: categories picked while approving were not saving.) The approve function only takes a
 * category when the card was opened for editing, so 147 of 248 upload approvals in the 30 days before
 * had none. This runs after Approve: a category she picked is saved; a suggested one she left alone
 * is saved only when the piece has none, so nothing a person chose is overwritten.
 * `client_id` is in the filter so the write names its client (the preview tester lets demo writes through).
 */
export async function fileUploadCategory(intakeItemId: string, clientId: string, slug: string, picked: boolean) {
  if (!slug) return
  const { data: piece, error } = await supabase
    .from('gp_closet_items').select('id, category').eq('intake_item_id', intakeItemId).eq('client_id', clientId).maybeSingle()
  if (error || !piece) { console.error('fileUploadCategory: piece not found', intakeItemId, error?.message); return }
  if (piece.category === slug || (!picked && (piece.category ?? '').trim())) return
  const { data, error: e } = await supabase.from('gp_closet_items')
    .update({ category: slug }).eq('id', piece.id).eq('client_id', clientId).select('id')
  if (e || !data?.length) console.error('fileUploadCategory: not saved', piece.id, e?.message ?? 'no row came back')
}
