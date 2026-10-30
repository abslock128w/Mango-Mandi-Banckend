"use client";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useRun } from "@/lib/run-context";
import { PendingBadge } from "./pending-badge";

export function BackBar({ title, children }: { title: string; children?: ReactNode }) {
  const { pending } = useRun();
  return (
    <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-canvas/95 px-2 py-2 backdrop-blur">
      <Link href="/today" className="press grid size-12 place-items-center rounded-full" aria-label="Back to today's run">
        <ChevronLeft aria-hidden size={28} />
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{title}</h1>
      <PendingBadge count={pending} />
      {children}
    </header>
  );
}
