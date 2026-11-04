"use client";

// Fly to cart (fly.ts) is only needed on a tap, so it loads after the page, not with it: fetched
// when the browser is idle, and on the first tap if that comes sooner.
import type { FlyPhoto } from "./fly";

let mod: Promise<typeof import("./fly")> | null = null;
// A failed download is tried again on the next tap.
const load = () =>
  (mod ??= import("./fly").catch((e) => {
    mod = null;
    throw e;
  }));

export function prefetchFly() {
  if (typeof window === "undefined" || mod) return;
  const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(() => void load());
  else window.setTimeout(() => void load(), 1500);
}

/** The card's photo (or the product page's) and where it is, read at the tap while layout is clean. */
function photoAt(from: Element): FlyPhoto | null {
  const scope = from.closest("[data-fly-scope]");
  const img = scope?.querySelector<HTMLImageElement>("[data-fly-image] img") ?? document.querySelector<HTMLImageElement>('[data-fly-image="main"] img');
  if (!img?.currentSrc) return null;
  const r = img.getBoundingClientRect();
  if (!(r.width > 0 && r.bottom > 0 && r.top < window.innerHeight)) return null;
  return { src: img.currentSrc, x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Sends the tapped card's photo into the cart bar (fly.ts). Everything about the photo is read now,
 * at the tap: by the time the code is in, the ADD button may have become the stepper. The flight
 * starts a frame later, so the frame that shows the stepper stays light. Phones only, never under
 * reduced motion.
 */
export function fly(from: Element) {
  if (window.matchMedia("(min-width: 1024px), (prefers-reduced-motion: reduce)").matches) return;
  const photo = photoAt(from);
  if (!photo) return;
  void load().then(
    (m) => requestAnimationFrame(() => m.flyToCart(photo)),
    () => {},
  );
}
