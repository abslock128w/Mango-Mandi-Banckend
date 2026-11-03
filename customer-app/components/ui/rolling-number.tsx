"use client";
import { useState } from "react";

/**
 * A number whose digits roll vertically when it changes: up when it grows, down when it shrinks,
 * on the snappy spring (its CSS mirror). CSS keyframes, no Motion, so it costs nothing where it is
 * the only moving part (the checkout total). Reduced motion: it simply changes.
 */
export function RollingNumber({ value, className, format = String }: { value: number; className?: string; format?: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const [old, setOld] = useState<{ value: number; dir: 1 | -1 } | null>(null);
  if (value !== shown) {
    setOld({ value: shown, dir: value > shown ? 1 : -1 });
    setShown(value);
  }
  const roll = { "--roll": old?.dir ?? 1 } as React.CSSProperties;
  return (
    <span className={`relative inline-flex overflow-hidden tabular-nums ${className ?? ""}`} style={{ lineHeight: "inherit" }}>
      {old && (
        <span key={`out-${old.value}-${shown}`} aria-hidden className="roll-out absolute top-0 left-0" style={roll} onAnimationEnd={() => setOld(null)}>
          {format(old.value)}
        </span>
      )}
      <span key={shown} className={old ? "roll-in inline-block" : "inline-block"} style={roll}>
        {format(shown)}
      </span>
    </span>
  );
}
