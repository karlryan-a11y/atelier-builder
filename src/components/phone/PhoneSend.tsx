import { useEffect, useMemo, useState } from 'react'
import { Search, Send, X } from 'lucide-react'
import { useClientStore } from '@/stores/clientStore'
import { useLookCategories } from '@/hooks/useLookCategories'
import { useShareLinks, openedAgo, type ShareKind } from '@/hooks/useShareLinks'
import { ClientBar } from '@/components/layout/ClientBar'
import { LoadError } from '@/components/common/LoadError'
import { TileImage } from '@/components/common/TileImage'
import { LOOK_TILE_WIDTH } from '@/lib/derivedImage'
import { searchByName } from '@/lib/lookSearch'

/**
 * Style on a phone: send a client a look or a capsule (Maegan, 2026-09-24: "we need an easy way to
 * text a look to a client ... I need to be able do this from my phone").
 *
 * The desktop Style screen is a three-column workspace; at phone width its look cards and Copy
 * link sat off the right edge. This is the one job a stylist does from her phone, laid out for it:
 * pick the client, see her looks and capsules (drafts and on her lookbook), tap one, tap Send.
 *
 * It sends the SAME private link as Copy link in Categorize (hooks/useShareLinks.ts): one link per
 * look, the same open count and Revoke on the desktop card. The link is fetched when a look is
 * opened, so Send can open the iPhone share sheet inside her tap (lib/shareSend.ts).
 */

type Tab = 'looks' | 'capsules'

interface Item { id: string; name: string; image: string | null; published: boolean }

export function PhoneSend({ onFullTool }: { onFullTool: () => void }) {
  const { activeClient } = useClientStore()
  const { loading, error, refetch, looks, capsules } = useLookCategories(activeClient?.id ?? null)
  const share = useShareLinks(activeClient?.id ?? null)
  const [tab, setTab] = useState<Tab>('looks')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<{ kind: ShareKind; item: Item } | null>(null)
  const [link, setLink] = useState<{ url: string } | { error: string } | null>(null)

  // A new client starts on her looks, with no search and nothing open.
  useEffect(() => { setTab('looks'); setSearch(''); setOpen(null) }, [activeClient?.id])

  const shownLooks = useMemo(() => looks.filter((l) => !l.archived), [looks])
  const shownCapsules = useMemo(() => capsules.filter((c) => !c.archived), [capsules])
  const list: Item[] = useMemo(
    () => searchByName<Item>(tab === 'looks' ? shownLooks : shownCapsules, search),
    [tab, shownLooks, shownCapsules, search],
  )

  // Fetch the link as the look opens, so Send has it in hand when she taps.
  const { ensureLink, setStatus } = share
  useEffect(() => {
    let cancelled = false
    setLink(null)
    setStatus(null)
    if (!open) return
    ensureLink(open.kind, open.item.id)
      .then((r) => { if (!cancelled) setLink(r) })
      .catch(() => { if (!cancelled) setLink({ error: 'no connection' }) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per look opened, not per new link map
  }, [open?.kind, open?.item.id])

  const st = open ? share.stateFor(open.kind, open.item.id) : null
  const url = link && 'url' in link ? link.url : null

  return (
    <div data-phone-send className="flex flex-col h-full w-full overflow-hidden bg-[#F8F7F5]">
      <div className="flex items-center justify-between px-4 h-12 bg-[#050505] flex-none">
        <a href="/" className="text-white text-[22px] leading-none tracking-[0.015em]" style={{ fontFamily: "'Schnyder', Georgia, serif", fontWeight: 300 }}>
          ATELIER
        </a>
        <button
          onClick={onFullTool}
          title="The whole Style tool, as on a computer"
          className="text-[10px] tracking-[0.18em] uppercase text-white/70"
        >Full Style</button>
      </div>
      <div className="flex items-center px-4 h-14 bg-white border-b border-[#E8E4DF] flex-none">
        <ClientBar styleOnly />
      </div>

      {!activeClient ? (
        <p className="px-6 py-10 text-center text-[15px] leading-relaxed text-[#666]">
          Pick a client to see her looks and capsules, then tap one to send it.
        </p>
      ) : (
        <>
          <div className="flex-none bg-white px-4 pt-3 pb-3 border-b border-[#E8E4DF] space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {(['looks', 'capsules'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => { setTab(t); setSearch('') }}
                  className={`py-2.5 rounded-full text-[12px] tracking-[0.15em] uppercase ${
                    tab === t ? 'bg-[#1A1A1A] text-white' : 'bg-[#F8F7F5] text-[#666]'
                  }`}
                >
                  {t} ({t === 'looks' ? shownLooks.length : shownCapsules.length})
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#bbb]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tab === 'looks' ? 'Search look names' : 'Search capsule names'}
                // 16px: a smaller box makes iPhone Safari zoom in when it is tapped.
                className="w-full pl-9 pr-3 py-2 rounded bg-[#F8F7F5] text-[16px] focus:outline-none placeholder:text-[#bbb]"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {error ? (
              <LoadError what={tab} onRetry={refetch} />
            ) : loading ? (
              <p className="py-10 text-center text-[14px] text-[#999]">Loading…</p>
            ) : list.length === 0 ? (
              <p className="py-10 text-center text-[14px] text-[#999]">
                {search ? `Nothing named "${search}".` : `She has no ${tab} yet.`}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {list.map((item) => (
                  <button
                    key={item.id}
                    data-send-tile={tab}
                    onClick={() => setOpen({ kind: tab === 'looks' ? 'look' : 'capsule', item })}
                    className="text-left bg-white rounded-lg border border-[#E8E4DF] overflow-hidden"
                  >
                    <div className="relative aspect-[4/5] bg-[#F8F7F5]">
                      {item.image && (
                        <TileImage src={item.image} width={LOOK_TILE_WIDTH} alt={item.name} loading="lazy" className="absolute inset-0 w-full h-full object-contain p-2" />
                      )}
                      {!item.published && (
                        <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-[#F8E5E7] text-[10px] tracking-[0.1em] uppercase text-[#1A1A1A]">Draft</span>
                      )}
                    </div>
                    <p className="px-2.5 py-2 text-[13px] leading-snug text-[#1A1A1A] truncate">{item.name}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {open && (
        <div data-send-sheet className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex items-center justify-between px-4 h-14 border-b border-[#E8E4DF] flex-none">
            <span className="text-[10px] tracking-[0.2em] uppercase text-[#888]">
              {open.kind === 'look' ? 'Look' : 'Capsule'} · {open.item.published ? 'On her lookbook' : 'Draft'}
            </span>
            <button onClick={() => setOpen(null)} aria-label="Close" className="p-2 -mr-2 text-[#1A1A1A]">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 min-h-0 bg-[#F8F7F5] flex items-center justify-center p-4">
            {open.item.image && (
              <img src={open.item.image} alt={open.item.name} className="max-w-full max-h-full object-contain" />
            )}
          </div>
          <div className="flex-none px-5 pt-4 pb-8 space-y-3">
            <p className="font-serif italic text-[22px] leading-tight text-[#1A1A1A]">{open.item.name}</p>
            <button
              data-send-button
              onClick={() => { if (url) void share.sendKnownLink(url) }}
              disabled={!url}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-full bg-[#1A1A1A] text-white text-[13px] tracking-[0.2em] uppercase disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
              {url ? 'Send' : link && 'error' in link ? 'No link' : 'Getting the link…'}
            </button>
            <p data-send-status className="min-h-[20px] text-center text-[13px] text-[#666] break-all">
              {link && 'error' in link
                ? `The link could not be made (${link.error}). Close and try again.`
                : share.status ?? (st ? (st.openCount > 0 ? `She ${openedAgo(st.lastOpenedAt) ?? 'opened it'}` : 'Private link, no login needed') : '')}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
