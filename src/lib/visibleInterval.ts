/**
 * setInterval that stops while the tab is hidden.
 *
 * The Digitize screen polled the database every 5 to 30 seconds from six timers whether or not
 * anyone was looking: an iPad with the Builder left open in a background tab kept a 1 GB
 * database busy all night. This runs `fn` every `ms` only while the page is visible; when the
 * tab comes back it runs `fn` at once (so the screen is current the moment she looks) and then
 * resumes the interval.
 *
 * Returns a stop function, so an effect can `return setVisibleInterval(fn, ms)`.
 * scripts/check-intake-polling.mjs requires every interval under src/components/intake to go
 * through here.
 */
interface DocLike {
  hidden: boolean
  addEventListener(type: 'visibilitychange', fn: () => void): void
  removeEventListener(type: 'visibilitychange', fn: () => void): void
}

export function setVisibleInterval(fn: () => void, ms: number, doc: DocLike = document): () => void {
  let iv: ReturnType<typeof setInterval> | null = null
  const start = () => { if (iv === null) iv = setInterval(fn, ms) }
  const stop = () => { if (iv !== null) { clearInterval(iv); iv = null } }
  const onVisibility = () => {
    if (doc.hidden) stop()
    else { fn(); start() }
  }
  if (!doc.hidden) start()
  doc.addEventListener('visibilitychange', onVisibility)
  return () => {
    stop()
    doc.removeEventListener('visibilitychange', onVisibility)
  }
}
