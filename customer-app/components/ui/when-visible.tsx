"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Renders children once the placeholder is near the viewport, so below-the-fold
 * rails don't download images before the first screen has painted.
 */
export function WhenVisible({ children, placeholder, rootMargin = "400px" }: { children: React.ReactNode; placeholder: React.ReactNode; rootMargin?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, rootMargin]);
  return shown ? <>{children}</> : <div ref={ref}>{placeholder}</div>;
}
