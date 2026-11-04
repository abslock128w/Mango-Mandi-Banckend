"use client";
import { useSyncExternalStore } from "react";

function subscribe(query: string) {
  return (cb: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener("change", cb);
    return () => mql.removeEventListener("change", cb);
  };
}

export function useMedia(query: string, serverValue = false) {
  return useSyncExternalStore(
    subscribe(query),
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** Laptops: bottom sheets become side panels at 1024px and up. */
export const useIsDesktop = () => useMedia("(min-width: 1024px)");
export const usePrefersReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)");
