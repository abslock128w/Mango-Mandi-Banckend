"use client";
import { useId, useRef } from "react";

/**
 * N digit boxes over one real input: the phone's number pad, paste and
 * one-time-code autofill all work, and a screen reader hears one field.
 */
export function CodeBoxes({
  length,
  value,
  onChange,
  label,
  mask = false,
  disabled = false,
  autoFocus = false,
  autoComplete = "off",
  invalid = false,
  testId,
}: {
  length: number;
  value: string;
  onChange: (v: string) => void;
  label: string;
  mask?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  autoComplete?: string;
  invalid?: boolean;
  testId?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="flex justify-center gap-2" aria-hidden onClick={() => ref.current?.focus()}>
        {Array.from({ length }, (_, i) => {
          const ch = value[i];
          const active = !disabled && i === Math.min(value.length, length - 1);
          return (
            <span
              key={i}
              className={`grid h-16 w-12 place-items-center rounded-xl border-2 bg-surface text-3xl font-bold tabular-nums transition-colors ${
                invalid ? "border-danger" : active ? "border-action peer-focus:border-action" : "border-line"
              } ${disabled ? "opacity-50" : ""}`}
            >
              {ch ? (mask ? "•" : ch) : ""}
            </span>
          );
        })}
      </div>
      <input
        ref={ref}
        id={id}
        data-testid={testId}
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete={autoComplete}
        maxLength={length}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, length))}
      />
    </div>
  );
}
