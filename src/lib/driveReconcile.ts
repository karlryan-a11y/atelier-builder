import type { DriveFile } from '@/lib/googleDrive'

// Drive drop-check: compare the files in a Google Drive folder against what we actually
// ingested for this client, and surface the DROPS — files in Drive that were never uploaded
// (no DB record). The reliable key is the FILENAME: every ingested photo kept its original
// filename (intake_photos.original_filename, 100% populated), and the original extension
// survives HEIC→JPEG conversion, so a basename match (extension stripped) is deterministic.
//   exact key = stored Drive file id (new uploads, zero ambiguity)
//   strong key = filename basename   (IMG_3157.HEIC ≡ IMG_3157.jpg)
// Byte-size is NOT used to confirm a match: the stored size is the post-conversion JPEG size,
// which differs from the Drive HEIC's size, so size-matching produced false results.

export interface UploadedFingerprint {
  driveFileId: string | null  // intake_photos.drive_file_id — EXACT origin (new uploads)
  filename: string | null
  size: number | null         // intake_photos.file_size_bytes (display only, not for matching)
  captureTime: string | null  // intake_photos.exif_timestamp (usually null on old uploads)
}

// 'exact' = matched on the stored Drive file id (new uploads). 'name' = filename basename match
// (the reliable key for older data that predates Drive-id capture).
export type DriveMatch = 'exact' | 'name' | 'none'

export interface DriveCheckRow {
  file: DriveFile
  match: DriveMatch
}
export interface DriveCheckResult {
  total: number
  matched: number      // exact + name
  drops: DriveFile[]   // match === 'none'
  rows: DriveCheckRow[]
}

// Basename: lowercased filename with the extension stripped, so HEIC→JPEG renames still match.
const baseKey = (n: string | null | undefined) => (n ?? '').trim().toLowerCase().replace(/\.[a-z0-9]+$/i, '')

export function checkDriveFolder(driveFiles: DriveFile[], uploaded: UploadedFingerprint[]): DriveCheckResult {
  const driveIds = new Set<string>()
  const bases = new Set<string>()
  for (const u of uploaded) {
    if (u.driveFileId) driveIds.add(u.driveFileId)
    const b = baseKey(u.filename)
    if (b) bases.add(b)
  }

  const rows: DriveCheckRow[] = driveFiles.map((file) => {
    let match: DriveMatch = 'none'
    if (driveIds.has(file.id)) match = 'exact'            // stored Drive file id — definitive
    else if (bases.has(baseKey(file.name))) match = 'name' // filename basename — reliable
    return { file, match }
  })

  const drops = rows.filter((r) => r.match === 'none').map((r) => r.file)
  return { total: driveFiles.length, matched: driveFiles.length - drops.length, drops, rows }
}
