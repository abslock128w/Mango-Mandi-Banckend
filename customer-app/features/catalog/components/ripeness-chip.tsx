import { RIPENESS } from "@/lib/ripeness";
import type { RipenessStage } from "@/lib/types";
import { cn } from "@/lib/format";

const tone: Record<RipenessStage, string> = {
  RIPE: "bg-ripe-soft text-ink [--dot:var(--color-ripe)]",
  SEMI_RIPE: "bg-semi-soft text-ink [--dot:var(--color-semi)]",
  RAW: "bg-raw-soft text-ink [--dot:var(--color-raw)]",
};

export function RipenessChip({ stage, className }: { stage: RipenessStage; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-full px-2 text-11 font-medium whitespace-nowrap", tone[stage], className)}>
      <span aria-hidden className="chip-dot size-1.5 rounded-full bg-(--dot)" />
      {RIPENESS[stage].label}
    </span>
  );
}

export const ripenessDot: Record<RipenessStage, string> = {
  RIPE: "bg-ripe",
  SEMI_RIPE: "bg-semi",
  RAW: "bg-raw",
};
