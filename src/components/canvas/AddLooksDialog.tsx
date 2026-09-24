import { useMemo, useState } from 'react'
import { X, Check, Plus, Loader2, Search } from 'lucide-react'
import type { LookRow } from '@/hooks/useLooks'
import { lookImageUrl } from '@/lib/lookImage'
import { TileImage } from '@/components/common/TileImage'
import { LOOK_TILE_WIDTH } from '@/lib/derivedImage'

/**
 * Pick any number of looks to put on the capsule. ADR-0152.
 *
 * Looks already on the board are shown ticked and cannot be picked twice. Adding keeps
 * everything already on the board where it is; the new looks go into the free places after it.
 */
interface AddLooksDialogProps {
  looks: LookRow[]
  onBoard: string[]
  /** True when the board is not a capsule yet: adding turns it into one. */
  startsCapsule: boolean
  adding: boolean
  error: string | null
  onAdd: (looks: LookRow[]) => void
  onClose: () => void
}

export function AddLooksDialog({ looks, onBoard, startsCapsule, adding, error, onAdd, onClose }: AddLooksDialogProps) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const on = useMemo(() => new Set(onBoard), [onBoard])
  const addable = looks.filter((l) => l.canvas_state)
  const shown = q.trim()
    ? addable.filter((l) => l.name.toLowerCase().includes(q.trim().toLowerCase()))
    : addable

  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-sm shadow-xl w-[520px] max-h-[80vh] flex flex-col mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E4DF]">
          <h2 className="text-sm font-medium tracking-[0.1em] uppercase text-[#1A1A1A]">Add Looks to Capsule</h2>
          <button onClick={onClose} className="text-[#888] hover:text-[#1A1A1A]" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pt-4 space-y-3">
          {startsCapsule && (
            <p className="text-[11px] leading-relaxed text-[#666]">
              This starts a new capsule. Whatever is on the board now stays on it as the first look.
            </p>
          )}
          <div className="flex items-center gap-2 border border-[#E8E4DF] rounded-sm px-3 py-2">
            <Search className="h-3.5 w-3.5 text-[#888]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a look by name"
              className="flex-1 text-sm text-[#1A1A1A] focus:outline-none"
              autoFocus
            />
          </div>
          <p className="text-[9px] tracking-[0.15em] uppercase text-[#888]">
            {picked.size} picked{onBoard.length > 0 ? `, ${onBoard.length} already on the capsule` : ''}
          </p>
        </div>

        <div className="px-5 py-3 space-y-2 overflow-y-auto flex-1">
          {shown.length === 0 && (
            <p className="text-sm text-[#888] py-4 text-center">{addable.length === 0 ? 'No saved looks yet.' : 'No look has that name.'}</p>
          )}
          {shown.map((look) => {
            const already = on.has(look.id)
            const checked = already || picked.has(look.id)
            const img = lookImageUrl(look.raw)
            return (
              <button
                key={look.id}
                onClick={() => { if (!already) toggle(look.id) }}
                disabled={already}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-sm border transition-colors text-left ${
                  already ? 'border-[#E8E4DF] opacity-50 cursor-default'
                    : checked ? 'border-[#1A1A1A] bg-[#F8F7F5]' : 'border-[#E8E4DF] hover:border-[#ccc]'
                }`}
              >
                <div className="w-12 h-12 rounded-sm bg-[#F8F7F5] overflow-hidden shrink-0">
                  {img ? <TileImage src={img} width={LOOK_TILE_WIDTH} alt="" className="w-full h-full object-cover" /> : null}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#1A1A1A] font-medium truncate">{look.name}</p>
                  <p className="text-[10px] text-[#888]">{already ? 'Already on this capsule' : look.tags?.join(', ') || ''}</p>
                </div>
                <div className={`w-5 h-5 rounded-sm border flex items-center justify-center shrink-0 ${checked ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'border-[#ccc]'}`}>
                  {checked && <Check className="h-3 w-3 text-white" />}
                </div>
              </button>
            )
          })}
        </div>

        {error && <p className="px-5 pb-2 text-[11px] text-red-500">{error}</p>}

        <div className="px-5 py-4 border-t border-[#E8E4DF] flex gap-3">
          <button
            onClick={() => onAdd(addable.filter((l) => picked.has(l.id)))}
            disabled={adding || picked.size === 0}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#1A1A1A] text-white text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#333] disabled:opacity-40 transition-colors"
          >
            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {adding ? 'Adding' : `Add ${picked.size} ${picked.size === 1 ? 'look' : 'looks'}`}
          </button>
          <button
            onClick={onClose}
            disabled={adding}
            className="px-4 py-2.5 border border-[#E8E4DF] text-[11px] tracking-[0.15em] uppercase rounded-sm hover:bg-[#F8F7F5] disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
