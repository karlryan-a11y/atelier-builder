import { create } from 'zustand'
import type { ParsedSlot, ParsedOption } from '@/lib/cowork-parser'

export interface BoardOption extends ParsedOption {
  id: string
  status: 'pending' | 'approved' | 'rejected' | 'swapped'
  rejection_reasons: string[]
  feedback_note: string
  size_override: string
  color_override: string
  tryon_status: 'pending' | 'kept' | 'returned' | 'exchanged' | null
  exchange_notes: string
  closet_item_id: string | null
}

export interface BoardSlot {
  id: string
  description: string
  status: 'pending' | 'approved' | 'rejected' | 'escalated'
  options: BoardOption[]
}

interface BoardState {
  slots: BoardSlot[]
  round: 1 | 2
  view: 'slot' | 'look' | 'cart'
  loadFromParsed: (parsed: ParsedSlot[]) => void
  hydrate: (slots: BoardSlot[], round?: 1 | 2) => void
  reviewOption: (optionId: string, action: 'approve' | 'reject' | 'swap', data?: {
    rejection_reasons?: string[]
    feedback_note?: string
    size_override?: string
    color_override?: string
  }) => void
  rejectSlot: (slotId: string) => void
  escalateSlot: (slotId: string) => void
  setView: (view: 'slot' | 'look' | 'cart') => void
  advanceToRound2: () => void
  getApprovedOptions: () => BoardOption[]
  setTryonStatus: (optionId: string, status: 'kept' | 'returned' | 'exchanged', exchangeNotes?: string) => void
  markAddedToCloset: (optionId: string, closetItemId: string) => void
  reset: () => void
}

let idCounter = 0
function nextId(prefix: string) {
  return `${prefix}_${++idCounter}_${Math.random().toString(36).slice(2, 6)}`
}

export const useBoardStore = create<BoardState>((set, get) => ({
  slots: [],
  round: 1,
  view: 'slot',

  loadFromParsed: (parsed) => {
    const slots: BoardSlot[] = parsed.map((s) => ({
      id: nextId('slot'),
      description: s.description,
      status: 'pending',
      options: s.options.map((o) => ({
        ...o,
        id: nextId('opt'),
        status: 'pending',
        rejection_reasons: [],
        feedback_note: '',
        size_override: '',
        color_override: '',
        tryon_status: null,
        exchange_notes: '',
        closet_item_id: null,
      })),
    }))
    set({ slots, round: 1, view: 'slot' })
  },

  // Load fully-formed board slots (e.g. resumed from the DB with prior review +
  // try-on decisions already applied). Slots carry their own ids/statuses.
  hydrate: (slots, round = 1) => set({ slots, round, view: 'slot' }),

  reviewOption: (optionId, action, data) =>
    set((state) => ({
      slots: state.slots.map((slot) => {
        const hasOption = slot.options.some((o) => o.id === optionId)
        if (!hasOption) return slot

        const updatedOptions = slot.options.map((o) => {
          if (o.id !== optionId) return o
          return {
            ...o,
            status: action === 'approve' ? 'approved' as const : action === 'reject' ? 'rejected' as const : 'swapped' as const,
            rejection_reasons: data?.rejection_reasons ?? o.rejection_reasons,
            feedback_note: data?.feedback_note ?? o.feedback_note,
            size_override: data?.size_override ?? o.size_override,
            color_override: data?.color_override ?? o.color_override,
          }
        })

        const hasApproved = updatedOptions.some((o) => o.status === 'approved')
        return {
          ...slot,
          options: updatedOptions,
          status: hasApproved ? 'approved' as const : slot.status,
        }
      }),
    })),

  rejectSlot: (slotId) =>
    set((state) => ({
      slots: state.slots.map((s) =>
        s.id === slotId ? { ...s, status: 'rejected' as const } : s
      ),
    })),

  escalateSlot: (slotId) =>
    set((state) => ({
      slots: state.slots.map((s) =>
        s.id === slotId ? { ...s, status: 'escalated' as const } : s
      ),
    })),

  setView: (view) => set({ view }),

  advanceToRound2: () => set({ round: 2 }),

  getApprovedOptions: () => {
    return get().slots.flatMap((s) => s.options.filter((o) => o.status === 'approved'))
  },

  setTryonStatus: (optionId, status, exchangeNotes) =>
    set((state) => ({
      slots: state.slots.map((slot) => ({
        ...slot,
        options: slot.options.map((o) =>
          o.id === optionId
            ? { ...o, tryon_status: status, exchange_notes: exchangeNotes ?? o.exchange_notes }
            : o
        ),
      })),
    })),

  markAddedToCloset: (optionId, closetItemId) =>
    set((state) => ({
      slots: state.slots.map((slot) => ({
        ...slot,
        options: slot.options.map((o) =>
          o.id === optionId ? { ...o, closet_item_id: closetItemId } : o
        ),
      })),
    })),

  reset: () => set({ slots: [], round: 1, view: 'slot' }),
}))
