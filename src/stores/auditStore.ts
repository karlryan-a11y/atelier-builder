import { create } from 'zustand'
import type { FilterKey } from '@/lib/reconcile'

// Shared between the Audit's filter rail (rendered in CategorizePanel's sidebar) and the
// ReconciliationPanel (which owns the data). The panel publishes counts + the live Drive
// drop count; the rail reads them and drives the active filter.
interface AuditState {
  filter: FilterKey
  counts: Partial<Record<FilterKey, number>>
  driveDrops: number | null  // null until a Drive check has run
  setFilter: (f: FilterKey) => void
  setCounts: (c: Partial<Record<FilterKey, number>>) => void
  setDriveDrops: (n: number | null) => void
}

export const useAuditStore = create<AuditState>((set) => ({
  filter: 'all',
  counts: {},
  driveDrops: null,
  setFilter: (filter) => set({ filter }),
  setCounts: (counts) => set({ counts }),
  setDriveDrops: (driveDrops) => set({ driveDrops }),
}))
