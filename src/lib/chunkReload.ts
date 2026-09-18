/**
 * Update-safe tabs: reload ONCE when a lazy chunk fails to load after a deploy.
 *
 * A stylist's iPad keeps the Builder open for days. Each deploy replaces the hashed files under
 * /_builder/, so the old tab's next lazy import asks for a chunk that no longer exists and the
 * screen she tapped simply never opens. Vite fires `vite:preloadError` for exactly that; a
 * reload picks up the new index.html and the new chunk names.
 *
 * Loop guard: the reload is stamped in sessionStorage and not repeated within RELOAD_WINDOW_MS,
 * so a chunk that is genuinely broken (not just renamed) surfaces as an error instead of a tab
 * reloading forever. If sessionStorage is unavailable we cannot guard, so we do NOT reload.
 * scripts/check-chunk-reload.mjs holds this.
 */
export const RELOAD_KEY = 'atelier:chunk-reload-at'
export const RELOAD_WINDOW_MS = 5 * 60 * 1000

interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

/** True when this failure should reload the page; records the reload when it says yes. */
export function shouldReloadForChunkError(storage: StorageLike | null | undefined, now: number = Date.now()): boolean {
  if (!storage) return false
  try {
    const last = Number(storage.getItem(RELOAD_KEY) ?? 0)
    if (last && now - last < RELOAD_WINDOW_MS) return false
    storage.setItem(RELOAD_KEY, String(now))
    return true
  } catch {
    return false
  }
}

export function installChunkReload(win: Window = window): void {
  win.addEventListener('vite:preloadError', (event) => {
    let storage: StorageLike | null = null
    try { storage = win.sessionStorage } catch { storage = null }
    if (shouldReloadForChunkError(storage)) {
      // Stop Vite rethrowing: the reload is the handling.
      event.preventDefault()
      win.location.reload()
    }
  })
}
