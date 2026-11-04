"use client";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useSignedIn } from "@/features/auth/store";
import { toast, useUi } from "@/features/shell/ui-store";
import { api, ApiError, qk } from "@/lib/api/client";
import { cn, dateTime, rupees } from "@/lib/format";
import { RIPENESS } from "@/lib/ripeness";
import type { Preorder } from "@/lib/types";
import { devPayAllowed, PREORDER_STATUS, realPayUrl, weekOf, weekRange } from "../status";

/** /preorders/[id]: one booking (GET /v1/preorders/:id), with pay, test pay (dev) and cancel. */
export function PreorderDetail({ id }: { id: string }) {
  const hydrated = useUi((s) => s.hydrated);
  const signedIn = useSignedIn();
  const q = useQuery({
    queryKey: qk.preorder(id),
    queryFn: () => api.preorder(id),
    enabled: hydrated && signedIn,
    // Waiting on the payment webhook: check often.
    refetchInterval: (query) => (query.state.data?.status === "PAYMENT_PENDING" ? 4000 : false),
  });

  if (hydrated && !signedIn)
    return (
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <p className="text-17 font-bold text-ink">Log in to see this booking</p>
        <Link href={`/login?next=${encodeURIComponent(`/preorders/${id}`)}`} className="press mt-4 inline-flex h-11 items-center rounded-12 bg-action px-5 text-15 font-semibold text-white">
          Log in
        </Link>
      </div>
    );
  if (!hydrated || q.isPending)
    return (
      <div className="mx-auto max-w-[720px] space-y-3 p-3 lg:p-6" aria-label="Loading your booking">
        <div className="skeleton h-24 rounded-12" />
        <div className="skeleton h-40 rounded-12" />
      </div>
    );
  if (q.isError) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <p className="text-17 font-bold text-ink">{gone ? "Booking not found" : "Couldn't load this booking"}</p>
        {!gone && <p className="mt-1 text-13 text-muted">{q.error instanceof ApiError ? q.error.message : "Please try again."}</p>}
        {gone ? (
          <Link href="/preorders" className="press mt-4 inline-flex h-11 items-center rounded-12 bg-action px-5 text-15 font-semibold text-white">
            See your bookings
          </Link>
        ) : (
          <button type="button" onClick={() => q.refetch()} className="press mt-4 h-11 rounded-12 bg-action px-5 text-15 font-semibold text-white">
            Try again
          </button>
        )}
      </div>
    );
  }
  return <Detail pre={q.data} />;
}

function Detail({ pre }: { pre: Preorder }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.preorder(pre.id) });
    qc.invalidateQueries({ queryKey: qk.preorders });
    qc.invalidateQueries({ queryKey: qk.preorderWeeks });
    qc.invalidateQueries({ queryKey: qk.orders });
  };
  const devPay = useMutation({ mutationFn: (outcome: "captured" | "failed") => api.devPayPreorder(pre.id, outcome), onSettled: refresh });
  const cancel = useMutation({
    mutationFn: () => api.cancelPreorder(pre.id),
    onSuccess: () => {
      setConfirming(false);
      toast({ title: `Booking ${pre.number} cancelled`, tone: "success" });
      refresh();
    },
  });
  const st = PREORDER_STATUS[pre.status];
  const payUrl = realPayUrl(pre);
  const paid = pre.paymentStatus === "SUCCEEDED" || pre.paymentStatus === "REFUNDED";
  const cancellable = pre.status === "PAYMENT_PENDING" || pre.status === "BOOKED" || pre.status === "WAITLISTED";

  return (
    <div className="mx-auto max-w-[720px] space-y-3 p-3 lg:p-6">
      <section className="rounded-12 bg-surface p-4" aria-live="polite">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-15 font-bold text-ink">Booking {pre.number}</h2>
          <span className={cn("rounded-4 px-1.5 py-0.5 text-11 font-semibold", st.tone)}>{st.label}</span>
        </div>

        {pre.status === "PAYMENT_PENDING" && (
          <div className="mt-2 space-y-2">
            <p className="text-13 text-ink">
              Pay to confirm your booking.
              {pre.holdExpiresAt && ` Your boxes are held until ${dateTime(pre.holdExpiresAt)}.`} This page updates on its own once you&apos;ve paid.
            </p>
            {payUrl && (
              <a href={payUrl} className="press flex h-12 w-full items-center justify-center rounded-12 bg-action text-15 font-bold text-white">
                Pay {rupees(pre.total)}
              </a>
            )}
            {devPayAllowed(pre) && (
              <div className="rounded-8 border border-dashed border-line p-3">
                <p className="text-12 text-muted">Test mode: no payment gateway is set up. Pretend to pay.</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={devPay.isPending}
                    onClick={() => devPay.mutate("captured")}
                    className="press flex h-11 flex-1 items-center justify-center gap-2 rounded-8 bg-action text-13 font-semibold text-white disabled:bg-disabled"
                  >
                    {devPay.isPending && <Loader2 aria-hidden size={16} className="animate-spin" />} Pay (test)
                  </button>
                  <button
                    type="button"
                    disabled={devPay.isPending}
                    onClick={() => devPay.mutate("failed")}
                    className="press h-11 flex-1 rounded-8 border border-line text-13 font-semibold text-ink"
                  >
                    Payment fails (test)
                  </button>
                </div>
                {devPay.error && <p className="mt-1 text-12 text-danger">{devPay.error instanceof ApiError ? devPay.error.message : "Test payment failed."}</p>}
              </div>
            )}
          </div>
        )}
        {pre.status === "BOOKED" && (
          <p className="mt-2 text-13 text-ink">
            You&apos;re booked for the {weekOf(pre.weekStart).toLowerCase()}. Once the fruit is in we&apos;ll pick your delivery day and message you.
          </p>
        )}
        {pre.status === "WAITLISTED" && (
          <p className="mt-2 text-13 text-ink">
            You&apos;re on the waitlist. If a box frees up for the {weekOf(pre.weekStart).toLowerCase()}, we&apos;ll message you a payment link. Nothing has been charged.
          </p>
        )}
        {pre.status === "CONVERTED" && (
          <div className="mt-2">
            <p className="text-13 text-ink">Your delivery day is set. Your booking is now a regular order.</p>
            {pre.orderId && (
              <Link href={`/order/${pre.orderId}`} className="press mt-2 flex h-12 w-full items-center justify-center rounded-12 bg-action text-15 font-bold text-white">
                See the order
              </Link>
            )}
          </div>
        )}
        {pre.status === "CANCELLED" && (
          <p className="mt-2 text-13 text-ink">
            This booking was cancelled.{" "}
            {paid ? `Your ${rupees(pre.total)} goes back to the way you paid.` : "We have no payment for it. If money has left your account, it is refunded in full."}
          </p>
        )}
      </section>

      <section className="rounded-12 bg-surface p-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-13">
          <dt className="text-muted">Week</dt>
          <dd className="text-ink">{weekRange(pre.weekStart)}</dd>
          <dt className="text-muted">Deliver to</dt>
          <dd className="text-ink">
            {pre.customerName ? `${pre.customerName}, ` : ""}
            {pre.address}, {pre.pincode}
          </dd>
          {pre.movedCount > 0 && (
            <>
              <dt className="text-muted">Moved</dt>
              <dd className="text-ink">We moved this booking to a new week {pre.movedCount === 1 ? "once" : `${pre.movedCount} times`}.</dd>
            </>
          )}
        </dl>
        <div className="mt-3 flex items-start justify-between gap-2 border-t border-line pt-3">
          <div>
            <p className="text-13 font-semibold text-ink">
              {pre.qty} × {pre.productName}
            </p>
            <p className="text-12 text-muted">
              {RIPENESS[pre.stage].label} on arrival · {rupees(pre.unitPrice)} a box
            </p>
          </div>
          <b className="text-15 text-ink">{rupees(pre.total)}</b>
        </div>
        <p className="mt-2 text-12 text-muted">{paid ? "Paid." : "Prepaid."} GST included. No delivery fee.</p>
      </section>

      {cancellable &&
        (confirming ? (
          <section role="alertdialog" aria-labelledby="cancel-h" aria-describedby="cancel-body" className="rounded-12 border border-danger bg-surface p-4">
            <h2 id="cancel-h" className="text-15 font-bold text-ink">
              Cancel booking {pre.number}?
            </h2>
            <p id="cancel-body" className="mt-1 text-13 text-ink">
              {paid
                ? `You get the full ${rupees(pre.total)} back to the way you paid.`
                : pre.status === "WAITLISTED"
                  ? "Nothing is charged while you are on the waitlist."
                  : "No payment has reached us for this booking. If you have just paid, cancelling refunds it in full."}
            </p>
            {cancel.error && <p className="mt-1 text-12 text-danger">{cancel.error instanceof ApiError ? cancel.error.message : "Couldn't cancel. Please try again."}</p>}
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="press h-11 flex-1 rounded-8 border border-line text-13 font-semibold text-ink">
                Keep booking
              </button>
              <button
                type="button"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate()}
                className="press flex h-11 flex-1 items-center justify-center gap-2 rounded-8 bg-danger text-13 font-semibold text-white disabled:bg-disabled"
              >
                {cancel.isPending && <Loader2 aria-hidden size={16} className="animate-spin" />} Cancel booking
              </button>
            </div>
          </section>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="press h-11 w-full rounded-12 text-13 font-semibold text-danger">
            Cancel booking
          </button>
        ))}

      <Link href="/preorders" className="flex h-11 items-center justify-center text-13 font-semibold text-action">
        All your bookings
      </Link>
    </div>
  );
}
