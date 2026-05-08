import { useState } from 'react'
import { Inbox, Check, ChevronLeft } from 'lucide-react'
import { useIntakeItems, type IntakeItem } from '@/hooks/useIntakeItems'
import { IntakeItemCard } from './IntakeItemCard'
import { IntakeItemDetail } from './IntakeItemDetail'

interface IntakeInboxProps {
  onClose: () => void
}

export function IntakeInbox({ onClose }: IntakeInboxProps) {
  const [filter, setFilter] = useState<'pending_review' | 'approved' | 'rejected' | 'all'>('pending_review')
  const { items, loading, error, refresh, counts } = useIntakeItems(filter)
  const [selectedItem, setSelectedItem] = useState<IntakeItem | null>(null)

  const tabs = [
    { key: 'pending_review' as const, label: 'Pending', count: counts.pending },
    { key: 'approved' as const, label: 'Approved', count: counts.approved },
    { key: 'rejected' as const, label: 'Rejected', count: counts.rejected },
  ]

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      {/* Header */}
      <div className="h-14 bg-[#1A1A1A] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={selectedItem ? () => setSelectedItem(null) : onClose}
            className="text-white/60 hover:text-white transition-colors flex items-center gap-1"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="text-[11px] tracking-[0.15em] uppercase">
              {selectedItem ? 'Back' : 'Builder'}
            </span>
          </button>
          <div className="w-px h-5 bg-white/10" />
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-blush" />
            <span className="text-[11px] tracking-[0.15em] uppercase text-white">
              Intake Inbox
            </span>
          </div>
        </div>

        {counts.pending > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] tracking-[0.2em] uppercase text-white/40">
              {counts.pending} pending
            </span>
            <div className="w-2 h-2 rounded-full bg-blush animate-pulse" />
          </div>
        )}
      </div>

      {/* Tabs */}
      {!selectedItem && (
        <div className="flex border-b border-[#E8E4DF] shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`
                flex-1 px-4 py-3 text-[11px] tracking-[0.2em] uppercase font-sans
                transition-colors relative
                ${filter === tab.key
                  ? 'text-[#1A1A1A] border-b-2 border-[#1A1A1A]'
                  : 'text-[#888] hover:text-[#1A1A1A]'
                }
              `}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className={`
                  ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px]
                  rounded-full text-[9px] font-medium px-1
                  ${tab.key === 'pending_review' ? 'bg-blush text-[#1A1A1A]' : 'bg-[#E8E4DF] text-[#888]'}
                `}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {selectedItem ? (
          <IntakeItemDetail
            item={selectedItem}
            onBack={() => setSelectedItem(null)}
            onAction={() => {
              setSelectedItem(null)
              refresh()
            }}
          />
        ) : loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="w-8 h-8 mx-auto border-2 border-[#E8E4DF] border-t-[#1A1A1A] rounded-full animate-spin mb-3" />
              <p className="text-[11px] tracking-[0.15em] uppercase text-[#888]">Loading...</p>
            </div>
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="text-sm text-red-600 mb-2">{error}</p>
            <button onClick={refresh} className="text-[11px] tracking-[0.15em] uppercase text-[#1A1A1A] underline">
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              {filter === 'pending_review' ? (
                <>
                  <Check className="h-8 w-8 mx-auto text-emerald-400 mb-3" />
                  <p className="text-sm text-[#888]">All caught up!</p>
                  <p className="text-xs text-[#aaa] mt-1">No items waiting for review.</p>
                </>
              ) : (
                <>
                  <Inbox className="h-8 w-8 mx-auto text-[#ccc] mb-3" />
                  <p className="text-sm text-[#888]">No {filter.replace('_', ' ')} items</p>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4 md:p-6">
            {items.map(item => (
              <IntakeItemCard
                key={item.id}
                item={item}
                onClick={() => setSelectedItem(item)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
