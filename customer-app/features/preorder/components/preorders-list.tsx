"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronRight } from "lucide-react";
import { useSignedIn } from "@/features/auth/store";
import { useUi } from "@/features/shell/ui-store";
import { api, ApiError, qk } from "@/lib/api/client";
import { cn, rupees } from "@/lib/format";
import { RIPENESS } from "@/lib/ripeness";
import { PREORDER_STATUS, weekOf } from "../status";

/** /preorders: the customer's season bookings (GET /v1/preorders). */
export function PreordersList() {
  const hydrated = useUi((s) => s.hydrated);
  const signedIn = useSignedIn();
  const q = useQuery({ queryKey: qk.preorders, queryFn: api.preorders, enabled: hydrated && signedIn });

  if (hydrated && !signedIn)
    return (
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <p className="text-17 font-bold text-ink">Log in to see your bookings</p>
        <Link href="/login?next=/preorders" className="press mt-4 inline-flex h-11 items-center rounded-12 bg-action px-5 text-15 font-semibold text-white">
          Log in
        </Link>
      </div>
    );
  if (!hydrated || q.isPending)
    return (
      <div className="mx-auto max-w-[720px] space-y-3 p-3 lg:p-6" aria-label="Loading your bookings">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="skeleton h-28 rounded-12" />
        ))}
      </div>
    );
  if (q.isError)
    return (
      <div role="alert" className="mx-auto max-w-[720px] p-3 lg:p-6">
        <div className="rounded-12 bg-danger-soft p-4 text-13 text-danger">
          <p>{q.error instanceof ApiError ? q.error.message : "Couldn't load your bookings."}</p>
          <button type="button" onClick={() => q.refetch()} className="press mt-2 h-11 rounded-8 bg-surface px-4 font-semibold text-action">
            Try again
          </button>
        </div>
      </div>
    );
  if (!q.data.length)
    return (
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <span className="grid size-20 place-items-center rounded-full bg-brand-soft text-ink">
          <CalendarClock aria-hidden size={36} strokeWidth={1.5} />
        </span>
        <p className="mt-4 text-17 font-bold text-ink">No bookings yet</p>
        <p className="mt-1 text-13 text-muted">Book a box for a week of the new season at today&apos;s price.</p>
        <Link href="/preorder" className="press mt-4 inline-flex h-11 items-center rounded-12 bg-action px-5 text-15 font-semibold text-white">
          Book ahead
        </Link>
      </div>
    );

  return (
    <ul className="mx-auto max-w-[720px] space-y-3 p-3 lg:p-6">
      {q.data.map((p) => {
        const st = PREORDER_STATUS[p.status];
        return (
          <li key={p.id} className="rounded-12 bg-surface" data-testid="preorder-row">
            <Link href={`/preorders/${p.id}`} className="flex items-start justify-between gap-2 p-3">
              <div className="min-w-0">
                <span className={cn("rounded-4 px-1.5 py-0.5 text-11 font-semibold", st.tone)}>{st.label}</span>
                <p className="mt-1.5 text-13 font-semibold text-ink">
                  {p.qty} × {p.productName} · {rupees(p.total)}
                </p>
                <p className="text-12 text-muted">
                  {weekOf(p.weekStart)} · {RIPENESS[p.stage].label} · {p.number}
                </p>
              </div>
              <ChevronRight aria-hidden size={20} className="mt-1 shrink-0 text-muted" />
            </Link>
            {p.status === "CONVERTED" && p.orderId && (
              <Link href={`/order/${p.orderId}`} className="flex h-11 items-center border-t border-line px-3 text-13 font-semibold text-action">
                See the order
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
