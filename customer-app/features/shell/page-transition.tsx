"use client";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, ViewTransition } from "react";
import { inShopLayout, installNavDirection, notifyPathChanged } from "./nav";

/**
 * Route change with depth (docs/design/shop-motion.md): the entering page and the leaving page get
 * the view-transition classes page-in / page-out, and globals.css animates them by html[data-nav]
 * (features/shell/nav.ts): forward slides in from the right over the old page pushed back, back is
 * the exact reverse, flow pages present from the bottom and dismiss downwards.
 * Used by app/template.tsx (every page outside the shop layout, keyed by path) and
 * app/(shop)/template.tsx (the shop pages under the persistent header).
 */
export function PageTransition({ children, root }: { children: React.ReactNode; root?: boolean }) {
  const path = usePathname();
  useEffect(installNavDirection, []);
  // An animated back (nav.ts) waits for the page it went back to.
  useLayoutEffect(notifyPathChanged, [path]);
  // At the root, all shop pages are one page (their own template animates them under the header).
  const key = root && inShopLayout(path) ? "shop" : path;
  return (
    <ViewTransition key={key} enter="page-in" exit="page-out" default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}
