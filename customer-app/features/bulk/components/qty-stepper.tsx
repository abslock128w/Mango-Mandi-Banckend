"use client";
import { Minus, Plus } from "lucide-react";

/** A box count with − and + buttons (44 px targets) that moves in steps and stays within min..max. */
export function QtyStepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
}) {
  const s = Math.max(1, step);
  const boxes = (n: number) => `${n} ${n === 1 ? "box" : "boxes"}`;
  return (
    <div role="group" aria-label={label} className="inline-flex h-11 items-stretch overflow-hidden rounded-8 border border-line bg-surface">
      <button
        type="button"
        aria-label={`${boxes(s)} fewer`}
        disabled={value - s < min}
        onClick={() => onChange(Math.max(min, value - s))}
        className="press grid w-11 place-items-center text-ink disabled:text-disabled"
      >
        <Minus aria-hidden size={16} strokeWidth={2.5} />
      </button>
      <output aria-live="polite" aria-label={`${label}: ${boxes(value)}`} className="grid min-w-14 place-items-center border-x border-line px-2 text-15 font-semibold text-ink">
        {value}
      </output>
      <button
        type="button"
        aria-label={`${boxes(s)} more`}
        disabled={value + s > max}
        onClick={() => onChange(Math.min(max, value + s))}
        className="press grid w-11 place-items-center text-ink disabled:text-disabled"
      >
        <Plus aria-hidden size={16} strokeWidth={2.5} />
      </button>
    </div>
  );
}
