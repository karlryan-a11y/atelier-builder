import { create } from 'zustand'

type AppView = 'digitize' | 'style' | 'shop'

interface ViewState {
  activeView: AppView
  setActiveView: (view: AppView) => void
}

export const useViewStore = create<ViewState>((set) => ({
  activeView: 'style',
  setActiveView: (activeView) => set({ activeView }),
}))
