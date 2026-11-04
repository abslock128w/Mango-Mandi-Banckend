"use client";
import type { HTMLMotionProps } from "motion/react";
import * as m from "motion/react-m";
import { cn } from "@/lib/format";
import { press } from "@/lib/motion";

// Tappable surfaces: no grey tap flash, no double-tap zoom delay, the focus ring from globals.css.
const base = "[-webkit-tap-highlight-color:transparent] touch-manipulation";

/**
 * A button that presses in (scale 0.97) and springs back (spring.snappy), interruptibly.
 * Under reduced motion MotionConfig makes the press instant, never animated.
 * For plain buttons that need no Motion, the `press` CSS utility does the same with the CSS spring.
 */
export function Pressable({ className, type = "button", whileTap, transition, ...rest }: HTMLMotionProps<"button">) {
  return <m.button type={type} whileTap={whileTap ?? { scale: press.scale }} transition={transition ?? press.transition} className={cn(base, className)} {...rest} />;
}
