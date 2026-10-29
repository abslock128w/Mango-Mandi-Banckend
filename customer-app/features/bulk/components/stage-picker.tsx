"use client";
import { RIPENESS, STAGES } from "@/lib/ripeness";
import { cn } from "@/lib/format";
import type { RipenessStage } from "@/lib/types";

const DOT = { ripe: "bg-ripe", semi: "bg-semi", raw: "bg-raw" } as const;

/** Ripeness radio cards, in the shop's display order. `note` adds a line per stage (stock, eat by); `off` greys a stage out. */
export function StagePicker({
  stages,
  value,
  onChange,
  legend,
  note,
  off,
}: {
  stages: RipenessStage[];
  value: RipenessStage | null;
  onChange: (s: RipenessStage) => void;
  legend: string;
  note?: (s: RipenessStage) => string | null;
  off?: (s: RipenessStage) => boolean;
}) {
  const list = STAGES.filter((s) => stages.includes(s));
  return (
    <fieldset>
      <legend className="text-15 font-bold text-ink">{legend}</legend>
      <div role="radiogroup" className="mt-2 grid gap-2 sm:grid-cols-3">
        {list.map((s) => {
          const r = RIPENESS[s];
          const picked = value === s;
          const extra = note?.(s);
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={picked}
              onClick={() => onChange(s)}
              className={cn(
                "press flex min-h-11 items-start gap-2.5 rounded-12 border p-3 text-left",
                picked ? "border-action bg-tint" : "border-line bg-surface",
                off?.(s) && !picked && "opacity-60",
              )}
            >
              <span aria-hidden className={cn("mt-1 size-3 shrink-0 rounded-full", DOT[r.tone])} />
              <span className="min-w-0">
                <span className="block text-13 font-semibold text-ink">{r.label}</span>
                <span className="block text-12 text-muted">{r.hint}</span>
                {extra && <span className={cn("mt-0.5 block text-12", off?.(s) ? "text-danger" : "text-action")}>{extra}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
