"use client";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, ViewTransition } from "react";

/** The shop's own pages share one layout (header, footer) under app/(shop). */
const SHOP = /^\/($|c\/|p\/|bulk(\/|$)|preorder$)/;

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
  // The direction store (nav.ts) loads after the page; the first tap is well after that.
  useEffect(() => void import("./nav").then((m) => m.installNavDirection()), []);
  // An animated back (nav.ts) waits for the page it went back to.
  useLayoutEffect(() => void window.dispatchEvent(new Event("mm:path")), [path]);
  // At the root, all shop pages are one page (their own template animates them under the header).
  const key = root && SHOP.test(path) ? "shop" : path;
  return (
    <ViewTransition key={key} enter="page-in" exit="page-out" default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}
