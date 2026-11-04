import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useCustomHeading } from '@/hooks/useCustomHeading'
import { CUSTOM_HEADING_MAX, DEFAULT_CUSTOM_HEADING } from '@/lib/customHeading'

/**
 * Her name for the "Custom" heading on her Collection (Cynthia for Keil Cadieux, 11/04).
 * Per client: every other client keeps "Custom" until a stylist names theirs.
 * The lookbook reads it from gp_clients.raw (lib/customHeading.ts).
 */
export function CustomHeadingPanel({ clientId, who }: { clientId: string; who: string }) {
  const { name, save, error } = useCustomHeading(clientId)
  // What she is typing, keyed by client so switching clients starts from that client's saved name.
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const text = draft?.id === clientId ? draft.text : (name ?? '')
  const changed = name !== null && text.trim() !== name

  const run = async (next: string) => {
    setBusy(true); setSaved(false)
    const ok = await save(next)
    setBusy(false)
    if (ok) { setDraft(null); setSaved(true) }
  }

  return (
    <div className="flex flex-col gap-2 border border-[#E8E4DF] bg-white p-4">
      <h3 className="text-[13px] tracking-[0.06em]">Heading for {who}'s own categories</h3>
      <p className="text-[12px] text-[#666] leading-relaxed max-w-[70ch]">
        On {who}'s Collection, the categories that are hers alone sit under a heading that says "{DEFAULT_CUSTOM_HEADING}".
        Type another name for it here. Only {who} sees it; every other client keeps "{DEFAULT_CUSTOM_HEADING}".
        The heading shows while her categories are not nested into groups.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          aria-label="Heading for her own categories"
          value={text}
          maxLength={CUSTOM_HEADING_MAX}
          disabled={name === null || busy}
          onChange={(e) => { setDraft({ id: clientId, text: e.target.value }); setSaved(false) }}
          onKeyDown={(e) => { if (e.key === 'Enter' && changed) run(text) }}
          placeholder={DEFAULT_CUSTOM_HEADING}
          className="border border-[#E8E4DF] px-3 py-1.5 text-[13px] bg-white min-w-[260px]"
        />
        <button
          onClick={() => run(text)}
          disabled={!changed || busy}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px] tracking-[0.1em] uppercase bg-[#1A1A1A] text-white disabled:opacity-40"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Save heading
        </button>
        {name ? (
          <button onClick={() => run('')} disabled={busy} className="text-[12px] text-[#888] hover:text-[#1A1A1A]">
            Back to "{DEFAULT_CUSTOM_HEADING}"
          </button>
        ) : null}
        {name === null && !error && <span className="text-[12px] text-[#888]">Loading…</span>}
        {saved && !error && <span className="text-[12px] text-[#4A7C59]">Saved. Her Collection now says "{name || DEFAULT_CUSTOM_HEADING}".</span>}
        {error && <span className="text-[12px] text-[#B00020]">{error}</span>}
      </div>
    </div>
  )
}
