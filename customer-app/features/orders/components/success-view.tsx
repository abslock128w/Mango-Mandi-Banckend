"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { Check, ChevronRight, Clock, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { RollingNumber } from "@/components/ui/rolling-number";
import { api, ApiError, qk } from "@/lib/api/client";
import { dayName, plural, rupees, windowLabel } from "@/lib/format";
import { ease, spring } from "@/lib/motion";
import { useOrder, useSignedInReady } from "../hooks";
import { SignInPrompt } from "./sign-in-prompt";

// The mango splash (replaces the confetti and the Lottie tick): its own chunk, fetched with this view.
const MangoSplash = dynamic(() => import("./mango-splash").then((mod) => mod.MangoSplash), { ssr: false });

/** The order number counts in once the splash has settled (900 ms): "MM-000123" rolls its digits. */
function OrderNumber({ number, animate }: { number: string; animate: boolean }) {
  const digits = number.match(/(\d+)$/)?.[1];
  const [shown, setShown] = useState(animate && digits ? 0 : Number(digits ?? 0));
  useEffect(() => {
    if (!animate || !digits) return;
    const t = setTimeout(() => setShown(Number(digits)), 900);
    return () => clearTimeout(t);
  }, [animate, digits]);
  if (!digits) return <>{number}</>;
  return (
    <>
      {number.slice(0, -digits.length)}
      <RollingNumber value={shown} format={(n) => String(n).padStart(digits.length, "0")} />
    </>
  );
}

/** How long the page waits for a payment to be confirmed before handing over to the order page. */
const WAIT_MS = 30_000;

export function SuccessView({ id }: { id: string }) {
  const qc = useQueryClient();
  const { hydrated, signedIn, ready } = useSignedInReady();
  const orderQ = useOrder(id);
  const order = orderQ.data;
  const reduce = useReducedMotion();
  const [started] = useState(() => Date.now());
  // The payment may still be settling (webhook or verify in flight): check briefly.
  const status = useQuery({
    queryKey: ["payment-status", id],
    queryFn: () => api.paymentStatus(id),
    enabled: ready,
    refetchInterval: (q) => (q.state.data?.status === "SUCCEEDED" || q.state.data?.status === "FAILED" || Date.now() - started > WAIT_MS ? false : 2000),
  });
  const paid = status.data?.status === "SUCCEEDED" || (order && order.paymentStatus === "SUCCEEDED");
  const failed = status.data?.status === "FAILED";
  // Past the wait with no answer: say so and hand over to the order page, rather than spin for ever.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  const waiting = !paid && !failed && timedOut;
  const missing = [orderQ.error, status.error].some((e) => e instanceof ApiError && e.status === 404);
  useEffect(() => {
    if (paid) {
      void qc.invalidateQueries({ queryKey: qk.order(id) });
      void qc.invalidateQueries({ queryKey: qk.orders });
    }
  }, [paid, qc, id]);

  if (hydrated && !signedIn) return <SignInPrompt next={`/order/${id}/success`} title="Sign in to see your order" />;
  if (missing)
    return (
      <div className="p-8 text-center" role="alert">
        <p className="text-17 font-bold text-ink">We couldn&apos;t find that order</p>
        <Link href="/orders" className="mt-3 inline-flex h-11 items-center text-13 font-semibold text-action">
          See your orders
        </Link>
      </div>
    );

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center px-4 pt-14 pb-10 text-center">
      <div className="relative grid size-40 place-items-center">
        {waiting ? (
          <span className="grid size-24 place-items-center rounded-full bg-tint text-action">
            <Clock aria-hidden size={40} />
          </span>
        ) : !paid && !failed ? (
          <span className="grid size-24 place-items-center rounded-full bg-tint text-action">
            <Loader2 aria-hidden size={40} className="animate-spin" />
          </span>
        ) : failed ? (
          <span className="grid size-24 place-items-center rounded-full bg-danger-soft text-danger">
            <Check aria-hidden size={48} strokeWidth={3} />
          </span>
        ) : (
          <MangoSplash />
        )}
      </div>
      {/* The headline rises once the mango has settled (900 ms); the status line stays put for screen readers. */}
      <m.h1 key={paid ? "title-paid" : "title-waiting"} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: paid ? 0.9 : 0.3, duration: 0.24, ease: ease.standard }} className="font-display text-24 font-extrabold text-ink">
        {paid ? "Order confirmed" : failed ? "Payment didn't go through" : waiting ? "Still waiting for your payment" : "Confirming your payment"}
      </m.h1>
      <p className="mt-1 text-13 text-muted" role="status">
        {paid && order
          ? `Arriving ${dayName(order.deliveryDate)}${order.slot ? `, ${windowLabel(order.slot.startsAt, order.slot.endsAt)}` : ""}.`
          : failed
            ? "No money was taken. You can try again from the order page."
            : waiting
              ? "If you paid, it shows on the order page within a few minutes. You won't be charged twice."
              : "This takes a few seconds."}
      </p>

      {order && (
        <m.section
          key={paid ? "card-paid" : "card-waiting"}
          initial={reduce ? false : { opacity: 0, y: 48 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring.gentle, delay: paid && !reduce ? 1.1 : 0.5 }}
          className="mt-8 w-full rounded-16 border-[0.5px] border-line bg-surface p-4 text-left shadow-card"
          aria-label="Order summary"
        >
          <div className="flex items-center justify-between">
            <p className="text-13 font-semibold text-ink">
              Order <OrderNumber number={order.number} animate={Boolean(paid && !reduce)} />
            </p>
            <span className="rounded-4 bg-tint px-2 py-0.5 text-11 font-semibold text-action">{paid ? "Paid" : "Waiting"}</span>
          </div>
          <ul className="mt-3 space-y-1 text-12 text-ink">
            {order.items.map((l) => (
              <li key={`${l.sku}${l.stage}`}>
                {l.quantity} × {l.name}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3">
            <span className="text-12 text-muted">{plural(order.items.reduce((n, l) => n + l.quantity, 0), "box", "boxes")}</span>
            <span className="text-15 font-bold text-ink tabular-nums">{rupees(order.total)}</span>
          </div>
          <Link href={`/order/${order.id}`} data-testid="track-order" className="press mt-4 flex h-12 items-center justify-center gap-1 rounded-12 bg-action text-15 font-semibold text-white">
            {failed ? "Go to the order" : "Track order"} <ChevronRight aria-hidden size={20} />
          </Link>
        </m.section>
      )}
      <Link href="/" className="mt-4 flex h-11 items-center text-13 font-semibold text-action">
        Continue shopping
      </Link>
    </div>
  );
}
