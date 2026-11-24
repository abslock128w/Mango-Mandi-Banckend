"use client";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useRun } from "@/lib/run-context";
import { PendingBadge } from "./pending-badge";

export function BackBar({ title, eyebrow, children }: { title: string; eyebrow?: string; children?: ReactNode }) {
  const { pending } = useRun();
  return (
    <header data-testid="back-bar" className="sticky top-0 z-20 border-b border-line bg-canvas/95 px-2 py-2 backdrop-blur">
      <div className="flex items-center gap-1">
        <Link href="/today" className="press grid size-12 shrink-0 place-items-center rounded-full text-green active:bg-chip" aria-label="Back to today's run">
          <ChevronLeft aria-hidden size={30} />
        </Link>
        <div className="min-w-0 flex-1">
          {eyebrow && <p className="truncate text-sm font-semibold text-muted">{eyebrow}</p>}
          <h1 className="truncate font-display text-2xl leading-tight text-green">{title}</h1>
        </div>
        {children}
      </div>
      {pending > 0 && (
        <div className="flex justify-end px-2 pt-1">
          <PendingBadge count={pending} />
        </div>
      )}
    </header>
  );
}
