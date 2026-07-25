import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, ChevronLeft, Layers } from 'lucide-react'
import { useCanvasStore } from '@/stores/canvasStore'
import { supabase } from '@/lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

interface LookItem { id: string; name: string; brand: string | null; image: string | null }

// A GoodPix-style "what's in this look" list — the garments currently on the board, with brand,
// so the stylist knows exactly what pieces (and designers to credit) the look contains. Reads the
// canvas nodes live and resolves images the same way the collection does (proxy for digitized items).
export function LookItemsPanel() {
  const nodes = useCanvasStore((s) => s.state.nodes)
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
