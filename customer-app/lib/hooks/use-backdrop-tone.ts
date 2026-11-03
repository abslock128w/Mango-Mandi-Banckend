"use client";
import { useEffect } from "react";

/**
 * Flips a small piece of glass (header, cart bar, chip row, toast) between its light and dark
 * style by what is behind it (docs/design/shop-motion.md, "Liquid glass", adaptive tone): photo
 * cards and dark banners carry data-backdrop="dark", and while one of them crosses the glass's
 * band the glass gets data-tone="dark" (globals.css swaps the wash, the ink and the shadow).
 * One IntersectionObserver whose root is the viewport shrunk to the band: no pixel sampling, no
 * work per frame. Dark elements that arrive later (rails that load as you scroll) are picked up by
 * a MutationObserver, debounced to a frame. Large glass (a sheet header) does not flip: don't use it there.
 */
export function useBackdropTone(ref: React.RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof IntersectionObserver === "undefined") return;
    let io: IntersectionObserver | null = null;
    let observed: Element[] = [];
    const hits = new Set<Element>();
    const apply = () => {
      if (hits.size) el.setAttribute("data-tone", "dark");
      else el.removeAttribute("data-tone");
    };
    const observe = () => {
      const dark = [...document.querySelectorAll("[data-backdrop='dark']")];
      const r = el.getBoundingClientRect();
      const top = Math.max(0, Math.round(r.top));
      const bottom = Math.max(0, Math.round(window.innerHeight - r.bottom));
      io?.disconnect();
      hits.clear();
      observed = dark;
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) if (e.isIntersecting) hits.add(e.target);
          else hits.delete(e.target);
          apply();
        },
        { rootMargin: `${-top}px 0px ${-bottom}px 0px`, threshold: 0 },
      );
      for (const d of dark) io.observe(d);
      if (!dark.length) apply();
    };
    let raf = 0;
    const later = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(observe);
    };
    const onMutation = () => {
      // Only when the set of dark elements changed: React re-renders a lot, the page rarely gains a banner.
      const dark = document.querySelectorAll("[data-backdrop='dark']");
      if (dark.length === observed.length && [...dark].every((d, i) => d === observed[i])) return;
      later();
    };
    observe();
    const mo = new MutationObserver(onMutation);
    mo.observe(document.body, { childList: true, subtree: true });
    const ro = new ResizeObserver(later);
    ro.observe(el);
    window.addEventListener("resize", later);
    // The band moves while a sticky header collapses: re-aim once the scroll has stopped.
    window.addEventListener("scrollend", later);
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
      mo.disconnect();
      ro.disconnect();
      window.removeEventListener("resize", later);
      window.removeEventListener("scrollend", later);
      el.removeAttribute("data-tone");
    };
  }, [ref, enabled]);
}
