import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, ChevronLeft, Layers, Image as ImageIcon, Copy } from 'lucide-react'
import { useCanvasStore } from '@/stores/canvasStore'
import { supabase } from '@/lib/supabase'
import { OMIT_LABEL, omittedHeadline } from '@/lib/restyleSelection'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

interface LookItem { id: string; name: string; brand: string | null; image: string | null }

// A GoodPix-style "what's in this look" list — the garments currently on the board, with brand,
// so the stylist knows exactly what pieces (and designers to credit) the look contains. Reads the
// canvas nodes live and resolves images the same way the collection does (proxy for digitized items).
export function LookItemsPanel() {
  const nodes = useCanvasStore((s) => s.state.nodes)
  const reference = useCanvasStore((s) => s.restyleReference)
  const [open, setOpen] = useState(true)
  const [items, setItems] = useState<LookItem[]>([])

  const itemIds = useMemo(() => {
    const ids: string[] = []
    const seen = new Set<string>()
    for (const n of nodes) {
      if (n.type === 'closet_item' && !seen.has(n.closet_item_id)) { seen.add(n.closet_item_id); ids.push(n.closet_item_id) }
    }
    return ids
  }, [nodes])

  useEffect(() => {
    if (itemIds.length === 0) { setItems([]); return }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('gp_closet_items')
        .select('id, name, name_override, brand, source, raw, processed_image_hash, primary_image_hash')
        .in('id', itemIds)
      if (cancelled || !data) return
      const byId = new Map<string, LookItem>()
      for (const it of data as Array<Record<string, any>>) {
        let image: string | null = null
        if (it.source === 'intake_pipeline') {
          const key = it.processed_image_hash ?? it.primary_image_hash
          if (key) image = `${SUPABASE_URL}/functions/v1/image-proxy?key=${encodeURIComponent(key)}`
        }
        if (!image) image = it.raw?.processed_image ?? it.raw?.image ?? it.raw?.images?.[0] ?? null
        const brand = it.brand && it.brand !== 'None' && it.brand !== '' ? it.brand : null
        byId.set(it.id, { id: it.id, name: it.name_override || it.name || 'Item', brand, image })
      }
      setItems(itemIds.map((id) => byId.get(id)).filter((x): x is LookItem => !!x))
    })()
    return () => { cancelled = true }
  }, [itemIds.join(',')])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-9 flex-none border-l border-border bg-white flex flex-col items-center pt-3 gap-2 text-[#888] hover:text-[#1A1A1A]"
        title="Show what's in this look"
      >
        <ChevronLeft className="h-4 w-4" />
        <Layers className="h-4 w-4" />
        {items.length > 0 && <span className="text-[10px] text-[#bbb]">{items.length}</span>}
      </button>
    )
  }

  return (
    <div className="w-52 flex-none border-l border-border bg-white flex flex-col overflow-hidden">
      <div className="px-3 py-2.5 border-b border-border flex items-start justify-between">
        <div>
          <p className="text-[10px] tracking-[0.2em] uppercase text-[#888]">In this look</p>
          <p className="text-[11px] text-[#bbb]">{items.length} piece{items.length === 1 ? '' : 's'}</p>
        </div>
        <button onClick={() => setOpen(false)} className="text-[#bbb] hover:text-[#1A1A1A]" title="Hide"><ChevronRight className="h-4 w-4" /></button>
      </div>
      {reference && <RestyleReferenceBlock reference={reference} />}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {items.length === 0 ? (
          <p className="text-[11px] text-[#bbb] px-1 pt-2 leading-relaxed">Add pieces to the board and they'll list here.</p>
        ) : items.map((it) => (
          <div key={it.id} className="flex items-center gap-2 p-1.5 rounded-sm hover:bg-[#F8F7F5]">
            <div className="w-9 h-11 flex-none bg-[#F8F7F5] rounded-sm overflow-hidden flex items-center justify-center">
              {it.image
                ? <img src={it.image} alt={it.name} className="max-w-full max-h-full object-contain" loading="lazy" />
                : <Layers className="h-3.5 w-3.5 text-[#ccc]" />}
            </div>
            <div className="min-w-0">
              {it.brand && <p className="text-[9px] tracking-[0.12em] uppercase text-[#999] truncate">{it.brand}</p>}
              <p className="text-[11px] text-[#1A1A1A] truncate leading-tight">{it.name}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * THE ORIGINAL, BESIDE THE REBUILD.
 *
 * GoodPix gave us one flat picture per look and a list of item ids. It never gave us the
 * arrangement: 0 of 15,065 scraped looks have a saved canvas, so "Restyle" and "Rebuild in
 * canvas" can only lay the pieces out in a plain grid. Paige Berndt, 2026-09-17: "all the pieces
 * are laid out all over the screen and the brand names are removed. Can we implement something
 * where the original layout stays intact, but the transitioned pieces are removed?" We cannot do
 * that yet — the arrangement is not data we hold — but working from memory was never the job.
 *
 * So the original sits here while she rebuilds. It carries everything the grid loses: where each
 * piece went, and the handwriting GoodPix baked into the image ("Reformation", "Ulla Johnson",
 * "optional cardigan if needed"). That handwriting is the only record of the brand for most of
 * these pieces — 184 of the 305 pieces in Alicia Hidalgo's pulled looks have no brand in the
 * database at all, so there is nothing to print even if we wanted to.
 *
 * Under it: every piece deliberately left OFF the board and why. A piece that simply vanishes is
 * what sent Paige looking for a second transitioned garment the card had not named.
 */
function RestyleReferenceBlock({ reference }: { reference: NonNullable<ReturnType<typeof useCanvasStore.getState>['restyleReference']> }) {
  const [showOriginal, setShowOriginal] = useState(true)
  const omitted = reference.omitted

  return (
    <div className="flex-none border-b border-border bg-[#FCFBFA]">
      <div className="px-3 pt-2.5 pb-1.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] tracking-[0.2em] uppercase text-[#8a7a6a]">Restyling</p>
          <p className="text-[11px] text-[#1A1A1A] truncate leading-tight" title={reference.lookName || 'Untitled Look'}>
            {reference.lookName?.trim() || 'Untitled Look'}
          </p>
        </div>
        <button
          onClick={() => setShowOriginal((v) => !v)}
          className="shrink-0 text-[#bbb] hover:text-[#1A1A1A]"
          title={showOriginal ? 'Hide the original' : 'Show the original'}
        >
          <ImageIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {reference.covers > 1 && (
        <p className="px-3 pb-1.5 inline-flex items-center gap-1 text-[10px] tracking-[0.12em] uppercase text-[#8a7a6a]">
          <Copy className="h-3 w-3" /> saving answers {reference.covers} identical looks
        </p>
      )}

      {showOriginal && (
        reference.imageUrl ? (
          <a href={reference.imageUrl} target="_blank" rel="noreferrer" className="block px-3 pb-2" title="Open the original full size">
            <img
              src={reference.imageUrl}
              alt={`Original ${reference.lookName || 'look'}`}
              className="w-full rounded-sm border border-[#EFEBE6] bg-white"
              loading="lazy"
            />
            <p className="mt-1 text-[9px] tracking-[0.12em] uppercase text-[#bbb]">
              The original · layout and brand notes live only in this picture
            </p>
          </a>
        ) : (
          <p className="px-3 pb-2 text-[10px] text-[#bbb] leading-relaxed">
            This look has no stored picture, so there is nothing to compare the board against.
          </p>
        )
      )}

      <div className="px-3 pb-2.5">
        <p className="text-[10px] text-[#8a7a6a] leading-relaxed">{omittedHeadline(omitted)}</p>
        {omitted.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {omitted.map((o) => (
              <li key={o.id} className="leading-tight">
                {o.brand && <span className="block text-[9px] tracking-[0.14em] uppercase text-[#aaa] truncate">{o.brand}</span>}
                <span className="block text-[11px] text-[#1A1A1A] truncate" title={o.name}>{o.name}</span>
                <span className="block text-[9px] tracking-[0.12em] uppercase text-[#bbb]">{OMIT_LABEL[o.reason]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
