"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LazyMotion, MotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import { api, ApiError, SIGNOUT_EVENT } from "@/lib/api/client";
import { useAuth } from "@/features/auth/store";
import { useCart } from "@/features/cart/store";
import { useLocation } from "@/features/location/store";
import { useUi } from "./ui-store";

const loadMotionFeatures = () => import("@/lib/motion-features").then((m) => m.default);

function useHydrateStores(client: QueryClient) {
  useEffect(() => {
    useAuth.getState().sync();
    Promise.all([useCart.persist.rehydrate(), useLocation.persist.rehydrate(), useUi.persist.rehydrate()]).finally(() => useUi.getState().setHydrated());
    // A stored profile gets a fresh access token from the refresh cookie.
    api.restore().finally(() => useAuth.getState().sync());
    // Sign-out: personal data leaves the cache; a chosen sign-out also empties the cart.
    const onSignOut = (e: Event) => {
      client.removeQueries({ predicate: (q) => ["orders", "order", "claims", "preorders", "preorder", "me", "addresses", "stock-alerts"].includes(String(q.queryKey[0])) });
      if ((e as CustomEvent<{ forget?: boolean }>).detail?.forget) useCart.getState().clear();
    };
    window.addEventListener(SIGNOUT_EVENT, onSignOut);
    return () => window.removeEventListener(SIGNOUT_EVENT, onSignOut);
  }, [client]);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Retry once on network or server errors only (never on 4xx answers).
            retry: (n, e) => n < 1 && (!(e instanceof ApiError) || e.status === 0 || e.status >= 500),
            refetchOnWindowFocus: true,
            staleTime: 10_000,
          },
        },
      }),
  );
  useHydrateStores(client);
  return (
    <QueryClientProvider client={client}>
      {/* Every Motion animation respects prefers-reduced-motion. */}
      <MotionConfig reducedMotion="user">
        <LazyMotion features={loadMotionFeatures} strict>
          {children}
        </LazyMotion>
      </MotionConfig>
    </QueryClientProvider>
  );
}
