"use client";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/format";

/**
 * Six boxes. Box 1 carries autocomplete="one-time-code" so SMS autofill fills all six.
 * A wrong code (`shake` goes up) shakes the row, 320 ms, transform only; not under reduced motion.
 */
export function OtpInput({ value, onChange, invalid, disabled, shake = 0 }: { value: string; onChange: (v: string) => void; invalid?: boolean; disabled?: boolean; shake?: number }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!shake || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    row.current?.animate(
      [0, -6, 6, -4, 4, 0].map((x) => ({ transform: `translateX(${x}px)` })),
      { duration: 320, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    );
    // Back to the first box for the next try.
    refs.current[0]?.focus();
  }, [shake]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");

  useEffect(() => {
    refs.current[Math.min(value.length, 5)]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAt = (i: number, d: string) => {
    const next = (value.slice(0, i) + d + value.slice(i + 1)).replace(/\D/g, "").slice(0, 6);
    onChange(next);
  };

  return (
    <div ref={row} role="group" aria-label="One-time password" className="flex justify-between gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid}
          maxLength={i === 0 ? 6 : 1}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            if (v.length > 1) {
              // Paste or SMS autofill of the whole code.
              onChange(v.slice(0, 6));
              refs.current[Math.min(v.length, 6) - 1]?.focus();
              return;
            }
            setAt(i, v);
            if (v && i < 5) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i] && i > 0) {
              setAt(i - 1, "");
              refs.current[i - 1]?.focus();
              e.preventDefault();
            }
            if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            const v = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
            if (v) {
              e.preventDefault();
              onChange(v);
              refs.current[Math.min(v.length, 6) - 1]?.focus();
            }
          }}
          className={cn(
            "size-12 min-w-0 rounded-8 border bg-surface text-center text-21 font-bold text-ink outline-none focus:border-action sm:size-14",
            invalid ? "border-danger" : d ? "border-ink" : "border-line",
          )}
        />
      ))}
    </div>
  );
}
