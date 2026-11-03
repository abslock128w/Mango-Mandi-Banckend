"use client";
import { createPortal } from "react-dom";
import { useSyncExternalStore } from "react";
import { useIsDesktop } from "@/lib/hooks/use-media";

const noop = () => () => {};

/**
 * Renders a phone's fixed bottom bar outside the page wrapper (AppIndent), once hydrated. While a
 * sheet is open the page is scaled back with a transform, and a transformed ancestor would make a
 * `fixed` bar scroll with the page. The first render stays in place, so nothing shifts.
 * Laptops keep the bar where it is (it is part of the layout there).
 */
export function OutsidePage({ children }: { children: React.ReactNode }) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const desktop = useIsDesktop();
  return mounted && !desktop ? createPortal(children, document.body) : <>{children}</>;
}
