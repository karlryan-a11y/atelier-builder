// Playwright page manager. One long-lived Chromium page sits on the atelier-builder render.html
// with window.__atelierRender() installed. Renders are serialized through it (a single page can
// only draw one composite at a time) and the page self-heals if it ever crashes.
import { chromium, type Browser, type Page } from 'playwright'
import { env } from './env.js'

export interface CanvasSpec {
  kind: 'canvas'
  canvasState: unknown
  imageUrls: Record<string, string>
  pixelRatio?: number
}
export interface CapsuleGridSpec {
  kind: 'capsuleGrid'
  looks: Array<{ name: string; imageUrl: string | null; thumbnailUrl: string | null }>
}
export type RenderSpec = CanvasSpec | CapsuleGridSpec

export interface CanvasRenderResult { pngBase64: string; thumbnailDataUrl: string }
export interface GridRenderResult { pngBase64: string }

let browser: Browser | null = null
let page: Page | null = null
let renderChain: Promise<unknown> = Promise.resolve()

async function ensurePage(): Promise<Page> {
  if (page && !page.isClosed()) return page
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  }
  page = await browser.newPage({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: 1 })
  page.on('console', (msg) => { if (msg.type() === 'error') console.warn('[render-page]', msg.text()) })
  await page.goto(env.ATELIER_RENDER_URL, { waitUntil: 'networkidle', timeout: 60_000 })
  await page.waitForFunction(() => (window as unknown as { __atelierRenderReady?: boolean }).__atelierRenderReady === true, undefined, { timeout: 60_000 })
  return page
}

/** Run a render on the shared page, serialized so concurrent requests never fight over the stage. */
export function render<T>(spec: RenderSpec): Promise<T> {
  const run = async (): Promise<T> => {
    let p: Page
    try {
      p = await ensurePage()
    } catch (err) {
      // Force a fresh page next time.
      page = null
      throw err
    }
    try {
      // The page's window.__atelierRender resolves once fonts + images are drawn.
      return await p.evaluate(
        (s) => (window as unknown as { __atelierRender: (spec: unknown) => Promise<unknown> }).__atelierRender(s),
        spec,
      ) as T
    } catch (err) {
      // A dead page throws — drop it so the next call reloads render.html cleanly.
      try { if (page && !page.isClosed()) await page.close() } catch { /* ignore */ }
      page = null
      throw err
    }
  }
  // Chain so renders never overlap on the single page.
  const next = renderChain.then(run, run)
  renderChain = next.catch(() => undefined)
  return next
}

export async function warmUp(): Promise<void> {
  await ensurePage()
}

export async function shutdown(): Promise<void> {
  try { if (browser) await browser.close() } catch { /* ignore */ }
  browser = null
  page = null
}
