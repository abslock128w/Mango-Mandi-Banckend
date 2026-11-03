"use client";

/*
 * Fly to cart (docs/design/shop-motion.md, "Product card, ADD, cart"). On a phone, adding a box
 * sends a 40 px copy of its photo along an arc into the cart bar's thumbnail stack: transform-only
 * keyframes, 380 ms on the emphasized curve, shrinking to 0.4 and fading over the last 20%. Then the
 * bar pulses (cart-bar.tsx waits for `landing()`). One at a time: a second add cancels the copy in
 * flight. Never on laptops (the header cart only pulses) or under reduced motion.
 */
const SIZE = 40;
const DURATION = 380;

let current: { el: HTMLElement; anim: Animation } | null = null;
let landsAt = 0;

/** Milliseconds until the copy in flight reaches the cart bar (0 when nothing is flying). */
export function landing() {
  return Math.max(0, landsAt - performance.now());
}

function source(from: Element): HTMLImageElement | null {
  const scope = from.closest("[data-fly-scope]");
  const img = scope?.querySelector<HTMLImageElement>("[data-fly-image] img") ?? document.querySelector<HTMLImageElement>('[data-fly-image="main"] img');
  if (!img || !img.currentSrc) return null;
  const r = img.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight ? img : null;
}

/** Where the newest thumbnail sits in the cart bar (or will, while the bar is still arriving). */
function target(): { x: number; y: number } {
  const slot = document.querySelector("[data-cart-thumbs]");
  const r = slot?.getBoundingClientRect();
  if (r && r.width > 0) return { x: r.left + 18, y: r.top + r.height / 2 };
  return { x: 72, y: window.innerHeight - 40 };
}

export function flyToCart(from: Element) {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(min-width: 1024px), (prefers-reduced-motion: reduce)").matches) return;
  const img = source(from);
  if (!img) return;
  current?.anim.cancel();
  current?.el.remove();

  const r = img.getBoundingClientRect();
  const start = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  const end = target();
  // A quadratic arc that lifts above the straighter of the two points.
  const ctrl = { x: (start.x + end.x) / 2, y: Math.min(start.y, end.y) - 120 };
  const frames: Keyframe[] = [];
  const STEPS = 12;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const x = (1 - t) ** 2 * start.x + 2 * (1 - t) * t * ctrl.x + t ** 2 * end.x - SIZE / 2;
    const y = (1 - t) ** 2 * start.y + 2 * (1 - t) * t * ctrl.y + t ** 2 * end.y - SIZE / 2;
    frames.push({ offset: t, transform: `translate(${x}px, ${y}px) scale(${1 - 0.6 * t})`, opacity: t <= 0.8 ? 1 : 1 - (t - 0.8) / 0.2 });
  }

  const el = document.createElement("div");
  el.setAttribute("data-fly", "");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = `position:fixed;left:0;top:0;width:${SIZE}px;height:${SIZE}px;z-index:60;pointer-events:none;border-radius:8px;overflow:hidden;background:var(--color-surface) center/cover no-repeat url("${img.currentSrc}");box-shadow:var(--shadow-card);will-change:transform`;
  document.body.appendChild(el);
  // The whole flight eases (emphasized); the arc's points are spaced evenly in time.
  const anim = el.animate(frames, { duration: DURATION, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "forwards" });
  landsAt = performance.now() + DURATION;
  const flight = { el, anim };
  current = flight;
  const done = () => {
    el.remove();
    if (current === flight) current = null;
  };
  anim.finished.then(done, done);
}
