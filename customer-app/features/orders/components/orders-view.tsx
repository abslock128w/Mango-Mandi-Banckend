"use client";
import Link from "next/link";
import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { ChevronRight, PackageOpen } from "lucide-react";
import { dateTime, longDate, plural, rupees } from "@/lib/format";
import { riseDelay } from "@/lib/motion";
import { useNow } from "@/features/checkout/components/hold-countdown";
import { useOrders, useSignedInReady } from "../hooks";
import { SignInPrompt } from "./sign-in-prompt";
import { StatusPill } from "./status-pill";

export function OrdersView() {
  const { hydrated, signedIn } = useSignedInReady();
  const { data, isPending, isError, refetch } = useOrders();
  const reduce = useReducedMotion();
  const now = useNow();

  if (hydrated && !signedIn) return <SignInPrompt next="/orders" />;
  if (!hydrated || isPending)
    return (
      <div className="mx-auto max-w-[720px] space-y-3 p-3 lg:p-6">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="skeleton h-24 rounded-12" />
        ))}
      </div>
    );
  if (isError)
    return (
      <div className="px-6 py-16 text-center" role="alert">
        <p className="text-15 font-bold text-ink">Couldn&apos;t load your orders</p>
        <button type="button" onClick={() => refetch()} className="press mt-3 h-11 rounded-12 border border-line px-4 text-13 font-semibold text-ink">
          Try again
        </button>
      </div>
    );
  if (!data?.length)
    return (
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <span className="grid size-20 place-items-center rounded-full bg-brand-soft text-ripe">
          <PackageOpen aria-hidden size={36} strokeWidth={1.5} />
        </span>
        <p className="mt-4 text-17 font-bold text-ink">No orders yet</p>
        <p className="mt-1 text-13 text-muted">Pick a box and choose the day you want to eat them.</p>
        <Link href="/" className="press mt-4 rounded-12 bg-action px-5 py-3 text-15 font-semibold text-white">
          Start shopping
        </Link>
      </div>
    );

  const sorted = [...data].sort((a, b) => b.placedAt.localeCompare(a.placedAt));
  return (
    <ul className="mx-auto max-w-[720px] space-y-3 p-3 lg:p-6">
      {sorted.map((o, i) => {
        const unpaid = o.status === "PAYMENT_PENDING" && (!o.holdExpiresAt || new Date(o.holdExpiresAt).getTime() > now);
        return (
          <m.li
            key={o.id}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: riseDelay(i) }}
            className="rounded-12 bg-surface p-3"
            data-testid="order-row"
          >
            <Link href={`/order/${o.id}`} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={o.status} />
                  <span className="text-12 text-muted">{o.number}</span>
                </div>
                <p className="mt-1.5 text-13 font-semibold text-ink">
                  {rupees(o.total)} · {plural(o.itemCount, "box", "boxes")}
                </p>
                <p className="text-12 text-muted">
                  Delivery {longDate(o.deliveryDate)} · Placed {dateTime(o.placedAt)}
                </p>
                {o.giftRecipient && <p className="text-12 text-muted">Gift for {o.giftRecipient}</p>}
              </div>
              <ChevronRight aria-hidden size={20} className="mt-1 shrink-0 text-muted" />
              <span className="sr-only">View order {o.number}</span>
            </Link>
            {unpaid && (
              <Link href={`/order/${o.id}`} className="press mt-3 flex h-11 w-full items-center justify-center rounded-8 bg-action text-13 font-semibold text-white">
                Pay now
              </Link>
            )}
          </m.li>
        );
      })}
    </ul>
  );
}
