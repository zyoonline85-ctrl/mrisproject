import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useAppStore = create(
  persist(
    (set) => ({
      session: null,
      token: null,
      selectedOutletId: "all",
      sidebarCollapsed: false,
      globalKeyword: "",
      setAuth: ({ user, token }) =>
        set({
          session: user,
          token,
          selectedOutletId: user?.outlet_ids?.length === 1 ? user.outlet_ids[0] : "all"
        }),
      setSession: (session) =>
        set({
          session,
          selectedOutletId: session?.outlet_ids?.length === 1 ? session.outlet_ids[0] : "all"
        }),
      updateSession: (updates) =>
        set((state) => ({
          session: state.session ? { ...state.session, ...updates } : state.session
        })),
      logout: () => set({ session: null, token: null, selectedOutletId: "all" }),
      setSelectedOutletId: (selectedOutletId) => set({ selectedOutletId }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setGlobalKeyword: (globalKeyword) => set({ globalKeyword })
    }),
    {
      name: "pos-barokah-admin",
      version: 2,
      migrate: (persistedState) => {
        if (persistedState?.session && !persistedState?.token) {
          return {
            ...persistedState,
            session: null,
            token: null,
            selectedOutletId: "all"
          };
        }

        return persistedState;
      }
    }
  )
);
