// Reconciliation logic — the "check and balance" that cross-references, for each
// item in a client's live collection, the ORIGINAL uploaded photo (the Google Drive
// file) against the AI photo that sits live on the lookbook today, plus its metadata.
//
// The match is image-to-image via the provenance chain, NOT filename-based:
//   gp_closet_items.original_garment_photo_r2_key  (the uploaded Drive photo)
//   gp_closet_items.processed_image_hash           (the AI photo live on the lookbook)
// paired on the same row, so a stylist can eyeball "yes, this AI render is that garment."
//
// Status is computed purely here (no I/O) so it's testable and deterministic.

export interface ReconRow {
  id: string
  client_id: string
  name: string
  name_override: string | null
  brand: string | null
  category: string | null
  /** The "Also in" groupings (ADR-0082). Fetched so the Audit editor can show and edit them —
   *  without it the shared dialog would open with an empty list and save the emptiness back. */
  custom_categories: string[] | null
  color: string | null
  style_note: string | null
  description: string | null
  source: string | null
  intake_item_id: string | null
  original_garment_photo_r2_key: string | null
  original_tag_photo_r2_key: string | null
  primary_image_hash: string | null
  processed_image_hash: string | null
  raw: Record<string, unknown>
  added_at: string | null
  reconciled_at: string | null
  /** The uploaded Google Drive photo (proxy URL), or null if we never stored an original. */
  originalUrl: string | null
  /** What's live on the lookbook today (AI photo / GoodPix product image, proxy URL). */
  liveUrl: string | null
}

export type ReconFlag = 'duplicate' | 'goodpix' | 'no_name' | 'no_brand' | 'no_original'
export type ReconPrimary = 'clean' | ReconFlag

export interface ReconStatus {
  primary: ReconPrimary
  flags: Set<ReconFlag>
  /** When duplicate: the key that's shared (intake_item_id, original photo, or dup_group). */
  dupKey?: string
  /** How many rows share that dupKey (incl. this one). */
  dupCount?: number
  /** For persisted cross-provenance duplicates (the CLIP+vision scan): keep the good copy,
   *  remove the other, or review a lower-confidence pair by eye. */
  dupRole?: 'keep' | 'remove' | 'review'
  /** Why the scan flagged this as a duplicate (shown on the card). */
  dupReason?: string
  /** Scan confidence label, e.g. "High", "Medium-High", "Review". */
  dupConfidence?: string
}

const NAME_PLACEHOLDERS = new Set(['', 'unknown', 'unknown item', 'untitled', 'untitled item', 'item', 'no name'])

// Coerce any DB value to a trimmed string — guards against non-string JSON (arrays,
// numbers) that the TS types claim are strings but aren't at runtime.
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim()

export function effectiveName(r: Pick<ReconRow, 'name' | 'name_override'>): string {
  return str(r.name_override) || str(r.name)
}

export function isMissingName(r: ReconRow): boolean {
  return NAME_PLACEHOLDERS.has(effectiveName(r).toLowerCase())
}

export function isMissingBrand(r: ReconRow): boolean {
  const b = str(r.brand).toLowerCase()
  return b === '' || b === 'unknown'
}

const isIntake = (r: ReconRow) => r.source === 'intake_pipeline'

/** Whether the metadata-recovery action can run (needs a provenance link to intake_items). */
export function canRecover(r: ReconRow): boolean {
  return isIntake(r) && !!r.intake_item_id && (isMissingName(r) || isMissingBrand(r))
}

/**
 * Compute a status for every row. Duplicates are detected two ways — two closet items
 * built from the same intake_item (approve-twice), or two items pointing at the same
 * uploaded original photo — both are real "this shouldn't exist twice" cases.
 */
const dupGroupOf = (r: ReconRow): string => str((r.raw as Record<string, unknown>)?.dup_group)

export function computeStatuses(rows: ReconRow[]): Map<string, ReconStatus> {
  const byIntakeItem = new Map<string, number>()
  const byOriginal = new Map<string, number>()
  // Cross-provenance duplicates found by the CLIP+vision scan don't share an intake_item_id
  // or an original photo (that's exactly why the two rules above miss them — a GoodPix copy
  // and a digitized copy of the same garment have totally different provenance). They're
  // persisted as raw.dup_group so a whole family lines up here.
  const byDupGroup = new Map<string, number>()
  for (const r of rows) {
    if (r.intake_item_id) byIntakeItem.set(r.intake_item_id, (byIntakeItem.get(r.intake_item_id) ?? 0) + 1)
    if (r.original_garment_photo_r2_key) {
      byOriginal.set(r.original_garment_photo_r2_key, (byOriginal.get(r.original_garment_photo_r2_key) ?? 0) + 1)
    }
    const g = dupGroupOf(r)
    if (g) byDupGroup.set(g, (byDupGroup.get(g) ?? 0) + 1)
  }

  const out = new Map<string, ReconStatus>()
  for (const r of rows) {
    const flags = new Set<ReconFlag>()
    let dupKey: string | undefined
    let dupCount: number | undefined

    if (!isIntake(r)) flags.add('goodpix')
    if (isMissingName(r)) flags.add('no_name')
    if (isMissingBrand(r)) flags.add('no_brand')
    if (isIntake(r) && !r.originalUrl) flags.add('no_original')

    const iiCount = r.intake_item_id ? (byIntakeItem.get(r.intake_item_id) ?? 0) : 0
    const ogCount = r.original_garment_photo_r2_key ? (byOriginal.get(r.original_garment_photo_r2_key) ?? 0) : 0
    const g = dupGroupOf(r)
    const grpCount = g ? (byDupGroup.get(g) ?? 0) : 0
    if (iiCount > 1) { flags.add('duplicate'); dupKey = `ii:${r.intake_item_id}`; dupCount = iiCount }
    else if (ogCount > 1) { flags.add('duplicate'); dupKey = `og:${r.original_garment_photo_r2_key}`; dupCount = ogCount }
    else if (grpCount > 1) { flags.add('duplicate'); dupKey = `grp:${g}`; dupCount = grpCount }

    // Carry the scan's keep/remove verdict + reason onto the status for the card to show.
    const raw = r.raw as Record<string, unknown>
    const roleRaw = str(raw?.dup_role).toLowerCase()
    const dupRole = roleRaw === 'keep' || roleRaw === 'remove' || roleRaw === 'review' ? roleRaw : undefined
    const dupReason = str(raw?.dup_reason) || undefined
    const dupConfidence = str(raw?.dup_confidence) || undefined

    // Primary status by urgency: a duplicate is the most actionable, then a missing
    // identity (no name), then a lost original, then provenance (GoodPix), and finally
    // the soft "no brand" pass. Description is intentionally NOT flagged — it's empty
    // for every item, so it carries no signal.
    const primary: ReconPrimary =
      flags.has('duplicate') ? 'duplicate'
      : flags.has('no_name') ? 'no_name'
      : flags.has('no_original') ? 'no_original'
      : flags.has('goodpix') ? 'goodpix'
      : flags.has('no_brand') ? 'no_brand'
      : 'clean'

    out.set(r.id, { primary, flags, dupKey, dupCount, dupRole, dupReason, dupConfidence })
  }
  return out
}

// Sidebar/filter keys: 'all', 'clean', 'unreviewed', the live 'drive_drops', plus every
// flag. Filtering is by flag MEMBERSHIP, so an item can match several (e.g. No brand +
// Duplicate). drive_drops is rendered from the live Drive result, not from row flags.
export type FilterKey = 'all' | 'clean' | 'unreviewed' | 'drive_drops' | ReconFlag

export const FILTER_ORDER: { key: FilterKey; label: string; tone: 'good' | 'warn' | 'bad' | 'info' }[] = [
  { key: 'all', label: 'All', tone: 'info' },
  { key: 'clean', label: 'Clean', tone: 'good' },
  { key: 'duplicate', label: 'Duplicates', tone: 'bad' },
  { key: 'no_name', label: 'No name', tone: 'bad' },
  { key: 'no_original', label: 'No original', tone: 'warn' },
  { key: 'goodpix', label: 'GoodPix', tone: 'info' },
  { key: 'no_brand', label: 'No brand', tone: 'warn' },
  { key: 'unreviewed', label: 'Unreviewed', tone: 'info' },
]

export const FLAG_META: Record<ReconPrimary, { label: string; tone: 'good' | 'warn' | 'bad' | 'info' }> = {
  clean:       { label: 'Clean',       tone: 'good' },
  duplicate:   { label: 'Duplicate',   tone: 'bad'  },
  no_name:     { label: 'No name',     tone: 'bad'  },
  no_original: { label: 'No original', tone: 'warn' },
  goodpix:     { label: 'GoodPix',     tone: 'info' },
  no_brand:    { label: 'No brand',    tone: 'warn' },
}
