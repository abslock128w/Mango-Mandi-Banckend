"use client";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { cn } from "@/lib/format";
import { fade } from "@/lib/motion";

/**
 * Replaces one thing with another by crossfading them in place: skeleton to content, a delivery
 * line or price that changes. The old content is lifted out of the flow (popLayout) and fades out
 * on top of the new one, so nothing waits and nothing blinks. `id` says when the content changed.
 * Reduced motion keeps the crossfade (it moves nothing).
 */
export function Crossfade({ id, children, className, inline }: { id: string | number; children: React.ReactNode; className?: string; inline?: boolean }) {
  const Box = inline ? m.span : m.div;
  const Wrap = inline ? "span" : "div";
  return (
    <Wrap className={cn("relative", inline && "inline-block", className)}>
      <AnimatePresence initial={false} mode="popLayout">
        <Box key={id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade} className={inline ? "inline-block" : undefined}>
          {children}
        </Box>
      </AnimatePresence>
    </Wrap>
  );
}
