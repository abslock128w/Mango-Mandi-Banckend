"use client";
import { Lock } from "lucide-react";
import { motion } from "motion/react";

/** The stepper's marker: done fills green and the check draws in; the open step is mango; a locked one shows a lock. */
export function StepMarker({ n, state }: { n: number; state: "done" | "active" | "locked" }) {
  if (state === "done") {
    return (
      <motion.span
        initial={{ scale: 0.6 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 22 }}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-green text-white ring-4 ring-canvas"
        aria-hidden
      >
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
          <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.05 }} />
        </svg>
      </motion.span>
    );
  }
  if (state === "active") {
    return (
      <motion.span
        initial={{ scale: 0.7 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 20 }}
        aria-hidden
        className="grid size-11 shrink-0 place-items-center rounded-full bg-mango font-display text-xl text-ink shadow-card ring-4 ring-canvas"
      >
        {n}
      </motion.span>
    );
  }
  return (
    <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-dashed border-line bg-canvas text-muted ring-4 ring-canvas">
      <Lock size={18} />
    </span>
  );
}
