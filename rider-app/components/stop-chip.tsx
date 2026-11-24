"use client";
import { motion } from "motion/react";
import type { StopState } from "@/lib/run-context";

const CHIP: Record<StopState, [string, string]> = {
  unpacked: ["Not packed", "bg-chip text-muted"],
  pickup: ["To pick up", "bg-mango-soft text-ink"],
  out: ["On the way", "bg-green-soft text-green"],
  delivered: ["Delivered", "bg-green text-white"],
  missed: ["Missed", "bg-danger-soft text-danger"],
};

/** A stop's state. A change pops in (keyed by state), so the rider notices it; still under reduced motion. */
export function StopChip({ state }: { state: StopState }) {
  const [label, cls] = CHIP[state];
  return (
    <motion.span
      key={state}
      data-testid="stop-chip"
      data-state={state}
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 520, damping: 30 }}
      className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-sm font-semibold ${cls}`}
    >
      {label}
    </motion.span>
  );
}
