import type { Transition } from "motion/react";

/** ADD to stepper morph. */
export const morphSpring: Transition = { type: "spring", stiffness: 500, damping: 30 };
/** General UI spring (cart bar, rail indicator, progress). */
export const uiSpring: Transition = { type: "spring", stiffness: 380, damping: 32 };
export const softSpring: Transition = { type: "spring", stiffness: 220, damping: 28 };

export const headerTween: Transition = { duration: 0.18, ease: "easeInOut" };

/** Staggered fade-and-rise, 30 ms per item, capped at 12 items. */
export const STAGGER_MS = 30;
export const STAGGER_CAP = 12;
export const riseDelay = (i: number) => (Math.min(i, STAGGER_CAP) * STAGGER_MS) / 1000;
