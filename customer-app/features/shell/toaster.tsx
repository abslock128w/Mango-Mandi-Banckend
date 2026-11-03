"use client";
import Link from "next/link";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { CheckCircle2, Info, X } from "lucide-react";
import { useLayoutEffect, useRef, useEffect } from "react";
import { GlassGlow } from "@/components/ui/pressable";
import { useIsDesktop } from "@/lib/hooks/use-media";
import { cn } from "@/lib/format";
import { type Toast, useUi } from "./ui-store";

function ToastItem({ t, desktop }: { t: Toast; desktop: boolean }) {
  const dismiss = useUi((s) => s.dismiss);
  const duration = t.duration ?? 3000;
  useEffect(() => {
    const id = setTimeout(() => dismiss(t.id), duration);
    return () => clearTimeout(id);
  }, [t.id, duration, dismiss]);
  const Icon = t.tone === "success" ? CheckCircle2 : Info;
  return (
    <m.li
      layout
      initial={desktop ? { opacity: 0, x: 24 } : { opacity: 0, y: -24 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={desktop ? { opacity: 0, x: 24 } : { opacity: 0, y: -24 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      role="status"
      // A glass capsule (60 px, radius 30; the dismiss button 8 px in, radius 22: concentric).
      className="glass glass--pill pointer-events-auto relative flex min-h-[60px] w-full items-center gap-3 rounded-full py-2 pr-2 pl-4 lg:w-[360px]"
    >
      <Icon aria-hidden size={20} strokeWidth={1.75} className={cn("shrink-0", t.tone === "success" ? "text-action" : t.tone === "danger" ? "text-danger" : "text-ripe")} />
      <p className="flex-1 text-13 font-medium">{t.title}</p>
      {t.action?.href && (
        <Link href={t.action.href} className="rounded-6 px-2 py-1 text-13 font-bold text-action" onClick={() => dismiss(t.id)}>
          {t.action.label}
        </Link>
      )}
      <button type="button" aria-label="Dismiss" data-dismiss onClick={() => dismiss(t.id)} className="press grid size-11 shrink-0 place-items-center rounded-full">
        <X size={18} strokeWidth={1.75} />
      </button>
      {/* Time left: a line along the capsule's foot, clipped by it. */}
      <m.span
        aria-hidden
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: duration / 1000, ease: "linear" }}
        className="absolute inset-x-6 bottom-0 h-0.5 origin-left rounded-full bg-brand"
      />
      <GlassGlow />
    </m.li>
  );
}

/**
 * Toasts: slide in from the top on phones, bottom-right on laptops; auto-dismiss with a shrinking
 * line. Glass capsules, so on phones they sit just under the (glass) header rather than over it:
 * never glass on glass. The header's edge is read when a toast appears, not per frame.
 */
export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  const desktop = useIsDesktop();
  const list = useRef<HTMLOListElement>(null);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el || !toasts.length || desktop) return;
    const bar = document.querySelector("header.site-header")?.getBoundingClientRect().bottom ?? 0;
    el.style.top = `max(${Math.max(12, Math.round(bar) + 8)}px, env(safe-area-inset-top))`;
  }, [toasts.length, desktop]);
  return (
    <ol
      ref={list}
      aria-live="polite"
      className={cn("pointer-events-none fixed z-[70] flex flex-col gap-2", desktop ? "right-6 bottom-6 items-end" : "inset-x-3 top-3")}
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} t={t} desktop={desktop} />
        ))}
      </AnimatePresence>
    </ol>
  );
}
