"use client";
import Link from "next/link";
import { DotLottieReact, setWasmUrl } from "@lottiefiles/dotlottie-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { Check, ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, qk } from "@/lib/api/client";
import { dayName, plural, rupees, windowLabel } from "@/lib/format";
import { softSpring } from "@/lib/motion";
import { useOrder, useSignedInReady } from "../hooks";
import { Confetti } from "./confetti";
import { SignInPrompt } from "./sign-in-prompt";

setWasmUrl("/lottie/dotlottie-player.wasm");

/** How long the page waits for a payment to be confirmed before handing over to the order page. */
const WAIT_MS = 30_000;

export function SuccessView({ id }: { id: string }) {
  const qc = useQueryClient();
  const { hydrated, signedIn, ready } = useSignedInReady();
  const { data: order } = useOrder(id);
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
  useEffect(() => {
    if (paid) {
      void qc.invalidateQueries({ queryKey: qk.order(id) });
      void qc.invalidateQueries({ queryKey: qk.orders });
    }
  }, [paid, qc, id]);

  if (hydrated && !signedIn) return <SignInPrompt next={`/order/${id}/success`} title="Log in to see your order" />;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center px-4 pt-14 pb-10 text-center">
      <div className="relative grid size-40 place-items-center">
        {paid && <Confetti />}
        {!paid && !failed ? (
          <span className="grid size-24 place-items-center rounded-full bg-tint text-action">
            <Loader2 aria-hidden size={40} className="animate-spin" />
          </span>
        ) : reduce || failed ? (
          <span className={failed ? "grid size-24 place-items-center rounded-full bg-danger-soft text-danger" : "grid size-24 place-items-center rounded-full bg-action text-white"}>
            <Check aria-hidden size={48} strokeWidth={3} />
          </span>
        ) : (
          <DotLottieReact src="/lottie/success.json" autoplay loop={false} className="size-32" aria-hidden />
        )}
      </div>
      <m.h1 initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="font-display text-24 font-extrabold text-ink">
        {paid ? "Order confirmed" : failed ? "Payment didn't go through" : "Confirming your payment"}
      </m.h1>
      <p className="mt-1 text-13 text-muted" role="status">
        {paid && order
          ? `Arriving ${dayName(order.deliveryDate)}${order.slot ? `, ${windowLabel(order.slot.startsAt, order.slot.endsAt)}` : ""}.`
          : failed
            ? "No money was taken. You can try again from the order page."
            : "This takes a few seconds."}
      </p>

      {order && (
        <m.section
          initial={reduce ? false : { opacity: 0, y: 48 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...softSpring, delay: 0.5 }}
          className="mt-8 w-full rounded-16 border-[0.5px] border-line bg-surface p-4 text-left shadow-card"
          aria-label="Order summary"
        >
          <div className="flex items-center justify-between">
            <p className="text-13 font-semibold text-ink">Order {order.number}</p>
            <span className="rounded-4 bg-tint px-1.5 py-0.5 text-11 font-semibold text-action">{paid ? "Paid" : "Waiting"}</span>
          </div>
          <ul className="mt-3 space-y-1 text-12 text-ink">
            {order.items.map((l) => (
              <li key={`${l.sku}${l.stage}`}>
                {l.quantity} × {l.name}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
            <span className="text-12 text-muted">{plural(order.items.reduce((n, l) => n + l.quantity, 0), "box", "boxes")}</span>
            <span className="text-15 font-bold text-ink">{rupees(order.total)}</span>
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
