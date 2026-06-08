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

// Pop the Google sign-in consent and return a short-lived OAuth access token.
function requestAccessToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error('Google Identity Services not available'))
      return
    }
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (resp: any) => {
        if (resp.error) {
          reject(new Error(resp.error_description || resp.error))
          return
        }
        resolve(resp.access_token as string)
      },
      error_callback: (err: any) => reject(new Error(err?.message || 'Sign-in cancelled')),
    })
    tokenClient.requestAccessToken({ prompt: '' })
  })
}

// Open the Picker filtered to folders; resolves with the chosen folder (or null if cancelled).
function openFolderPicker(accessToken: string): Promise<PickedFolder | null> {
  return new Promise((resolve, reject) => {
    const picker = window.google.picker
    if (!picker) {
      reject(new Error('Picker not loaded'))
      return
    }
    const view = new picker.DocsView(picker.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setIncludeFolders(true)
      .setMimeTypes('application/vnd.google-apps.folder')

    const builder = new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(API_KEY)
      .setSelectableMimeTypes('application/vnd.google-apps.folder')
      .setTitle('Select a client photo folder')
      .setCallback((data: any) => {
        const action = data[picker.Response.ACTION]
        if (action === picker.Action.PICKED) {
          const doc = data[picker.Response.DOCUMENTS]?.[0]
          resolve(doc ? { id: doc[picker.Document.ID], name: doc[picker.Document.NAME] } : null)
        } else if (action === picker.Action.CANCEL) {
          resolve(null)
        }
      })

    if (APP_ID) builder.setAppId(APP_ID)
    builder.build().setVisible(true)
  })
}

/**
 * Sign in (own Google account) and pick a Drive folder.
 * Returns the access token + folder, or null if the stylist cancels.
 */
export async function signInAndPickFolder(): Promise<{ accessToken: string; folder: PickedFolder } | null> {
  await ensureLoaded()
  const accessToken = await requestAccessToken()
  const folder = await openFolderPicker(accessToken)
  if (!folder) return null
  return { accessToken, folder }
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
