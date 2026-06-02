import { create } from 'zustand'
import type { Temperature, Chroma, Depth, Season } from '@/lib/color-analysis'
import type {
  MeasurementPair,
  BrandSizingRow,
  BrandPrefRow,
  SeasonRow,
  ClientDataBundle,
} from '@/lib/client-data'

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
  id: string | null // shopping_sessions.id once persisted
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

// Loaded-client editing state (measurements + brand intelligence). Held outside
// the profile draft because these map to their own tables.
interface ClientDataState {
  loadedClientId: string | null
  profileExists: boolean
  profileLoading: boolean
  profileSaving: boolean
  profileSavedAt: number | null
  measurements: MeasurementPair[]
  measuredOn: string | null
  brandSizing: BrandSizingRow[]
  brandPrefs: BrandPrefRow[]
  seasons: SeasonRow[]
  // ids loaded from the DB — to compute deletes on save
  originalSizingIds: string[]
  originalPrefIds: string[]
  originalMeasurements: MeasurementPair[]
}

const emptyClientData: ClientDataState = {
  loadedClientId: null,
  profileExists: false,
  profileLoading: false,
  profileSaving: false,
  profileSavedAt: null,
  measurements: [],
  measuredOn: null,
  brandSizing: [],
  brandPrefs: [],
  seasons: [],
  originalSizingIds: [],
  originalPrefIds: [],
  originalMeasurements: [],
}

interface ShoppingState extends ClientDataState {
  session: ShoppingSession
  setProfile: (updates: Partial<ClientProfileDraft>) => void
  addSlot: () => void
  addSlots: (items: Partial<ShoppingSlot>[]) => void
  updateSlot: (id: string, updates: Partial<ShoppingSlot>) => void
  removeSlot: (id: string) => void
  setCoworkPrompt: (prompt: string) => void
  setCoworkOutput: (output: string) => void
  setStatus: (status: ShoppingSession['status']) => void
  setSessionId: (id: string | null) => void
  resetSession: () => void

  // Client data (measurements + brand intelligence)
  hydrateClientData: (bundle: ClientDataBundle) => void
  clearClientData: () => void
  setProfileLoading: (loading: boolean) => void
  setProfileSaving: (saving: boolean) => void
  markProfileSaved: () => void

  addMeasurement: () => void
  updateMeasurement: (index: number, updates: Partial<MeasurementPair>) => void
  removeMeasurement: (index: number) => void

  addBrandSizing: () => void
  updateBrandSizing: (index: number, updates: Partial<BrandSizingRow>) => void
  removeBrandSizing: (index: number) => void

  addBrandPref: () => void
  updateBrandPref: (index: number, updates: Partial<BrandPrefRow>) => void
  removeBrandPref: (index: number) => void
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
  ...emptyClientData,

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

  addSlots: (items) =>
    set((state) => ({
      session: {
        ...state.session,
        slots: [
          ...state.session.slots,
          ...items.map((it, i) => ({
            id: `slot_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
            description: it.description ?? '',
            category: it.category ?? '',
            quality_bar: it.quality_bar ?? ('daily_rotation' as const),
            budget_guidance: it.budget_guidance ?? '',
            notes: it.notes ?? '',
          })),
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

  setSessionId: (id) =>
    set((state) => ({
      session: { ...state.session, id },
    })),

  resetSession: () =>
    set({
      session: { ...initialSession, profile: { ...emptyProfile }, slots: [] },
      ...emptyClientData,
    }),

  // ---- Client data ---------------------------------------------------------

  hydrateClientData: (bundle) =>
    set((state) => ({
      session: {
        ...state.session,
        // merge loaded profile fields onto the existing draft (keep client_id/name)
        profile: { ...state.session.profile, ...bundle.draft },
      },
      loadedClientId: state.session.profile.client_id || null,
      profileExists: bundle.profileExists,
      profileLoading: false,
      measurements: bundle.measurements,
      measuredOn: bundle.measuredOn,
      brandSizing: bundle.brandSizing,
      brandPrefs: bundle.brandPrefs,
      seasons: bundle.seasons,
      originalSizingIds: bundle.brandSizing.map((r) => r.id).filter(Boolean) as string[],
      originalPrefIds: bundle.brandPrefs.map((r) => r.id).filter(Boolean) as string[],
      originalMeasurements: bundle.measurements.map((m) => ({ ...m })),
    })),

  clearClientData: () => set({ ...emptyClientData }),

  setProfileLoading: (profileLoading) => set({ profileLoading }),
  setProfileSaving: (profileSaving) => set({ profileSaving }),
  markProfileSaved: () =>
    set((state) => ({
      profileSaving: false,
      profileExists: true,
      profileSavedAt: Date.now(),
      // saved rows are now the baseline for future delete-diffing
      originalSizingIds: state.brandSizing.map((r) => r.id).filter(Boolean) as string[],
      originalPrefIds: state.brandPrefs.map((r) => r.id).filter(Boolean) as string[],
      originalMeasurements: state.measurements.map((m) => ({ ...m })),
    })),

  addMeasurement: () =>
    set((state) => ({ measurements: [...state.measurements, { key: '', value: '' }] })),
  updateMeasurement: (index, updates) =>
    set((state) => ({
      measurements: state.measurements.map((m, i) => (i === index ? { ...m, ...updates } : m)),
    })),
  removeMeasurement: (index) =>
    set((state) => ({ measurements: state.measurements.filter((_, i) => i !== index) })),

  addBrandSizing: () =>
    set((state) => ({
      brandSizing: [
        ...state.brandSizing,
        { brand: '', category: 'top', size: '', fit_note: '' },
      ],
    })),
  updateBrandSizing: (index, updates) =>
    set((state) => ({
      brandSizing: state.brandSizing.map((r, i) => (i === index ? { ...r, ...updates } : r)),
    })),
  removeBrandSizing: (index) =>
    set((state) => ({ brandSizing: state.brandSizing.filter((_, i) => i !== index) })),

  addBrandPref: () =>
    set((state) => ({
      brandPrefs: [...state.brandPrefs, { brand: '', preference: 'preferred', note: '' }],
    })),
  updateBrandPref: (index, updates) =>
    set((state) => ({
      brandPrefs: state.brandPrefs.map((r, i) => (i === index ? { ...r, ...updates } : r)),
    })),
  removeBrandPref: (index) =>
    set((state) => ({ brandPrefs: state.brandPrefs.filter((_, i) => i !== index) })),
}))
