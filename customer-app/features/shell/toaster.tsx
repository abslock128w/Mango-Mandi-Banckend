"use client";
import Link from "next/link";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { CheckCircle2, Info, X } from "lucide-react";
import { useEffect } from "react";
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
      className="pointer-events-auto relative w-full overflow-hidden rounded-12 bg-ink text-white shadow-sheet lg:w-[360px]"
    >
      <div className="flex items-center gap-2.5 py-3 pr-2 pl-3.5">
        <Icon aria-hidden size={20} strokeWidth={1.75} className={cn("shrink-0", t.tone === "success" ? "text-raw" : t.tone === "danger" ? "text-danger" : "text-brand")} />
        <p className="flex-1 text-13 font-medium">{t.title}</p>
        {t.action?.href && (
          <Link href={t.action.href} className="rounded-6 px-2 py-1 text-13 font-bold text-brand" onClick={() => dismiss(t.id)}>
            {t.action.label}
          </Link>
        )}
        <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="grid size-11 shrink-0 place-items-center rounded-full">
          <X size={18} strokeWidth={1.75} />
        </button>
      </div>
      <m.span
        aria-hidden
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: duration / 1000, ease: "linear" }}
        className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-brand"
      />
    </m.li>
  );
}

/** Toasts: slide in from the top on phones, bottom-right on laptops; auto-dismiss with a shrinking line. */
export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  const desktop = useIsDesktop();
  return (
    <ol
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed z-[70] flex flex-col gap-2",
        desktop ? "right-6 bottom-6 items-end" : "inset-x-3 top-[max(12px,env(safe-area-inset-top))]",
      )}
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} t={t} desktop={desktop} />
        ))}
      </AnimatePresence>
    </ol>
  );
}
