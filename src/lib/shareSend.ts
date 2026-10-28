/**
 * Sending a look's or capsule's private link from a phone (Maegan, 2026-09-24: "I need to be able
 * do this from my phone").
 *
 * Two rules live here so the phone screen and its check share them:
 *
 * 1. WHERE THE SHARE ENDPOINTS ARE. On atelierbywatson.com the builder is served at /style, and the
 *    lookbook's /looks/api is on the same address, so the call is same-origin (no CORS, and a test
 *    copy of the site at another address reaches its own /looks too). The builder's own Vercel
 *    address has no /looks, so there it keeps calling atelierbywatson.com, as it always has.
 *
 * 2. HOW A LINK IS SENT. The iPhone share sheet (navigator.share) when the phone has one, with the
 *    link alone, so Messages draws the look's picture card and pastes a bare link. If she closes the
 *    sheet, nothing else happens. If the sheet is refused or missing, the link is copied instead.
 *    The caller must already HAVE the url: Safari only opens the sheet inside the tap itself, and a
 *    network wait before it loses the tap. That is why the phone screen fetches the link when a
 *    look is opened, before Send is pressed.
 */

const LIVE_API = 'https://atelierbywatson.com/looks/api/share'

export function shareApiBase(loc: { pathname: string } | null | undefined): string {
  return loc && (loc.pathname === '/style' || loc.pathname.startsWith('/style/')) ? '/looks/api/share' : LIVE_API
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
