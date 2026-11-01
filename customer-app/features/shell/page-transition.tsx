import { ViewTransition } from "react";

/** Route change: fade + 8px rise, 200ms, content only (header has its own name). */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="page" exit="page" default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}
