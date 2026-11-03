"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Whether a sticky row has stuck (docs/design/shop-motion.md, "Liquid glass": a chip row becomes
 * glass only once it sticks). Put the returned ref on a zero-height sentinel just above the sticky
 * element: an IntersectionObserver, with the viewport's top cut down by `offset` (the header's
 * height), reports when the sentinel has scrolled under the header. Nothing runs per frame.
 */
export function useStuck(offset: () => number) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let io: IntersectionObserver | null = null;
    const observe = () => {
      io?.disconnect();
      io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < 0 + offset()), { rootMargin: `${-Math.round(offset()) - 1}px 0px 0px 0px`, threshold: 0 });
      io.observe(el);
    };
    observe();
    window.addEventListener("resize", observe);
    return () => {
      io?.disconnect();
      window.removeEventListener("resize", observe);
    };
  }, [offset]);
  return { sentinel, stuck };
}
