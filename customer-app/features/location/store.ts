"use client";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Address } from "@/lib/types";

/**
 * Where and when: the delivery address (its pincode drives the catalogue) and
 * the chosen delivery day. The day is cleared when the pincode changes, so the
 * API's earliest open day is used.
 */
interface LocationState {
  address: Address | null;
  saved: Address[];
  deliveryDate: string | null;
  setAddress: (a: Address) => void;
  saveAddress: (a: Address) => void;
  removeAddress: (id: string) => void;
  setDeliveryDate: (d: string | null) => void;
}

export const useLocation = create<LocationState>()(
  persist(
    (set) => ({
      address: null,
      saved: [],
      deliveryDate: null,
      setAddress: (address) =>
        set((s) => ({
          address,
          deliveryDate: s.address?.pincode === address.pincode ? s.deliveryDate : null,
          saved: s.saved.some((x) => x.id === address.id) ? s.saved : [address, ...s.saved].slice(0, 6),
        })),
      saveAddress: (a) => set((s) => ({ saved: [a, ...s.saved.filter((x) => x.id !== a.id)].slice(0, 6) })),
      removeAddress: (id) => set((s) => ({ saved: s.saved.filter((x) => x.id !== id), address: s.address?.id === id ? null : s.address })),
      setDeliveryDate: (deliveryDate) => set({ deliveryDate }),
    }),
    { name: "mm.where", storage: createJSONStorage(() => localStorage), skipHydration: true, version: 2 },
  ),
);

export const usePincode = () => useLocation((s) => s.address?.pincode ?? null);
