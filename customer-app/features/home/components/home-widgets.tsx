"use client";
import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronRight, Package, Wallet } from "lucide-react";
import { useSignedIn } from "@/features/auth/store";
import { useBulkDeals, usePreorderWeeks } from "@/features/catalog/hooks/queries";
import { WhenVisible } from "@/components/ui/when-visible";
import { api, qk } from "@/lib/api/client";
import { longDate, rupees } from "@/lib/format";

/** Bulk deals banner, shown only while there are deals (GET /v1/bulk-deals). */
export function BulkBanner() {
  const { data } = useBulkDeals();
  if (!data?.items.length) return null;
  const from = Math.min(...data.items.map((d) => d.fromPrice));
  return (
    <section className="px-4 pt-6 lg:px-6" aria-label="Bulk deals">
      <WhenVisible placeholder={<div className="min-h-[132px] rounded-16 bg-deep lg:min-h-[160px]" />}>
        <Link href="/bulk" className="relative block overflow-hidden rounded-16 bg-deep" data-testid="bulk-banner">
          <Image src="/images/banners/b3.jpg" alt="" fill sizes="(min-width: 1024px) 1150px, 92vw" className="object-cover opacity-35" />
          <div className="relative flex min-h-[132px] flex-col justify-center p-4 text-white lg:min-h-[160px] lg:p-6">
            <p className="font-display text-19 leading-tight font-extrabold lg:text-24">Bulk deals for events and gifting</p>
            <p className="mt-1 max-w-[80%] text-12 lg:text-15">
              {data.items.length} deal{data.items.length === 1 ? "" : "s"} with tiered prices, from {rupees(from)} a box.
            </p>
            <span className="mt-3 w-fit rounded-8 bg-brand px-3 py-1.5 text-12 font-bold text-ink">See bulk deals</span>
          </div>
        </Link>
      </WhenVisible>
    </section>
  );
}

/** Book a box for a later week at today's price (GET /v1/preorders/weeks). */
export function BookAheadCard() {
  const { data } = usePreorderWeeks();
  const open = data?.weeks.filter((w) => w.remaining > 0) ?? [];
  if (!open.length) return null;
  const first = open.map((w) => w.weekStart).sort()[0];
  return (
    <section className="px-4 pt-6 lg:px-6" aria-labelledby="ahead-h">
      <Link href="/preorder" className="flex items-center gap-3 rounded-16 border border-brand bg-brand-soft p-4" data-testid="book-ahead">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand text-ink">
          <CalendarClock aria-hidden size={24} strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span id="ahead-h" className="block font-display text-17 font-extrabold text-ink">
            Book a box ahead
          </span>
          <span className="block text-12 text-ink">Lock in today&apos;s price for the week of {longDate(first)} or later. We pick your delivery day that week once the fruit is in.</span>
        </span>
        <ChevronRight aria-hidden size={20} className="shrink-0 text-ink" />
      </Link>
    </section>
  );
}

/** An unpaid order holds stock for a few minutes; only one is allowed at a time. */
export function UnpaidBanner() {
  const signedIn = useSignedIn();
  const { data } = useQuery({ queryKey: qk.orders, queryFn: api.orders, enabled: signedIn, staleTime: 30_000 });
  const unpaid = data?.find((o) => o.status === "PAYMENT_PENDING" && o.holdExpiresAt && new Date(o.holdExpiresAt) > new Date());
  if (!unpaid) return null;
  return (
    <section className="px-4 pt-3 lg:px-6" role="status">
      <Link href={`/orders/${unpaid.id}`} className="flex items-center gap-3 rounded-12 border border-ribbon bg-ribbon-soft p-3">
        <Wallet aria-hidden size={20} className="shrink-0 text-ribbon" />
        <span className="min-w-0 flex-1 text-13 text-ink">
          <b>Order {unpaid.number} is waiting for payment.</b> Pay for it or cancel it before placing another order.
        </span>
        <ChevronRight aria-hidden size={18} className="shrink-0 text-ink" />
      </Link>
    </section>
  );
}

export function HowItWorks() {
  const steps = [
    { icon: CalendarClock, title: "Pick your day", text: "Delivery from tomorrow, in a time slot" },
    { icon: Package, title: "Pick the ripeness", text: "Ripe, semi-ripe or raw, on that day" },
    { icon: Wallet, title: "Pay online", text: "UPI, card or netbanking. Delivery is free" },
  ];
  return (
    <section aria-labelledby="how-h" className="px-4 pt-6 lg:px-6">
      <h2 id="how-h" className="font-display text-19 font-extrabold text-ink">
        How it works
      </h2>
      <ol className="mt-3 grid grid-cols-3 gap-2">
        {steps.map(({ icon: Icon, title, text }, i) => (
          <li key={title} className="flex flex-col items-center rounded-12 bg-surface p-3 text-center">
            <span className="relative grid size-11 place-items-center rounded-full bg-brand-soft text-ink">
              <Icon aria-hidden size={20} strokeWidth={1.75} />
              <span className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-deep text-9 font-bold text-white">{i + 1}</span>
            </span>
            <p className="mt-1.5 text-12 font-bold text-ink">{title}</p>
            <p className="text-11 text-muted">{text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
