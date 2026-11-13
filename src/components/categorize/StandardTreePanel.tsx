import { useState } from 'react'
import { useClosetTreeSwitch } from '@/hooks/useClosetTree'
import type { TreeKind } from '@/lib/standardTree'

/**
 * For a client on Maegan's standard categories (every new client starts on the women's list): which
 * list her Wardrobe and every picker use, Women's or Men's. Shows nothing for an existing client,
 * who keeps her own categories (Karl, 11/12: moving existing clients waits for his decision).
 */
export function StandardTreePanel({ clientId, who }: { clientId: string; who: string }) {
  const { tree, setKind } = useClosetTreeSwitch(clientId)
  const [saving, setSaving] = useState<TreeKind | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  if (!tree) return null

  const pick = async (kind: TreeKind) => {
    if (kind === tree.kind || saving) return
    setSaving(kind)
    setMessage(null)
    const r = await setKind(kind)
    setSaving(null)
    setMessage(r.ok ? `Saved. ${who}'s Wardrobe now uses the ${kind === 'men' ? "men's" : "women's"} categories.` : r.message ?? 'Not saved.')
  }

  return (
    <div className="flex flex-col gap-2 border border-[#E8E5E0] rounded p-3">
      <p className="text-[13px] text-[#1A1A1A]">Standard categories</p>
      <p className="text-[12px] text-[#666] leading-relaxed max-w-[70ch]">
        {who}'s Wardrobe uses Maegan's {tree.kind === 'men' ? "men's" : "women's"} list: {tree.categories.length} main categories, each with its sub-categories. Pick the list that fits.
      </p>
      <div className="flex items-center gap-1 bg-[#F8F7F5] rounded p-0.5 self-start" role="group" aria-label="Standard categories list">
        {([['women', "Women's"], ['men', "Men's"]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => void pick(k)}
            aria-pressed={tree.kind === k}
            disabled={!!saving}
            className={`px-4 py-1.5 text-[11px] tracking-[0.1em] uppercase rounded transition-colors ${tree.kind === k ? 'bg-white text-[#1A1A1A] shadow-sm' : 'text-[#888] hover:text-[#1A1A1A]'}`}
          >{saving === k ? 'Saving…' : label}</button>
        ))}
      </div>
      {message && <p className="text-[12px] text-[#666]" role="status">{message}</p>}
    </div>
  )
}
