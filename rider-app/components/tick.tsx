"use client";
import { motion } from "motion/react";

/** The checklist tick: the circle fills and the check draws in with a short spring. */
export function StepMarker({ n, state }: { n: number; state: "done" | "active" | "locked" }) {
  if (state === "done") {
    return (
      <motion.span
        initial={{ scale: 0.6 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 22 }}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-action text-white"
        aria-hidden
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
          <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.05 }} />
        </svg>
      </motion.span>
    );
  }
  return (
    <span
      aria-hidden
      className={`grid size-9 shrink-0 place-items-center rounded-full text-base font-bold ${state === "active" ? "bg-brand text-ink" : "bg-chip text-muted"}`}
    >
      {n}
    </span>
  );
}
