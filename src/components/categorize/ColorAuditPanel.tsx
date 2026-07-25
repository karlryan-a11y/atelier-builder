import { useMemo, useState } from 'react'
import { Loader2, Check, X, Star } from 'lucide-react'
import { useClosetItems } from '@/hooks/useClosetItems'
import { resolveItemImage, displayName, type ClosetItem } from '@/lib/images'
import { supabase } from '@/lib/supabase'
import { COLOR_ORDER, COLOR_SWATCH, MULTI_SWATCH, CUSTOM_SWATCH, colorsOf, normalizeColorName } from '@/lib/colorFamily'

// Colors audit tab (Categorize → Colors). Surfaces items where the vision color audit disagrees
// with the stored primary color (color_audit.flag). The stylist builds the item's color SET —
// primary + any additional colors, including off-palette custom names — then Applies (writes
// gp_closet_items.color_family = primary + color_families = the rest) or Keeps the current color.
// The client's collection + lookbook read both columns.

const PRIO_LABEL: Record<string, string> = {
  print: 'Prints → Multicolor',
  recolor: 'Recolors',
  neutral: 'Neutral nuance (ivory · white · beige / black · grey / gold · silver)',
}
const PRIO_ORDER = ['print', 'recolor', 'neutral'] as const
const LIGHT = new Set(['White', 'Ivory', 'Blush', 'Light Blue', 'Yellow'])

function swatchBg(c: string): string {
  if (c === 'Multicolor') return MULTI_SWATCH
  return COLOR_SWATCH[c] ?? CUSTOM_SWATCH
}

function Swatch({ c }: { c: string }) {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1"
      style={{ background: swatchBg(c), boxShadow: LIGHT.has(c) ? 'inset 0 0 0 1px rgba(0,0,0,.2)' : undefined }}
    />
  )
}

export function ColorAuditPanel({ clientId }: { clientId: string | null }) {
  const { items, loading, refetch } = useClosetItems(clientId)
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())
  // Working color set per item, primary first. Undefined = not yet touched (seed on first render).
  const [sel, setSel] = useState<Record<string, string[]>>({})

  const flagged = useMemo(
    () => items.filter((it) => it.color_audit?.flag && it.color_audit?.status === 'pending' && !done.has(it.id)),
    [items, done],
  )

  // Seed the working set for an item: its current color set, else the audit suggestion, else current primary.
  function colorsFor(it: ClosetItem): string[] {
    if (sel[it.id]) return sel[it.id]
    const existing = colorsOf(it)
    if (existing.length) return existing
    const s = it.color_audit?.suggested
    if (s) return [String(s)]
    return it.color_family ? [it.color_family] : []
  }

  function update(id: string, next: string[]) {
    setSel((p) => ({ ...p, [id]: next }))
  }
  function addColor(it: ClosetItem, c: string) {
    const cur = colorsFor(it)
    if (c && !cur.includes(c)) update(it.id, [...cur, c])
  }
  function removeColor(it: ClosetItem, c: string) {
    update(it.id, colorsFor(it).filter((x) => x !== c))
  }
  function makePrimary(it: ClosetItem, c: string) {
    const cur = colorsFor(it)
    update(it.id, [c, ...cur.filter((x) => x !== c)])
  }

  async function resolve(it: ClosetItem, mode: 'apply' | 'keep') {
    const audit = it.color_audit!
    setBusy(it.id)
    let patch: Record<string, unknown>
    if (mode === 'apply') {
      const set = colorsFor(it)
      const primary = set[0] ?? it.color_family ?? ''
      const extras = set.slice(1)
      patch = {
        color_family: primary,
        color_families: extras,
        color_audit: { ...audit, status: 'applied', applied: set.join(', ') },
      }
    } else {
      patch = { color_audit: { ...audit, status: 'dismissed' } }
    }
    const { error } = await supabase.from('gp_closet_items').update(patch).eq('id', it.id)
    setBusy(null)
    if (error) { alert('Save failed — ' + error.message); return }
    setDone((p) => new Set(p).add(it.id))
    refetch()
  }

  if (!clientId) return <div className="flex-1 flex items-center justify-center text-[#888] text-sm">Select a client.</div>
  if (loading && !items.length)
    return <div className="flex-1 flex items-center justify-center text-[#888]"><Loader2 className="w-5 h-5 animate-spin" /></div>

  const groups = PRIO_ORDER
    .map((p) => ({ p, rows: flagged.filter((it) => (it.color_audit?.priority ?? 'recolor') === p) }))
    .filter((g) => g.rows.length)

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mb-5">
        <p className="text-[13px] text-[#1A1A1A]">
          {flagged.length ? (
            <><b>{flagged.length}</b> item{flagged.length === 1 ? '' : 's'} where the vision audit disagrees with the stored color.</>
          ) : (
            'All caught up — no color flags pending.'
          )}
        </p>
        <p className="text-[11px] text-[#888] mt-1">
          Build the color set — the first chip is the primary. Add more than one color, or “＋ New color” to name one that isn’t listed
          (e.g. a white sweater with bold red → White + Red). Apply writes straight to the client’s collection + lookbook.
        </p>
      </div>

      {groups.map(({ p, rows }) => (
        <div key={p} className="mb-8">
          <p className="text-[10px] tracking-[0.25em] uppercase text-[#888] mb-3 border-b border-[#E8E4DF] pb-1.5">
            {PRIO_LABEL[p]} · {rows.length}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rows.map((it) => {
              const audit = it.color_audit!
              const img = resolveItemImage(it)
              const current = it.color_family ?? '—'
              const set = colorsFor(it)
              const addable = COLOR_ORDER.filter((c) => !set.includes(c))
              return (
                <div key={it.id} className="flex gap-3 border border-[#EEE] rounded-lg p-3 bg-white">
                  <div className="w-20 h-24 flex-none bg-[#FAF9F7] rounded flex items-center justify-center overflow-hidden">
                    {img ? <img src={img} alt="" className="max-w-full max-h-full object-contain" loading="lazy" /> : null}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-[#1A1A1A] truncate">{displayName(it)}</p>
                    {it.brand && it.brand !== 'None' && <p className="text-[10px] text-[#888] truncate">{it.brand}</p>}
                    <div className="text-[12px] mt-1.5 flex items-center flex-wrap">
                      <span className="text-[#888]"><Swatch c={current} />{current}</span>
                      <span className="mx-1.5 text-[#bbb]">→</span>
                      <span className="text-[#1A7A4A] font-medium"><Swatch c={String(audit.suggested)} />{audit.suggested}</span>
                    </div>
                    {audit.reason && <p className="text-[10px] text-[#999] mt-1 line-clamp-2">{audit.reason}</p>}

                    {/* Color-set chip editor: first chip = primary. */}
                    <div className="flex items-center gap-1 mt-2 flex-wrap">
                      {set.map((c, i) => (
                        <span
                          key={c}
                          className={`inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded text-[11px] border ${
                            i === 0 ? 'border-[#1A1A1A] bg-[#F5F3F0] text-[#1A1A1A]' : 'border-[#DDD] text-[#555]'
                          }`}
                        >
                          {i === 0 ? (
                            <Star className="w-2.5 h-2.5 fill-[#1A1A1A]" />
                          ) : (
                            <button title="Make primary" onClick={() => makePrimary(it, c)} className="hover:text-[#1A1A1A]">
                              <Star className="w-2.5 h-2.5" />
                            </button>
                          )}
                          <Swatch c={c} />
                          {c}
                          <button title="Remove" onClick={() => removeColor(it, c)} className="ml-0.5 text-[#bbb] hover:text-[#a33]">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      <select
                        value=""
                        onChange={(e) => {
                          const v = e.target.value
                          if (!v) return
                          if (v === '__new__') {
                            const n = window.prompt('New color name (e.g. Hot Pink):')
                            if (n && n.trim()) addColor(it, normalizeColorName(n))
                          } else {
                            addColor(it, v)
                          }
                          e.target.value = ''
                        }}
                        className="text-[11px] border border-[#DDD] rounded px-1.5 py-1 bg-white"
                      >
                        <option value="">＋ Add color…</option>
                        {addable.map((c) => <option key={c} value={c}>{c}</option>)}
                        <option value="__new__">＋ New color…</option>
                      </select>
                      <button
                        disabled={busy === it.id || !set.length}
                        onClick={() => resolve(it, 'apply')}
                        className="px-2.5 py-1 text-[11px] rounded bg-[#1A1A1A] text-white hover:opacity-80 disabled:opacity-40 flex items-center gap-1"
                      >
                        {busy === it.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Apply
                      </button>
                      <button
                        disabled={busy === it.id}
                        onClick={() => resolve(it, 'keep')}
                        className="px-2 py-1 text-[11px] rounded border border-[#E8E4DF] text-[#888] hover:text-[#1A1A1A] disabled:opacity-40"
                      >
                        Keep {current}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
