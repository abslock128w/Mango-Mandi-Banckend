"use client";
import { cn, dayName } from "@/lib/format";

/** Delivery day chips (a radio group). */
export function DayChips({ days, value, onChange, label = "Delivery day" }: { days: string[]; value: string | null; onChange: (d: string) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-0.5">
      {days.map((d) => {
        const on = d === value;
        return (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(d)}
            className={cn("press h-11 shrink-0 rounded-8 border px-3 text-13 font-semibold whitespace-nowrap", on ? "border-action bg-tint text-action" : "border-line bg-surface text-ink")}
          >
            {dayName(d)}
          </button>
        );
      })}
    </div>
  );
}
