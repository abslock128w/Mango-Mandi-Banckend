"use client";
import { useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef } from "react";
import { STAGGER_CAP, STAGGER_MS } from "@/lib/motion";

// Everything that has already appeared once in this visit, by id: a rail that remounts, a tab that
// re-renders or a list that refetches never plays its entrance again.
const seen = new Set<string>();

const FROM = { opacity: "0", transform: "translateY(8px)" };

/**
 * Fades and rises its content (8 px, 240 ms) the first time it comes into view, and never again.
 * (On screen already when it mounts, it rises from 0.4 opacity rather than from nothing.)
 * - Server-rendered content already on screen when the page hydrates is left alone (it is painted).
 * - Content below the fold is hidden until it scrolls in, then plays once.
 * - `index` staggers siblings by 30 ms, capped at 8.
 * - Inside a horizontal rail (an ancestor with data-reveal-group) the whole row reveals together
 *   when the rail comes into view; cards off to the side never fade in on a sideways swipe.
 * - Reduced motion: renders the final state, no movement.
 * Animates with the Web Animations API (transform and opacity only), not Motion, so a long grid
 * costs no React work.
 */
export function RevealOnce({
  id,
  index = 0,
  as: Tag = "div",
  className,
  style,
  children,
  ...rest
}: { id?: string; index?: number; as?: "div" | "li" | "section" | "article"; className?: string; style?: React.CSSProperties; children: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reduce || (id && seen.has(id)) || typeof IntersectionObserver === "undefined") return;
    // Content already on screen when it mounts starts at 0.4, not 0: it counts as painted from the
    // first frame (the page's largest paint is not held back by its own entrance).
    const play = (from: Keyframe = FROM) => {
      if (id) seen.add(id);
      el.style.opacity = "";
      el.style.transform = "";
      const delay = Math.min(index, STAGGER_CAP) * STAGGER_MS;
      el.animate([from, { opacity: "1", transform: "none" }], { duration: 240, delay, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "backwards" });
      // Photos inside settle from 1.03 (the editorial feel): a slow breath, once.
      for (const photo of el.querySelectorAll<HTMLElement>("[data-settle]")) photo.animate([{ transform: "scale(1.03)" }, { transform: "none" }], { duration: 600, delay, easing: "cubic-bezier(0.2, 0, 0, 1)" });
    };
    const target = el.parentElement?.closest<HTMLElement>("[data-reveal-group]") ?? el;
    const r = target.getBoundingClientRect();
    const onScreen = r.top < window.innerHeight && r.bottom > 0;
    if (onScreen) {
      // Painted by the server before hydration: already seen, leave it be.
      if (!document.documentElement.hasAttribute("data-hydrated")) {
        if (id) seen.add(id);
        return;
      }
      play({ opacity: "0.4", transform: "translateY(8px)" });
      return;
    }
    Object.assign(el.style, FROM);
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        play();
      },
      { rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(target);
    return () => {
      io.disconnect();
      el.style.opacity = "";
      el.style.transform = "";
    };
  }, [id, index, reduce]);
  return (
    <Tag ref={ref as React.Ref<never>} className={className} style={style} {...rest}>
      {children}
    </Tag>
  );
}
