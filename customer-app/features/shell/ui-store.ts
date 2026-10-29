"use client";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface Toast {
  id: number;
  title: string;
  tone?: "default" | "success" | "danger";
  action?: { label: string; href?: string };
  duration?: number;
}

interface UiState {
  hydrated: boolean;
  cartOpen: boolean;
  recentSearches: string[];
  toasts: Toast[];
  notified: string[];
  setHydrated: () => void;
  setCartOpen: (open: boolean) => void;
  addRecent: (q: string) => void;
  clearRecent: () => void;
  toast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
  markNotified: (key: string) => void;
}

let toastId = 1;

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      hydrated: false,
      cartOpen: false,
      recentSearches: [],
      toasts: [],
      notified: [],
      setHydrated: () => set({ hydrated: true }),
      setCartOpen: (cartOpen) => set({ cartOpen }),
      addRecent: (q) => {
        const v = q.trim();
        if (!v) return;
        set((s) => ({ recentSearches: [v, ...s.recentSearches.filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, 6) }));
      },
      clearRecent: () => set({ recentSearches: [] }),
      toast: (t) => set((s) => ({ toasts: [...s.toasts.slice(-2), { duration: 3000, tone: "default", ...t, id: toastId++ }] })),
      dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      markNotified: (key) => set((s) => ({ notified: s.notified.includes(key) ? s.notified : [...s.notified, key] })),
    }),
    {
      name: "mm.ui",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({ recentSearches: s.recentSearches, notified: s.notified }),
    },
  ),
);

export const toast = (t: Omit<Toast, "id">) => useUi.getState().toast(t);
