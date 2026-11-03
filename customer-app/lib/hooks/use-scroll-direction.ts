"use client";
import { useEffect, useRef, useState } from "react";

export type ScrollDirection = "up" | "down";

// The last time the customer moved the page themselves (finger, wheel, keys). Scrolls the app
// makes (scrollIntoView, a restored position, a test runner) are not a change of direction.
let lastInput = -Infinity;
let listening = false;
function trackInput() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const mark = () => (lastInput = performance.now());
  for (const ev of ["touchmove", "wheel", "keydown"]) window.addEventListener(ev, mark, { passive: true, capture: true });
}
export const userScrolledRecently = (ms = 600) => performance.now() - lastInput < ms;

/**
 * Which way the customer is scrolling the page, with hysteresis: the direction flips only after
 * `threshold` px the other way, so a wobble at the end of a fling changes nothing. Near the top
 * (`topZone` px) it is always "up". Shared by the header (snap of the large title) and the cart
 * bar (hides on the way down, returns on the way up). Re-renders only when the direction flips.
 */
export function useScrollDirection({ threshold = 24, topZone = 40 } = {}) {
  const [dir, setDir] = useState<ScrollDirection>("up");
  const state = useRef({ dir: "up" as ScrollDirection, anchor: 0 });
  useEffect(() => {
    trackInput();
    const s = state.current;
    s.anchor = window.scrollY;
    const set = (d: ScrollDirection) => {
      if (s.dir === d) return;
      s.dir = d;
      setDir(d);
    };
    const onScroll = () => {
      const y = Math.max(window.scrollY, document.body.scrollTop);
      if (y < topZone) {
        s.anchor = y;
        set("up");
        return;
      }
      if (!userScrolledRecently()) {
        s.anchor = y;
        return;
      }
      if (s.dir === "up" && y - s.anchor > threshold) set("down");
      else if (s.dir === "down" && s.anchor - y > threshold) set("up");
      // Keep the anchor at the furthest point in the current direction.
      if ((s.dir === "down" && y > s.anchor) || (s.dir === "up" && y < s.anchor)) s.anchor = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold, topZone]);
  return { direction: dir, ref: state };
}
