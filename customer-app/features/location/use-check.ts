"use client";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { Address } from "@/lib/types";
import { useLocation } from "./store";

export const isPincode = (v: string) => /^[1-9]\d{5}$/.test(v);

export function makeAddress(p: { pincode: string; city: string; area?: string; lat?: number; lng?: number; label?: Address["label"]; line2?: string }): Address {
  return {
    id: `a-${p.pincode}-${Math.round((p.lat ?? 0) * 1e4)}-${Math.round((p.lng ?? 0) * 1e4)}`,
    label: p.label ?? "Home",
    line1: p.area || `Pincode ${p.pincode}`,
    line2: p.line2,
    pincode: p.pincode,
    city: p.city,
    lat: p.lat ?? 0,
    lng: p.lng ?? 0,
  };
}

export function useServiceability() {
  const setAddress = useLocation((s) => s.setAddress);
  const m = useMutation({ mutationFn: (pincode: string) => api.deliveryCheck(pincode) });
  return { ...m, setAddress };
}
