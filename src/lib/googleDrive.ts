// Google Drive folder picker + just-in-time photo download for the Digitization upload.
//
// Stylists keep client photos in their own @watsonstylegroup.com Drive. This lets
// them sign in with that account, pick a folder via the Google Picker, and digitize
// its photos — reusing the exact same intake-upload pipeline as local files.
//
// Gated entirely behind two env vars (see isGoogleDriveConfigured). When they're
// absent the Drive button never renders, so this code is inert until configured.
//
// OAuth consent screen should be set to **Internal** (Workspace-only) so the
// drive.readonly scope works with no Google app-verification review.

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined
// Optional Cloud project number — improves Picker behavior but not required for drive.readonly.
const APP_ID = import.meta.env.VITE_GOOGLE_APP_ID as string | undefined

// Read-only access to the user's Drive. Needed (vs. the narrower drive.file) so we
// can enumerate the contents of a folder the stylist picks.
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const GAPI_SRC = 'https://apis.google.com/js/api.js'

export function isGoogleDriveConfigured(): boolean {
  return Boolean(CLIENT_ID && API_KEY)
}

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  size: number
}

export interface PickedFolder {
  id: string
  name: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any
    gapi?: any
  }
}

let scriptPromise: Promise<void> | null = null

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve()
      return
    }
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.defer = true
    el.onload = () => resolve()
    el.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(el)
  })
}

// Load the Google Identity Services + Picker libraries once, lazily.
async function ensureLoaded(): Promise<void> {
  if (!scriptPromise) {
    scriptPromise = (async () => {
      await Promise.all([loadScript(GIS_SRC), loadScript(GAPI_SRC)])
      await new Promise<void>((resolve, reject) => {
        if (!window.gapi) {
          reject(new Error('gapi failed to load'))
          return
        }
        window.gapi.load('picker', { callback: () => resolve(), onerror: () => reject(new Error('Picker failed to load')) })
      })
    })()
  }
  return scriptPromise
}

// One reusable GIS token client (GIS recommends reusing it across requests).
let tokenClient: any = null
// Cache the current access token so a multi-chunk batch reuses it and only
// re-prompts when it actually expires (~1h). Refreshed silently on 401.
let cachedToken: { value: string; expiresAt: number } | null = null

function initTokenClient(): any {
  if (tokenClient) return tokenClient
  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google Identity Services not available')
  }
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: () => {}, // assigned per-request below
  })
  return tokenClient
}

// Pop the Google sign-in consent and return a short-lived OAuth access token.
//
// interactive=true forces the account chooser (`prompt: 'select_account'`) so a
// stylist on a shared/multi-login browser explicitly picks their @watsonstylegroup.com
// account — picking a personal account silently is a common cause of cryptic failures
// (it's not on the Internal consent screen). interactive=false attempts a SILENT
// refresh (no UI) for the mid-batch 401 path.
function requestAccessToken(opts: { interactive: boolean }): Promise<string> {
  return new Promise((resolve, reject) => {
    let client: any
    try {
      client = initTokenClient()
    } catch (e) {
      reject(e)
      return
    }
    client.callback = (resp: any) => {
      if (resp.error) {
        reject(new Error(resp.error_description || resp.error))
        return
      }
      const ttlMs = (Number(resp.expires_in) || 3600) * 1000
      // Expire 60s early so we refresh before Drive starts 401-ing mid-download.
      cachedToken = { value: resp.access_token, expiresAt: Date.now() + ttlMs - 60_000 }
      resolve(resp.access_token as string)
    }
    client.error_callback = (err: any) => reject(new Error(err?.message || 'Sign-in cancelled'))
    client.requestAccessToken({ prompt: opts.interactive ? 'select_account' : '' })
  })
}

// Return a valid access token, reusing the cached one when still fresh.
async function ensureAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value
  await ensureLoaded()
  return requestAccessToken({ interactive: true })
}

/**
 * Silently re-mint the access token mid-batch (called on a Drive 401 during a long
 * upload, where the ~1h token has expired). Falls back to an interactive prompt if
 * the silent grant fails (e.g. the GIS session is gone).
 */
export async function refreshAccessToken(): Promise<string> {
  await ensureLoaded()
  try {
    return await requestAccessToken({ interactive: false })
  } catch {
    return requestAccessToken({ interactive: true })
  }
}

/**
 * Validate the token + Drive API + account access BEFORE opening the Picker, so a
 * misconfig surfaces as a clear, actionable message instead of the Picker's opaque
 * "There was an error!" modal. Note: this does NOT validate the Picker's developerKey
 * / HTTP-referrer (only the Picker UI exercises that) — see runDriveDiagnostics.
 */
export async function preflightDriveAccess(accessToken: string): Promise<{ email?: string }> {
  let resp: Response
  try {
    resp = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch (e) {
    throw new Error(`Couldn't reach Google Drive (network error). ${e instanceof Error ? e.message : ''}`)
  }
  if (resp.status === 401) throw new Error('Your Google sign-in expired — click the Google Drive button again.')
  if (resp.status === 403) {
    const body = await resp.text().catch(() => '')
    throw new Error(
      `Google Drive refused access (403). The Drive API may be disabled for the project, or your account lacks access. ${body.slice(0, 160)}`,
    )
  }
  if (!resp.ok) throw new Error(`Google Drive preflight failed (${resp.status}).`)
  const json = await resp.json().catch(() => ({} as any))
  return { email: json?.user?.emailAddress }
}

interface PickedDoc {
  id: string
  name: string
  mimeType: string
  isFolder: boolean
}

// Open the Picker showing images + navigable folders. The stylist can either open a
// folder and select it, or multi-select individual photos. Image thumbnails are visible
// while browsing (so folders never look empty). Resolves with the picked docs, or null
// if cancelled.
function openPicker(accessToken: string): Promise<PickedDoc[] | null> {
  return new Promise((resolve, reject) => {
    const picker = window.google.picker
    if (!picker) {
      reject(new Error('Picker not loaded'))
      return
    }
    // Full Drive navigation: My Drive (all files + folders, navigable + folder-selectable),
    // plus Shared with me and Shared drives as separate tabs. Image thumbnails still render.
    const myDrive = new picker.DocsView(picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setParent('root')

    const sharedWithMe = new picker.DocsView(picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setOwnedByMe(false)

    const sharedDrives = new picker.DocsView(picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setEnableDrives(true)

    const builder = new picker.PickerBuilder()
      .addView(myDrive)
      .addView(sharedWithMe)
      .addView(sharedDrives)
      .setOAuthToken(accessToken)
      .setDeveloperKey(API_KEY)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setTitle('Select a folder or photos to digitize')
      .setCallback((data: any) => {
        const action = data[picker.Response.ACTION]
        if (action === picker.Action.PICKED) {
          const docs: PickedDoc[] = (data[picker.Response.DOCUMENTS] ?? []).map((d: any) => {
            const mimeType = d[picker.Document.MIME_TYPE]
            return {
              id: d[picker.Document.ID],
              name: d[picker.Document.NAME],
              mimeType,
              isFolder: mimeType === 'application/vnd.google-apps.folder',
            }
          })
          resolve(docs)
        } else if (action === picker.Action.CANCEL) {
          resolve(null)
        }
      })

    if (APP_ID) builder.setAppId(APP_ID)
    builder.build().setVisible(true)
  })
}

/**
 * Sign in (own Google account) and pick a folder or photos to digitize.
 * Expands any picked folders into their images, sorts everything by filename, and
 * returns the flat image list + a display name. Null if the stylist cancels.
 */
export async function signInAndPickPhotos(): Promise<{ accessToken: string; files: DriveFile[]; sourceName: string } | null> {
  await ensureLoaded()
  const accessToken = await ensureAccessToken()
  // Surface token/account/Drive-API problems cleanly before the Picker opens.
  await preflightDriveAccess(accessToken)
  const docs = await openPicker(accessToken)
  if (!docs || docs.length === 0) return null

  const files: DriveFile[] = []
  for (const doc of docs) {
    if (doc.isFolder) {
      files.push(...(await listImagesInFolder(doc.id, accessToken)))
    } else if (doc.mimeType?.startsWith('image/') || doc.name?.toLowerCase().endsWith('.heic')) {
      files.push({ id: doc.id, name: doc.name, mimeType: doc.mimeType || 'image/jpeg', size: 0 })
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))

  // Dedupe by id (a photo could be picked individually and via its folder)
  const seen = new Set<string>()
  const deduped = files.filter(f => (seen.has(f.id) ? false : (seen.add(f.id), true)))

  const sourceName = docs.length === 1 && docs[0].isFolder ? docs[0].name : `${deduped.length} photos`
  return { accessToken, files: deduped, sourceName }
}

/** List every image (incl. HEIC) directly inside a folder, sorted by filename. */
export async function listImagesInFolder(folderId: string, accessToken: string): Promise<DriveFile[]> {
  const files: DriveFile[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
      fields: 'nextPageToken, files(id, name, mimeType, size)',
      pageSize: '1000',
      orderBy: 'name_natural',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    })
    if (pageToken) params.set('pageToken', pageToken)

    const resp = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new Error(`Drive list failed (${resp.status}). ${body.slice(0, 200)}`)
    }
    const json = await resp.json()
    for (const f of json.files ?? []) {
      const isImage = f.mimeType?.startsWith('image/') || f.name?.toLowerCase().endsWith('.heic')
      if (isImage) {
        files.push({ id: f.id, name: f.name, mimeType: f.mimeType || 'image/jpeg', size: Number(f.size) || 0 })
      }
    }
    pageToken = json.nextPageToken
  } while (pageToken)

  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  return files
}

/** Download a single Drive file's bytes into a File object (preserves the original name). */
export async function downloadDriveFile(file: DriveFile, accessToken: string): Promise<File> {
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!resp.ok) {
    throw new Error(`Download failed for ${file.name} (${resp.status})`)
  }
  const blob = await resp.blob()
  return new File([blob], file.name, { type: file.mimeType || blob.type || 'image/jpeg' })
}

export interface DriveDiagnostics {
  ok: boolean
  origin: string
  steps: { name: string; ok: boolean; detail?: string }[]
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Self-service connection test for stylists/support. Walks the same path the import
 * uses and reports exactly which step fails AND the current page origin — so when
 * something breaks (the recurring "wrong origin not in an allowlist" problem) the
 * failure is self-locating instead of an opaque Google modal.
 *
 * The Picker's developerKey/HTTP-referrer can't be validated without rendering the
 * Picker UI, so the final step is advisory: it names the exact origin to add to the
 * API key's HTTP-referrer list if the Picker still errors.
 */
export async function runDriveDiagnostics(): Promise<DriveDiagnostics> {
  const origin = window.location.origin
  const steps: DriveDiagnostics['steps'] = []
  const finish = (): DriveDiagnostics => ({ ok: steps.every(s => s.ok), origin, steps })

  steps.push({
    name: 'Environment configured',
    ok: isGoogleDriveConfigured(),
    detail: `clientId:${Boolean(CLIENT_ID)} apiKey:${Boolean(API_KEY)} appId:${Boolean(APP_ID)}`,
  })
  if (!isGoogleDriveConfigured()) return finish()

  try {
    await ensureLoaded()
    steps.push({ name: 'Google libraries loaded', ok: true })
  } catch (e) {
    steps.push({ name: 'Google libraries loaded', ok: false, detail: errMsg(e) })
    return finish()
  }

  let token: string
  try {
    token = await requestAccessToken({ interactive: true })
    steps.push({ name: 'Sign-in / OAuth origin authorized', ok: true, detail: `origin ${origin}` })
  } catch (e) {
    steps.push({
      name: 'Sign-in / OAuth origin authorized',
      ok: false,
      detail: `${errMsg(e)} — if this says origin_mismatch, add "${origin}" to the OAuth client's Authorized JavaScript origins.`,
    })
    return finish()
  }

  try {
    const { email } = await preflightDriveAccess(token)
    steps.push({ name: 'Drive API reachable', ok: true, detail: email ? `signed in as ${email}` : undefined })
  } catch (e) {
    steps.push({ name: 'Drive API reachable', ok: false, detail: errMsg(e) })
    return finish()
  }

  steps.push({
    name: 'Picker developer key (not auto-testable)',
    ok: true,
    detail: `If the Picker shows "The API developer key is invalid", add "${origin}/*" to the API key's HTTP-referrer list and ensure the Google Picker API is in the key's API restrictions.`,
  })
  return finish()
}
