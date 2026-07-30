import { create } from 'zustand'

type AppView = 'digitize' | 'style' | 'shop'
type StyleTab = 'canvas' | 'categorize'

interface ViewState {
  activeView: AppView
  setActiveView: (view: AppView) => void
  // Sub-tab within the "style" view (Canvas vs Categorize). Lifted out of App's local state so
  // other components (e.g. CategorizePanel's capsule "Edit" action) can switch to Canvas
  // themselves after loading a capsule onto the board.
  styleTab: StyleTab
  setStyleTab: (tab: StyleTab) => void
}

export const useViewStore = create<ViewState>((set) => ({
  activeView: 'style',
  setActiveView: (activeView) => set({ activeView }),
  styleTab: 'canvas',
  setStyleTab: (styleTab) => set({ styleTab }),
}))
