import { useEffect, useState } from 'react'
import { useClientStore } from '@/stores/clientStore'

// Ask Atelier in the Style tool (Karl, 2026-10-16: "Ask Atelier should be available to all employees, with the
// Watson W like I have on my profile"). Cynthia asked a question in the old feedback bubble here and nothing
// answered, because Ask Atelier lived only on the dashboard pages. Now the same W sits in the same corner and
// opens the dashboard's Ask Atelier (/embed/ask) in a side panel: same login, same answers, same "Report a
// problem" inside it, which replaces the old feedback bubble. The panel is told the page and the client in view.

const APEX = 'https://atelierbywatson.com'

/** The panel's address: the page and client in view at the moment it is first opened. */
function embedSrc(): string {
  const client = useClientStore.getState().activeClient
  const path = `/style${window.location.hash ? `/${window.location.hash.slice(1)}` : ''}`
  return `/embed/ask?path=${encodeURIComponent(path)}${client?.id ? `&client=${encodeURIComponent(client.id)}` : ''}`
}

export function AskAtelierButton() {
  const [open, setOpen] = useState(false)
  // The conversation then stays as she moves around (the panel stays loaded while closed).
  const [src, setSrc] = useState('')

  // The panel's Close (and Escape inside it) hands back here.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin === window.location.origin && (e.data as { type?: string } | null)?.type === 'ask-atelier:close') setOpen(false)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  // Cmd/Ctrl+K opens and closes it, as on the dashboard; Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSrc((s) => s || embedSrc()); setOpen((o) => !o) }
      else if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggle = () => { setSrc((s) => s || embedSrc()); setOpen((o) => !o) }

  return (
    <>
      <div className="group fixed bottom-5 right-5 z-40 flex items-center">
        <span className="pointer-events-none mr-3 translate-x-2 rounded-full bg-[#1a1a1a] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white opacity-0 shadow-sm transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100">Ask Atelier</span>
        <button type="button" onClick={toggle} aria-label="Ask Atelier" aria-expanded={open} title="Ask Atelier (Cmd K)"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1a1a1a] text-white shadow-lg transition-all duration-300 hover:scale-105 hover:bg-black">
          <span aria-hidden className="block h-[18px] w-[26px] bg-white"
            style={{ WebkitMaskImage: `url(${APEX}/brand/favicon-w.svg)`, maskImage: `url(${APEX}/brand/favicon-w.svg)`, WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskPosition: 'center', maskPosition: 'center', WebkitMaskSize: 'contain', maskSize: 'contain' }} />
        </button>
      </div>
      {src && (
        <>
          <div className={`fixed inset-0 z-50 bg-black/20 transition-opacity duration-300 md:hidden ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`} onClick={() => setOpen(false)} aria-hidden />
          <div className={`fixed z-50 overflow-hidden bg-[#faf9f8] shadow-2xl transition-all duration-500 ease-out inset-x-0 bottom-0 top-[8vh] rounded-t-2xl md:inset-x-auto md:right-0 md:top-0 md:h-full md:w-[420px] md:rounded-none md:border-l md:border-black/10 ${open ? 'translate-y-0 opacity-100 md:translate-x-0' : 'pointer-events-none translate-y-6 opacity-0 md:translate-x-6 md:translate-y-0'}`}>
            {/* Kept loaded while closed, so the conversation is still there when she opens it again. */}
            <iframe title="Ask Atelier" src={src} className="h-full w-full border-0" allow="clipboard-write; microphone" />
          </div>
        </>
      )}
    </>
  )
}
