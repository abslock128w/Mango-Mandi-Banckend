"use client";
import { useCallback } from "react";

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
