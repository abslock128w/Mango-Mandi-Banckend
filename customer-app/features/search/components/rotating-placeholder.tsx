"use client";
import { AnimatePresence, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useEffect, useState } from "react";

const TERMS: Record<"morning" | "afternoon" | "evening", string[]> = {
  morning: ["Alphonso", "ripe mango for breakfast", "Badami", "Hapus"],
  afternoon: ["raw mango for pickle", "Badami", "mango for aamras", "semi-ripe"],
  evening: ["5 kg box", "ripe Alphonso", "Karnataka Alphonso", "Alphonso"],
};

export function termsForHour(h: number) {
  return h >= 5 && h < 12 ? TERMS.morning : h >= 12 && h < 17 ? TERMS.afternoon : TERMS.evening;
}

/** Rotates 'Search "…"' every 2 s with time-of-day keyed terms. */
export function RotatingPlaceholder({ className }: { className?: string }) {
  const [terms, setTerms] = useState(TERMS.morning);
  const [i, setI] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    // Pick terms after hydration so server and client markup match.
    const t0 = setTimeout(() => setTerms(termsForHour(new Date().getHours())), 0);
    const t = setInterval(() => setI((n) => n + 1), 2000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, []);
  const term = terms[i % terms.length];
  return (
    <span aria-hidden className={`pointer-events-none flex h-5 min-w-0 items-center overflow-hidden leading-5 whitespace-nowrap text-muted ${className ?? ""}`}>
      Search&nbsp;
      <span className="relative inline-flex h-5 min-w-0 items-center overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout">
          <m.span
            key={term}
            // Slide only (no fade) so the text keeps full contrast in every frame; the box clips it.
            initial={reduce ? false : { y: "100%" }}
            animate={{ y: "0%" }}
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { y: "-100%" }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="truncate leading-5"
          >
            &quot;{term}&quot;
          </m.span>
        </AnimatePresence>
      </span>
    </span>
  );
}
