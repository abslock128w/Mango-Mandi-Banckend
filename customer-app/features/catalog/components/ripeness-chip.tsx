import { RIPENESS } from "@/lib/ripeness";
import type { RipenessStage } from "@/lib/types";
import { cn } from "@/lib/format";

const tone: Record<RipenessStage, string> = {
  RIPE: "bg-ripe-soft text-ink [--dot:var(--color-ripe)]",
  SEMI_RIPE: "bg-semi-soft text-ink [--dot:var(--color-semi)]",
  RAW: "bg-raw-soft text-ink [--dot:var(--color-raw)]",
};

/**
 * The stage (RIPE / SEMI / RAW) with a 6 px dot that breathes once as it appears. `onPhoto`: white
 * on a photo's scrim (product cards) instead of the soft pill.
 */
export function RipenessChip({ stage, className, onPhoto }: { stage: RipenessStage; className?: string; onPhoto?: boolean }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-4 text-11 font-medium whitespace-nowrap", onPhoto ? "text-white [--dot:var(--color-brand)]" : cn("px-2", tone[stage]), className)}>
      <span aria-hidden className="size-1.5 animate-dot-breathe rounded-full bg-(--dot)" />
      {RIPENESS[stage].label}
    </span>
  );
}

export const ripenessDot: Record<RipenessStage, string> = {
  RIPE: "bg-ripe",
  SEMI_RIPE: "bg-semi",
  RAW: "bg-raw",
};
