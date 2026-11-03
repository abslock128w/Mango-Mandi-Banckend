"use client";
import type { HTMLMotionProps } from "motion/react";
import * as m from "motion/react-m";
import { useCallback } from "react";
import { cn } from "@/lib/format";
import { press } from "@/lib/motion";

// Tappable surfaces: no grey tap flash, no double-tap zoom delay, the focus ring from globals.css.
const base = "[-webkit-tap-highlight-color:transparent] touch-manipulation";

/**
 * The press of a piece of glass (docs/design/shop-motion.md, "Liquid glass", touch): on pointer
 * down the element is marked data-pressed and told where the finger is (--px/--py, as percentages),
 * so globals.css can flex it and light it from under the finger (.glass-glow). Returns the handlers
 * to spread on the element; render a <GlassGlow /> inside it.
 */
export function useGlassPress() {
  const down = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--px", `${Math.round(((e.clientX - r.left) / r.width) * 100)}%`);
    el.style.setProperty("--py", `${Math.round(((e.clientY - r.top) / r.height) * 100)}%`);
    el.setAttribute("data-pressed", "");
  }, []);
  const up = useCallback((e: React.PointerEvent<HTMLElement>) => e.currentTarget.removeAttribute("data-pressed"), []);
  return { onPointerDown: down, onPointerUp: up, onPointerCancel: up, onPointerLeave: up };
}

/** The glow a glass press lights (globals.css, .glass-glow): the last child of a glass element. */
export function GlassGlow() {
  return <span aria-hidden className="glass-glow" />;
}

/**
 * A button that presses in (scale 0.97) and springs back (spring.snappy), interruptibly.
 * Under reduced motion MotionConfig makes the press instant, never animated.
 * For plain buttons that need no Motion, the `press` CSS utility does the same with the CSS spring.
 * `glass`: a glass button (give it the .glass classes too): it also lights up from under the finger.
 */
export function Pressable({ className, type = "button", whileTap, transition, glass, children, ...rest }: HTMLMotionProps<"button"> & { glass?: boolean; children?: React.ReactNode }) {
  const glassPress = useGlassPress();
  return (
    <m.button type={type} whileTap={whileTap ?? { scale: press.scale }} transition={transition ?? press.transition} className={cn(base, className)} {...(glass ? glassPress : {})} {...rest}>
      {children}
      {glass && <GlassGlow />}
    </m.button>
  );
}
