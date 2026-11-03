"use client";

// Fly to cart (fly.ts) is only needed on a tap, so it loads after the page, not with it: fetched
// when the browser is idle, and on the first tap if that comes sooner.
let mod: Promise<typeof import("./fly")> | null = null;
const load = () => (mod ??= import("./fly"));

export function prefetchFly() {
  if (typeof window === "undefined" || mod) return;
  const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(() => void load());
  else window.setTimeout(() => void load(), 1500);
}

/** flyToCart (fly.ts), once its code is in. */
export function fly(from: Element) {
  void load().then((m) => m.flyToCart(from));
}
