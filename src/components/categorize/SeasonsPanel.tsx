import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { TaggableLook, LookCategory } from '@/hooks/useLookCategories'
import { TileImage } from '@/components/common/TileImage'
import { LOOK_TILE_WIDTH } from '@/lib/derivedImage'
import {
  switchState, looksNeedingSeason, categoryIdsForChoice, type SeasonChoice,
} from '@/lib/lookSeasons'

/**
 * SEASONS ON HER LOOKS PAGE. ADR-0154.
 *
 * One switch per client. Off is the page she has today. It cannot be turned on until every look
 * she can see has a season, so no client ever opens on a half-filed page: measured 2026-09-28,
 * 41% of live looks had no season, and opening on one would have hidden most of the gallery for
 * 47 clients.
 *
 * The bar says how many looks stand in the way. "Show them" lists just those, each with SS, FW
 * and Both. Both is for a year-round look (Holiday, an event dress): without it a stylist would be
 * forced to pick a season for a look that has none. A look GoodPix already tagged "ss ..." or
 * "fw ..." shows that season as the suggestion, and "Use GoodPix's season" files every such look
 * in one click. A suggestion is never applied without that click.
 */

const CHOICES: { key: SeasonChoice; label: string; title: string }[] = [
  { key: 'ss', label: 'SS', title: 'Spring/Summer' },
  { key: 'fw', label: 'FW', title: 'Fall/Winter' },
  { key: 'both', label: 'Both', title: 'Both seasons, a year-round look' },
]

export function SeasonsBar({
  looks, categories, on, onToggle, switchError, queueOpen, onToggleQueue, onFilled,
}: {
  looks: TaggableLook[]
  categories: LookCategory[]
  on: boolean | null
  onToggle: (next: boolean) => Promise<boolean>
  switchError: string | null
  queueOpen: boolean
  onToggleQueue: () => void
  onFilled: () => Promise<void> | void
}) {
  const st = useMemo(() => switchState(looks, categories), [looks, categories])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function fillFromGoodPix() {
    const rows: { look_id: string; category_id: string }[] = []
    for (const l of looksNeedingSeason(looks, categories)) {
      if (!l.gpSeason) continue
      for (const category_id of categoryIdsForChoice(l.gpSeason, categories)) rows.push({ look_id: l.id, category_id })
    }
    if (!rows.length) return
    setBusy(true); setNote(null)
    let failed = 0
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from('look_category_assignments').upsert(rows.slice(i, i + 200))
      if (error) { failed += Math.min(200, rows.length - i); console.error('fillFromGoodPix:', error.message) }
    }
    await onFilled()
    setBusy(false)
    setNote(failed ? `${failed} could not be saved. Try again.` : `Filed ${rows.length} from GoodPix.`)
  }

  const label = on === null ? '…' : on ? 'On' : 'Off'

  return (
    <div className="mb-4 px-4 py-3 rounded border border-[#E8E4DF] bg-[#F8F7F5] text-[12px] text-[#1A1A1A]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] tracking-[0.2em] uppercase text-[#888]">Seasons on her Looks page</span>
          <button
            role="switch"
            aria-checked={!!on}
            disabled={on === null || busy || (!on && !st.canTurnOn)}
            onClick={async () => { setBusy(true); await onToggle(!on); setBusy(false) }}
            title={on ? 'Turn off: her Looks page goes back to how it was.' : st.canTurnOn ? 'Turn on for this client.' : 'Every look on her lookbook needs a season first.'}
            className={`px-3 py-1 text-[10px] tracking-[0.15em] uppercase rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${on ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' : 'bg-white text-[#1A1A1A] border-[#E8E4DF]'}`}
          >{label}</button>
        </div>

        {!st.hasBothSeasons ? (
          <span className="text-[#888]">
            Tag one category SS and one FW first, with the small button on the category row.
          </span>
        ) : st.needing === 0 ? (
          <span className="text-[#888]">Every look on her lookbook has a season.</span>
        ) : (
          <>
            <span>
              <strong>{st.needing}</strong> {st.needing === 1 ? 'look has' : 'looks have'} no season.{' '}
              {on ? 'She only sees them under All until they get one.' : 'Give each one a season to turn this on.'}
            </span>
            <button onClick={onToggleQueue} className="text-[10px] tracking-[0.15em] uppercase underline">
              {queueOpen ? 'Back to all looks' : 'Show them'}
            </button>
            {st.suggestable > 0 && (
              <button
                onClick={fillFromGoodPix}
                disabled={busy}
                className="px-2.5 py-1 text-[10px] tracking-[0.12em] uppercase rounded bg-[#1A1A1A] text-white hover:opacity-80 disabled:opacity-40"
                title="These looks already say their season in GoodPix, e.g. “ss office casual”."
              >Use GoodPix's season for {st.suggestable}</button>
            )}
          </>
        )}
      </div>
      {(note || switchError) && <p className="mt-2 text-[11px] text-[#888]">{switchError ?? note}</p>}
    </div>
  )
}

export function SeasonQueue({
  looks, categories, assignLook,
}: {
  looks: TaggableLook[]
  categories: LookCategory[]
  assignLook: (lookId: string, categoryId: string, on: boolean) => Promise<void>
}) {
  const need = useMemo(() => looksNeedingSeason(looks, categories), [looks, categories])
  if (need.length === 0) return <p className="text-[#888] text-sm">Every look on her lookbook has a season.</p>

  async function file(lookId: string, choice: SeasonChoice) {
    for (const id of categoryIdsForChoice(choice, categories)) await assignLook(lookId, id, true)
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-5">
      {need.map((l) => (
        <div key={l.id} className="bg-white rounded-sm border-2 border-transparent">
          <div className="aspect-square flex items-center justify-center p-2 overflow-hidden">
            {l.image
              ? <TileImage src={l.image} width={LOOK_TILE_WIDTH} alt={l.name} className="max-w-full max-h-full object-contain" loading="lazy" />
              : <span className="text-[10px] text-[#bbb]">No picture</span>}
          </div>
          <div className="px-2.5 pb-2.5">
            <p className="text-[11px] text-[#1A1A1A] truncate">{l.name}</p>
            <p className="text-[9px] tracking-[0.1em] uppercase text-[#888] mt-0.5 min-h-[12px]">
              {l.gpSeason ? `GoodPix says ${l.gpSeason === 'ss' ? 'Spring/Summer' : 'Fall/Winter'}` : ''}
            </p>
            <div className="mt-1.5 grid grid-cols-3 gap-1">
              {CHOICES.map((c) => (
                <button
                  key={c.key}
                  onClick={() => { void file(l.id, c.key) }}
                  title={c.title}
                  aria-label={`${l.name}: ${c.title}`}
                  className={`py-1.5 text-[10px] tracking-[0.1em] uppercase rounded border transition-colors ${
                    l.gpSeason === c.key ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' : 'border-[#E8E4DF] text-[#1A1A1A] hover:bg-[#F8F7F5]'
                  }`}
                >{c.label}</button>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
