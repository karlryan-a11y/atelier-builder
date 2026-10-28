/**
 * Sending a look's or capsule's private link from a phone (Maegan, 2026-09-24: "I need to be able
 * do this from my phone").
 *
 * Two rules live here so the phone screen and its check share them:
 *
 * 1. WHERE THE SHARE ENDPOINTS ARE. Always /looks/api/share on the page's own address: on
 *    atelierbywatson.com/style the dashboard passes /looks to the lookbook, and on the builder's own
 *    addresses (its previews included) vercel.json passes /looks/api/share there too. Same-origin, so
 *    no CORS, and a preview can make a link. Only the local dev server (Vite, port 5173) has no
 *    /looks and calls atelierbywatson.com, as everything did before.
 *
 * 2. HOW A LINK IS SENT. The iPhone share sheet (navigator.share) when the phone has one, with the
 *    link alone, so Messages draws the look's picture card and pastes a bare link. If she closes the
 *    sheet, nothing else happens. If the sheet is refused or missing, the link is copied instead.
 *    sendLink calls the sheet before it waits on anything, so it runs inside her tap. A link is made
 *    only when Send is tapped (never when a look is merely opened), and a look that already has one
 *    sends it straight from the tap.
 */

const LIVE_API = 'https://atelierbywatson.com/looks/api/share'

export function shareApiBase(loc: { hostname: string; port: string } | null | undefined): string {
  return !loc || (loc.hostname === 'localhost' && loc.port === '5173') ? LIVE_API : '/looks/api/share'
}

export type SendResult = 'shared' | 'cancelled' | 'copied' | 'failed'

interface ShareNavigator {
  share?: (data: { url?: string; title?: string; text?: string }) => Promise<void>
}

export async function sendLink(
  url: string,
  nav: ShareNavigator | undefined,
  copy: (text: string) => Promise<boolean>,
): Promise<SendResult> {
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ url })
      return 'shared'
    } catch (e) {
      // She closed the sheet: that is her choice, not a failure, and the clipboard stays hers.
      if (e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError') return 'cancelled'
    }
  }
  return (await copy(url)) ? 'copied' : 'failed'
}

/** The line under the Send button after a send. Plain words, no dashes. */
export function sendMessage(result: SendResult, url: string): string {
  if (result === 'shared') return 'Sent'
  if (result === 'cancelled') return ''
  if (result === 'copied') return 'Link copied. Paste it into a text.'
  return `Copy failed. The link is ${url}`
}
