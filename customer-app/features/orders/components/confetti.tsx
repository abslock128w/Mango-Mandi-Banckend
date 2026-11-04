"use client";
import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useMemo } from "react";

const COLORS = ["bg-brand", "bg-ripe", "bg-raw", "bg-action", "bg-ribbon", "bg-semi"];

/** One burst of confetti, then gone. */
export function Confetti({ count = 36 }: { count?: number }) {
  const reduce = useReducedMotion();
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + (i % 3) * 0.2;
        const dist = 90 + ((i * 37) % 80);
        return { i, x: Math.cos(angle) * dist, y: Math.sin(angle) * dist - 40, r: (i * 47) % 360, c: COLORS[i % COLORS.length], w: 6 + (i % 3) * 2 };
      }),
    [count],
  );
  if (reduce) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
      {pieces.map((p) => (
        <m.span
          key={p.i}
          className={`absolute rounded-[2px] ${p.c}`}
          style={{ width: p.w, height: p.w * 0.5 }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.4 }}
          animate={{ x: p.x, y: [0, p.y, p.y + 140], opacity: [1, 1, 0], rotate: p.r + 360, scale: 1 }}
          transition={{ duration: 1.6, ease: "easeOut", delay: 0.35, times: [0, 0.4, 1] }}
        />
      ))}
    </div>
  );
}
