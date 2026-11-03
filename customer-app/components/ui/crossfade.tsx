"use client";
import { useState } from "react";
import { cn } from "@/lib/format";

/**
 * Replaces one thing with another by crossfading them in place: skeleton to content, a delivery
 * line or price that changes. The old content is lifted out of the flow and fades out on top of
 * the new one (--dur-s), so nothing waits and nothing blinks. `id` says when the content changed.
 * CSS keyframes, no Motion: it sits in the header and the checkout, where every byte loads first.
 * The copy on its way out is inert and hidden from screen readers. `fill`: both sides fill a
 * positioned box (a photo). Reduced motion keeps the crossfade (it moves nothing).
 */
export function Crossfade({ id, children, className, inline, fill }: { id: string | number; children: React.ReactNode; className?: string; inline?: boolean; fill?: boolean }) {
  const [shown, setShown] = useState<{ id: string | number; node: React.ReactNode }>({ id, node: children });
  const [leaving, setLeaving] = useState<{ id: string | number; node: React.ReactNode } | null>(null);
  if (shown.id !== id) {
    setLeaving(shown);
    setShown({ id, node: children });
  } else if (shown.node !== children) setShown({ id, node: children });

  const Wrap = inline ? "span" : "div";
  return (
    <Wrap className={cn("relative", inline && "inline-block", fill && "absolute inset-0", className)}>
      {leaving && (
        <Wrap
          key={`out-${leaving.id}`}
          aria-hidden
          inert
          onAnimationEnd={() => setLeaving(null)}
          className={cn("crossfade-out absolute top-0 left-0", inline ? "whitespace-nowrap" : "w-full", fill && "inset-0")}
        >
          {leaving.node}
        </Wrap>
      )}
      <Wrap key={shown.id} className={cn(leaving && "crossfade-in", inline && "inline-block", fill && "absolute inset-0")}>
        {children}
      </Wrap>
    </Wrap>
  );
}
