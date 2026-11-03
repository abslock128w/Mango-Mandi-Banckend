"use client";
import { Drawer } from "@base-ui/react/drawer";
import { useEffect, useRef } from "react";

/**
 * The page under the sheets. Base UI marks it data-active while a sheet is open and passes the
 * drag progress, and globals.css pushes it back on phones (scale, round corners, follows the finger).
 * --indent-top is the scroll position when the sheet opened, so the push-back is centred on what
 * the customer sees. data-settling keeps the rounded clip while the page comes forward again.
 */
export function AppIndent({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let settle = 0;
    const mo = new MutationObserver(() => {
      const active = el.hasAttribute("data-active");
      window.clearTimeout(settle);
      if (active) {
        el.style.setProperty("--indent-top", `${Math.max(window.scrollY, document.body.scrollTop)}px`);
        el.removeAttribute("data-settling");
      } else if (el.style.getPropertyValue("--indent-top")) {
        el.setAttribute("data-settling", "");
        settle = window.setTimeout(() => el.removeAttribute("data-settling"), 450);
      }
    });
    mo.observe(el, { attributes: true, attributeFilter: ["data-active"] });
    return () => {
      mo.disconnect();
      window.clearTimeout(settle);
    };
  }, []);
  return (
    <Drawer.Indent ref={ref} className="app-root bg-canvas">
      {children}
    </Drawer.Indent>
  );
}
