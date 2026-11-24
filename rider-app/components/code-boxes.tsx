"use client";
import { Delete } from "lucide-react";
import { useId, useRef } from "react";

/**
 * N digit boxes over one real input: the phone's number pad, paste and
 * one-time-code autofill all work, and a screen reader hears one field.
 * With `keypad`, the phone's keyboard stays closed (inputMode "none") and the
 * on-screen PinPad below types into it instead.
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
  keypad = false,
  size = "md",
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
  keypad?: boolean;
  size?: "md" | "lg";
  testId?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const box = size === "lg" ? "h-20 w-16 text-4xl" : "h-16 w-12 text-3xl";
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className={`flex justify-center ${size === "lg" ? "gap-3" : "gap-2"}`} aria-hidden onClick={() => ref.current?.focus()}>
        {Array.from({ length }, (_, i) => {
          const ch = value[i];
          const active = !disabled && i === Math.min(value.length, length - 1);
          return (
            <span
              key={i}
              className={`grid place-items-center rounded-2xl border-2 font-display tabular-nums transition-colors ${box} ${
                invalid ? "border-danger bg-danger-soft" : active ? "border-green bg-paper shadow-card" : ch ? "border-line bg-paper" : "border-line bg-chip"
              } ${disabled ? "text-disabled-ink" : "text-ink"}`}
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
        inputMode={keypad ? "none" : "numeric"}
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

/** Big keys for the PIN (64 px tall): easy with a thumb, a glove, or in a hurry. */
export function PinPad({ value, length, onChange, disabled = false }: { value: string; length: number; onChange: (v: string) => void; disabled?: boolean }) {
  const key = "press grid h-16 place-items-center rounded-2xl text-3xl font-display disabled:text-disabled-ink";
  const press = (d: string) => value.length < length && onChange(value + d);
  return (
    <div className="mx-auto grid w-full max-w-xs grid-cols-3 gap-3" role="group" aria-label="PIN keypad">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
        <button key={d} type="button" disabled={disabled} onClick={() => press(d)} className={`${key} border border-line bg-paper text-ink shadow-card active:bg-chip`}>
          {d}
        </button>
      ))}
      <span aria-hidden />
      <button type="button" disabled={disabled} onClick={() => press("0")} className={`${key} border border-line bg-paper text-ink shadow-card active:bg-chip`}>
        0
      </button>
      <button type="button" disabled={disabled || !value} onClick={() => onChange(value.slice(0, -1))} className={`${key} text-ink active:bg-chip`} aria-label="Delete last digit">
        <Delete aria-hidden size={30} />
      </button>
    </div>
  );
}
