import { CloudOff } from 'lucide-react'
import { useAuditStore } from '@/stores/auditStore'
import { FILTER_ORDER } from '@/lib/reconcile'

const DOT: Record<string, string> = {
  good: 'bg-emerald-500', bad: 'bg-rose-500', warn: 'bg-amber-500', info: 'bg-slate-400',
}

// The Audit's filter list — lives in CategorizePanel's left sidebar (in place of the
// look-category brush). Reads counts + the live Drive drop count from the audit store.
export function ReconcileFilterRail() {
  const { filter, counts, driveDrops, setFilter } = useAuditStore()
  return (
    <>
      <p className="text-[9px] tracking-[0.3em] uppercase text-[#888] mb-2">Filter</p>
      <p className="text-[10px] text-[#888] mb-3 leading-relaxed">
        Each item lands in every flag it matches, so a filter is a complete work-list.
      </p>
      <div className="flex flex-col gap-1 overflow-y-auto pr-1">
        {FILTER_ORDER.map((c) => {
          const on = filter === c.key
          return (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded text-[12px] transition-colors ${on ? 'bg-[#1A1A1A] text-white' : 'text-[#1A1A1A] hover:bg-[#F8F7F5]'}`}
            >
              <span className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${DOT[c.tone]}`} />
                {c.label}
              </span>
              <span className={on ? 'text-white/60' : 'text-[#bbb]'}>{counts[c.key] ?? 0}</span>
            </button>
          )
        })}
        {driveDrops != null && (
          <button
            onClick={() => setFilter('drive_drops')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded text-[12px] transition-colors ${filter === 'drive_drops' ? 'bg-[#1A1A1A] text-white' : 'text-[#1A1A1A] hover:bg-[#F8F7F5]'}`}
          >
            <span className="flex items-center gap-2"><CloudOff className="w-3 h-3" /> Unmatched</span>
            <span className={filter === 'drive_drops' ? 'text-white/60' : 'text-amber-600'}>{driveDrops}</span>
          </button>
        )}
      </div>
    </>
  )
}
