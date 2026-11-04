"use client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { usePincode, useLocation } from "@/features/location/store";
import { useUi } from "@/features/shell/ui-store";
import { api, qk } from "@/lib/api/client";
import { buildProducts, productsFromCatalogue } from "@/lib/catalog";
import { dayName, windowLabel } from "@/lib/format";
import type { Product } from "@/lib/types";

export const usePolicy = () => useQuery({ queryKey: qk.policy, queryFn: api.policy, staleTime: 10 * 60_000 });

/** Serviceability, open days, cutoff and slots for the pincode. */
export function useDelivery() {
  const pincode = usePincode();
  return useQuery({ queryKey: qk.delivery(pincode), queryFn: () => api.deliveryCheck(pincode!), enabled: Boolean(pincode), staleTime: 5 * 60_000 });
}

/** The delivery day in use: the shopper's pick if still open, else the earliest. */
export function useDeliveryDate(): string | null {
  const chosen = useLocation((s) => s.deliveryDate);
  const { data } = useDelivery();
  if (!data?.serviceable) return null;
  if (chosen && data.deliveryDates.includes(chosen)) return chosen;
  return data.earliestDeliveryDate ?? data.deliveryDates[0] ?? null;
}

/** Price list (no pincode yet) from /products. */
export const usePriceList = () => useQuery({ queryKey: qk.products, queryFn: api.products, staleTime: 10 * 60_000, select: (d) => buildProducts(d.items) });

/**
 * Products for the shop: the catalogue for the pincode and day (stock per stage)
 * when a pincode is set, else the plain price list.
 */
export function useProducts(): { data: Product[] | undefined; isPending: boolean; serviceable: boolean | null } {
  const pincode = usePincode();
  const hydrated = useUi((s) => s.hydrated);
  const date = useDeliveryDate();
  const delivery = useDelivery();
  const cat = useQuery({
    queryKey: qk.catalogue(pincode, date),
    queryFn: () => api.catalogue(pincode!, date),
    enabled: Boolean(pincode && date),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  const list = usePriceList();
  const fromCat = useMemo(() => productsFromCatalogue(cat.data), [cat.data]);
  if (hydrated && pincode) {
    if (delivery.data && !delivery.data.serviceable) return { data: list.data, isPending: false, serviceable: false };
    return { data: cat.data ? fromCat : undefined, isPending: !cat.data, serviceable: true };
  }
  return { data: list.data, isPending: list.isPending, serviceable: null };
}

export function useProduct(id: string | null) {
  const { data, isPending } = useProducts();
  return { data: id ? data?.find((p) => p.id === id) : undefined, isPending };
}

/** The header and card line: "Tomorrow, 7 to 11 am" and "TOMORROW 7 AM". */
export function useNextSlot() {
  const { data } = useDelivery();
  const date = useDeliveryDate();
  if (!data?.serviceable || !date) return undefined;
  const slot = [...data.slots].filter((s) => s.active !== false).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const day = dayName(date);
  const window = slot ? windowLabel(slot.startsAt, slot.endsAt) : "";
  const hour = slot ? slot.startsAt.slice(0, 2) : null;
  const short = `${day.toUpperCase()}${hour ? ` ${Number(hour) % 12 || 12} ${Number(hour) < 12 ? "AM" : "PM"}` : ""}`;
  return { date, dayLabel: day, window, label: window ? `${day}, ${window}` : day, short, cutoff: data.cutoffTime };
}

export const usePreorderWeeks = () => useQuery({ queryKey: qk.preorderWeeks, queryFn: () => api.preorderWeeks(), staleTime: 5 * 60_000 });

export function useBulkDeals() {
  const pincode = usePincode();
  return useQuery({ queryKey: qk.bulkDeals(pincode), queryFn: () => api.bulkDeals(pincode), staleTime: 2 * 60_000 });
}

export function useReviews(sku: string | null | undefined) {
  return useQuery({ queryKey: qk.reviews(sku ?? ""), queryFn: () => api.reviews(sku!, { limit: 6 }), enabled: Boolean(sku), staleTime: 10 * 60_000 });
}
