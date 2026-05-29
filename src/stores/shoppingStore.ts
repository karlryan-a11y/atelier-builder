import { create } from 'zustand'
import type { Temperature, Chroma, Depth, Season } from '@/lib/color-analysis'

export interface ShoppingSlot {
  id: string
  description: string
  category: string
  quality_bar: 'daily_rotation' | 'hero_piece'
  budget_guidance: string
  notes: string
}

export interface ClientProfileDraft {
  client_id: string
  client_name: string
  is_new_client: boolean

  size_top: string
  size_bottom: string
  size_dress: string
  size_outerwear: string
  size_shoe: string
  size_intimates: string
  size_accessories: string

  style_story: string
  occasions: string[]
  color_likes: string
  color_dislikes: string
  fabric_likes: string
  fabric_dislikes: string

  // Color analysis (WSG Color Analysis SOP)
  color_temperature: Temperature
  color_chroma: Chroma
  color_depth: Depth
  color_season: Season
  color_analysis_notes: string

  brand_preferred: string[]
  brand_blocked: string[]

  no_fly_list: string
  gap_notes: string
  general_notes: string

  ship_to_address: string
  deliver_by: string
  return_tolerance: 'standard' | 'aggressive' | 'conservative'
  budget_total: string
}

export interface ShoppingSession {
  id: string | null
  status: 'intake' | 'brief_locked' | 'sourcing' | 'review_round_1' | 'review_round_2' | 'cart_ready' | 'checkout' | 'ordered' | 'tryon' | 'complete'
  profile: ClientProfileDraft
  slots: ShoppingSlot[]
  cowork_prompt: string | null
  cowork_output: string | null
}

const emptyProfile: ClientProfileDraft = {
  client_id: '',
  client_name: '',
  is_new_client: false,
  size_top: '',
  size_bottom: '',
  size_dress: '',
  size_outerwear: '',
  size_shoe: '',
  size_intimates: '',
  size_accessories: '',
  style_story: '',
  occasions: [],
  color_likes: '',
  color_dislikes: '',
  fabric_likes: '',
  fabric_dislikes: '',
  color_temperature: '',
  color_chroma: '',
  color_depth: '',
  color_season: '',
  color_analysis_notes: '',
  brand_preferred: [],
  brand_blocked: [],
  no_fly_list: '',
  gap_notes: '',
  general_notes: '',
  ship_to_address: '',
  deliver_by: '',
  return_tolerance: 'standard',
  budget_total: '',
}

interface ShoppingState {
  session: ShoppingSession
  setProfile: (updates: Partial<ClientProfileDraft>) => void
  addSlot: () => void
  updateSlot: (id: string, updates: Partial<ShoppingSlot>) => void
  removeSlot: (id: string) => void
  setCoworkPrompt: (prompt: string) => void
  setCoworkOutput: (output: string) => void
  setStatus: (status: ShoppingSession['status']) => void
  resetSession: () => void
}

function makeSlotId() {
  return `slot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

const initialSession: ShoppingSession = {
  id: null,
  status: 'intake',
  profile: { ...emptyProfile },
  slots: [],
  cowork_prompt: null,
  cowork_output: null,
}

export const useShoppingStore = create<ShoppingState>((set) => ({
  session: { ...initialSession },

  setProfile: (updates) =>
    set((state) => ({
      session: {
        ...state.session,
        profile: { ...state.session.profile, ...updates },
      },
    })),

  addSlot: () =>
    set((state) => ({
      session: {
        ...state.session,
        slots: [
          ...state.session.slots,
          {
            id: makeSlotId(),
            description: '',
            category: '',
            quality_bar: 'daily_rotation',
            budget_guidance: '',
            notes: '',
          },
        ],
      },
    })),

  updateSlot: (id, updates) =>
    set((state) => ({
      session: {
        ...state.session,
        slots: state.session.slots.map((s) =>
          s.id === id ? { ...s, ...updates } : s
        ),
      },
    })),

  removeSlot: (id) =>
    set((state) => ({
      session: {
        ...state.session,
        slots: state.session.slots.filter((s) => s.id !== id),
      },
    })),

  setCoworkPrompt: (prompt) =>
    set((state) => ({
      session: { ...state.session, cowork_prompt: prompt },
    })),

  setCoworkOutput: (output) =>
    set((state) => ({
      session: { ...state.session, cowork_output: output },
    })),

  setStatus: (status) =>
    set((state) => ({
      session: { ...state.session, status },
    })),

  resetSession: () =>
    set({ session: { ...initialSession, profile: { ...emptyProfile }, slots: [] } }),
}))
