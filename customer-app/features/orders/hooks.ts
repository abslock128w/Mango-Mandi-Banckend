"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSignedIn } from "@/features/auth/store";
import { useUi } from "@/features/shell/ui-store";
import { api, qk } from "@/lib/api/client";
import type { Order, OrderStatus } from "@/lib/types";

/** Nothing more will happen to these (a claim is raised from its own page). */
export const TERMINAL: OrderStatus[] = ["DELIVERED", "CANCELLED", "RTO"];
export const CANCELLABLE: OrderStatus[] = ["PAYMENT_PENDING", "CONFIRMED", "PROCESSING"];
/** The API lets a customer move only a confirmed order (mango-api CUSTOMER_MOVABLE). */
export const MOVABLE: OrderStatus[] = ["CONFIRMED"];

const useReady = () => {
  const hydrated = useUi((s) => s.hydrated);
  const signedIn = useSignedIn();
  return { hydrated, signedIn, ready: hydrated && signedIn };
};

/**
 * One order, polled every 30 s while it is still moving (every 5 s while the
 * payment is pending, asking the payment status first so a late webhook can't
 * keep it waiting).
 */
export function useOrder(id: string) {
  const qc = useQueryClient();
  const { ready } = useReady();
  return useQuery({
    queryKey: qk.order(id),
    queryFn: async () => {
      if (qc.getQueryData<Order>(qk.order(id))?.status === "PAYMENT_PENDING") await api.paymentStatus(id).catch(() => null);
      return api.order(id);
    },
    enabled: ready,
    refetchInterval: (q) => {
      const o = q.state.data;
      if (!o) return false;
      if (o.status === "PAYMENT_PENDING") return 5000;
      return TERMINAL.includes(o.status) ? false : 30_000;
    },
  });
}

export function useOrders() {
  const { ready } = useReady();
  return useQuery({ queryKey: qk.orders, queryFn: api.orders, enabled: ready, refetchInterval: 30_000 });
}

export function useClaims(enabled = true) {
  const { ready } = useReady();
  return useQuery({ queryKey: qk.claims, queryFn: api.claims, enabled: ready && enabled });
}

export { useReady as useSignedInReady };
