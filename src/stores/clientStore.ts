import { create } from 'zustand'

interface Client {
  id: string
  name: string
}

interface ClientState {
  activeClient: Client | null
  setActiveClient: (client: Client | null) => void
}

export const useClientStore = create<ClientState>((set) => ({
  activeClient: null,
  setActiveClient: (client) => set({ activeClient: client }),
}))
