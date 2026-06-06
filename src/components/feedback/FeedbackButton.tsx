import { useEffect, useRef, useState } from 'react'
import { MessageSquare, X, Image as ImageIcon, Loader2, Check } from 'lucide-react'

type SubmitState = 'idle' | 'submitting' | 'success' | 'error'

/**
 * Floating Send Feedback button for atelier-builder pages.
 *
 * Posts to /api/feedback. When the user is on atelierbywatson.com/style/* the
 * dashboard's feedback API handles it (same cookies, same Slack webhook). On
 * direct atelier-builder.vercel.app access the endpoint won't exist — but
 * that's not the stylist path.
 */
export function FeedbackButton() {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null)
  const [state, setState] = useState<SubmitState>('idle')
  const [errorMsg, setErrorMsg] = useState<string>('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function close() {
    setOpen(false)
    setTimeout(() => {
      setNote('')
      setScreenshotDataUrl(null)
      setState('idle')
      setErrorMsg('')
    }, 200)
  }

  function readFile(file: File) {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => setScreenshotDataUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          readFile(file)
          e.preventDefault()
          return
        }
      }
    }
  }

  async function submit() {
    if (!note.trim()) return
    setState('submitting')
    setErrorMsg('')
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          note: note.trim(),
          pageUrl: typeof window !== 'undefined' ? window.location.href : null,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
          screenshotDataUrl,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        setState('error')
        setErrorMsg(data?.error || `Failed (${res.status})`)
        return
      }
      setState('success')
      setTimeout(() => close(), 1400)
    } catch (err: unknown) {
      setState('error')
      const msg = err instanceof Error ? err.message : 'Network error'
      setErrorMsg(msg)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full bg-[#0a0a0a] hover:bg-[#333] text-white flex items-center justify-center transition-all duration-300 shadow-lg hover:scale-105"
        aria-label="Send feedback"
      >
        <MessageSquare className="w-5 h-5" strokeWidth={1.5} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
          onClick={close}
        >
          <div
            className="relative w-full max-w-lg bg-white shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-5 border-b border-black/8 flex items-center justify-between">
              <div>
                <h3
                  className="text-[1.4rem] text-black leading-tight"
                  style={{ fontFamily: 'Schnyder, Georgia, serif' }}
                >
                  Send feedback
                </h3>
                <p
                  className="text-[12px] text-black/45 mt-0.5"
                  style={{ fontFamily: 'Neue Haas Grotesk, sans-serif' }}
                >
                  Bugs, requests, &quot;is this normal?&quot; — all welcome.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="text-black/40 hover:text-black/80 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" strokeWidth={1.5} />
              </button>
            </div>

            <div className="px-6 pt-5 pb-3">
              <label
                className="block text-[11px] tracking-[0.22em] uppercase text-black/45 mb-2"
                style={{ fontFamily: 'Neue Haas Grotesk, sans-serif' }}
              >
                What&rsquo;s happening?
              </label>
              <textarea
                ref={textareaRef}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onPaste={handlePaste}
                placeholder="Describe what you saw, what you expected, or what would make this better. You can paste a screenshot anywhere in this box."
                className="w-full min-h-[140px] border border-black/10 px-3 py-2.5 text-[14px] text-black placeholder:text-black/30 focus:outline-none focus:border-black/40 transition-colors resize-y"
                style={{ fontFamily: 'Neue Haas Grotesk, sans-serif' }}
                disabled={state === 'submitting' || state === 'success'}
              />
              <p
                className="mt-2.5 text-[11.5px] text-black/45 leading-relaxed"
                style={{ fontFamily: 'Neue Haas Grotesk, sans-serif' }}
              >
                On a Mac, press <span className="text-black/70">⌘⇧3</span> to
                take a screenshot. Or paste a Loom or Zoom clip link in the
                note.
              </p>

              <div className="mt-3 flex items-center gap-3">
                {screenshotDataUrl ? (
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <img
                      src={screenshotDataUrl}
                      alt="Screenshot preview"
                      className="h-12 w-12 object-cover border border-black/10"
                    />
                    <button
                      type="button"
                      onClick={() => setScreenshotDataUrl(null)}
                      className="text-[12px] text-black/55 hover:text-black underline underline-offset-2"
                      style={{ fontFamily: 'Neue Haas Grotesk, sans-serif' }}
                    >
                      Remove screenshot
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 text-[12.5px] text-black/55 hover:text-black/85 transition-colors"
                    style={{ fontFamily: 'Neue Haas Grotesk, sans-serif' }}
                  >
                    <ImageIcon className="w-4 h-4" strokeWidth={1.5} />
                    Attach screenshot
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) readFile(f)
                  }}
                />
              </div>
            </div>

            {errorMsg && (
              <div className="px-6 pb-3">
                <p
                  className="text-[12px] text-red-700 bg-red-50 border border-red-200 px-3 py-2"
                  style={{ fontFamily: 'Neue Haas Grotesk, sans-serif' }}
                >
                  {errorMsg}
                </p>
              </div>
            )}

            <div className="px-6 py-4 bg-[#faf9f8] border-t border-black/8 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={submit}
                disabled={!note.trim() || state === 'submitting' || state === 'success'}
                className="inline-flex items-center gap-2 bg-black text-white px-5 py-2.5 text-[13px] tracking-[0.05em] disabled:bg-black/30 hover:bg-black/85 transition-colors min-w-[120px] justify-center"
                style={{ fontFamily: 'Neue Haas Grotesk, sans-serif' }}
              >
                {state === 'submitting' && <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />}
                {state === 'success' && <Check className="w-4 h-4" strokeWidth={1.8} />}
                {state === 'idle' && 'Send'}
                {state === 'submitting' && 'Sending…'}
                {state === 'success' && 'Sent'}
                {state === 'error' && 'Retry'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
