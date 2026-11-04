"use client";
import Link from "next/link";
import { Loader2, UserRound } from "lucide-react";
import { useEffect, useRef } from "react";
import { useAuth } from "@/features/auth/store";
import { useUi } from "@/features/shell/ui-store";
import { ApiError } from "@/lib/api/client";

export const errorText = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Please try again.");

/** Signed in, once stores have loaded: null while unknown. */
export function useSession(): boolean | null {
  const hydrated = useUi((s) => s.hydrated);
  const profile = useAuth((s) => s.profile);
  return hydrated ? Boolean(profile) : null;
}

export function SignInPrompt({ next, title = "Sign in to see your account", body = "Your orders, saved addresses and stock alerts are kept here." }: { next: string; title?: string; body?: string }) {
  return (
    <div className="mx-auto max-w-[720px] p-3 lg:p-6">
      <section className="flex flex-col items-center rounded-12 bg-surface px-4 py-10 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-brand-soft text-ink">
          <UserRound aria-hidden size={30} strokeWidth={1.75} />
        </span>
        <h2 className="mt-4 text-17 font-bold text-ink">{title}</h2>
        <p className="mt-1 max-w-[320px] text-13 text-muted">{body}</p>
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="press mt-5 flex h-12 w-full max-w-[280px] items-center justify-center rounded-12 bg-action text-15 font-semibold text-white">
          Sign in
        </Link>
      </section>
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <p role="alert" className="flex flex-wrap items-center gap-x-3 rounded-8 bg-danger-soft px-3 py-2 text-12 text-danger">
      {errorText(error)}
      {onRetry && (
        <button type="button" onClick={onRetry} className="min-h-11 font-semibold underline">
          Try again
        </button>
      )}
    </p>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-20 rounded-12" />
      ))}
    </div>
  );
}

/** A modal confirm on the native <dialog>: focus trap, Escape to close. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busyLabel,
  keepLabel = "Cancel",
  busy,
  error,
  confirmDisabled,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  busyLabel: string;
  keepLabel?: string;
  busy?: boolean;
  error?: unknown;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      className="m-auto w-[calc(100%-32px)] max-w-[420px] rounded-16 bg-surface p-5 text-ink backdrop:bg-scrim"
    >
      <h2 id="confirm-title" className="text-17 font-bold">
        {title}
      </h2>
      <div className="mt-2 space-y-3 text-13 text-muted">{children}</div>
      <div className="mt-3">
        <ErrorNote error={error} />
      </div>
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" disabled={busy} onClick={onClose} className="press h-11 rounded-12 border border-line px-4 text-13 font-semibold text-ink">
          {keepLabel}
        </button>
        <button type="button" disabled={busy || confirmDisabled} onClick={onConfirm} className="press flex h-11 items-center justify-center gap-2 rounded-12 bg-danger px-4 text-13 font-semibold text-white disabled:bg-disabled">
          {busy && <Loader2 aria-hidden size={16} className="animate-spin" />}
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
