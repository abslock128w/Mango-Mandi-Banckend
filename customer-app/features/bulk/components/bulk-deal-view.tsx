"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2, Package, ShoppingBag } from "lucide-react";
import { useCart } from "@/features/cart/store";
import { useLocation, usePincode } from "@/features/location/store";
import { toast, useUi } from "@/features/shell/ui-store";
import { PageTransition } from "@/features/shell/page-transition";
import { api, ApiError, mediaUrl, qk } from "@/lib/api/client";
import { boxContents, cn, dayName, rupees } from "@/lib/format";
import { RIPENESS } from "@/lib/ripeness";
import type { BulkDeal, RipenessStage } from "@/lib/types";
import { availableOn, endsLabel, maxFor, nextTier, snapQty, tierAt, tierRange } from "../tiers";
import { QtyStepper } from "./qty-stepper";
import { StagePicker } from "./stage-picker";

/** The deal reply can say the pincode is outside delivery. */
type DealReply = BulkDeal & { serviceable?: boolean };

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** /bulk/[id]: one deal (GET /v1/bulk-deals/:id), its tiers, ripeness, day and quantity, then Add to cart. */
export function BulkDealView({ id }: { id: string }) {
  const hydrated = useUi((s) => s.hydrated);
  const pincode = usePincode();
  const q = useQuery({ queryKey: [...qk.bulkDeal(id), pincode], queryFn: () => api.bulkDeal(id, pincode) as Promise<DealReply>, enabled: hydrated, staleTime: 60_000 });

  if (!hydrated || q.isPending)
    return (
      <div className="mx-auto grid max-w-content gap-5 px-4 pt-4 lg:grid-cols-2 lg:px-6" aria-label="Loading the deal">
        <div className="skeleton aspect-4/3 rounded-16" />
        <div className="space-y-3">
          <div className="skeleton h-8 w-2/3 rounded-8" />
          <div className="skeleton h-40 rounded-12" />
          <div className="skeleton h-24 rounded-12" />
        </div>
      </div>
    );
  if (q.isError) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center">
        <h1 className="text-17 font-bold text-ink">{gone ? "This bulk deal is not available" : "Couldn't load this deal"}</h1>
        <p className="mt-1 text-13 text-muted">{gone ? "It may have ended or been taken down. Other deals are still on." : q.error instanceof ApiError ? q.error.message : "Please try again."}</p>
        {gone ? (
          <Link href="/bulk" className="press mt-4 inline-flex h-11 items-center rounded-12 bg-action px-5 text-15 font-semibold text-white">
            See bulk deals
          </Link>
        ) : (
          <button type="button" onClick={() => q.refetch()} className="press mt-4 h-11 rounded-12 bg-action px-5 text-15 font-semibold text-white">
            Try again
          </button>
        )}
      </div>
    );
  }
  return <DealDetail deal={q.data} pincode={pincode} />;
}

function DealDetail({ deal, pincode }: { deal: DealReply; pincode: string | null }) {
  const shopDate = useLocation((s) => s.deliveryDate);
  const setDeliveryDate = useLocation((s) => s.setDeliveryDate);
  const setBulk = useCart((s) => s.setBulk);
  const bulkLines = useCart((s) => s.bulk);
  const setCartOpen = useUi((s) => s.setCartOpen);
  const [photo, setPhoto] = useState(0);
  const [stage, setStage] = useState<RipenessStage | null>(null);
  const [qty, setQty] = useState<number | null>(null);

  useEffect(() => {
    document.title = `${deal.title} · MandiMangoes`;
  }, [deal.title]);

  // The day: the shop's chosen day when this deal delivers on it, else its first day with enough stock.
  const days = deal.availability ?? [];
  const date = days.find((x) => x.date === shopDate)?.date ?? days.find((x) => x.enough)?.date ?? days[0]?.date ?? null;
  const onDay = days.find((x) => x.date === date) ?? null;
  const picked: RipenessStage | null =
    stage && deal.stages.includes(stage) ? stage : (deal.stages.find((s) => onDay?.stages.find((x) => x.stage === s)?.enough) ?? deal.stages[0] ?? null);
  const available = availableOn(deal, date, picked);
  const max = maxFor(deal, available);
  const n = snapQty(deal, qty ?? deal.minQty, max);
  const tier = tierAt(deal.tiers, n);
  const next = nextTier(deal, n);
  const blocked = Boolean(pincode && deal.serviceable === false);
  const canAdd = Boolean(picked && tier && max >= deal.minQty && !blocked && (available == null || available >= n));

  const debounced = useDebounced(n, 350);
  const price = useQuery({
    queryKey: ["bulk-price", deal.id, debounced],
    queryFn: () => api.bulkPrice(deal.id, debounced),
    enabled: canAdd,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const live = price.data && price.data.qty === n ? price.data : null;
  const unitPrice = live?.unitPrice ?? tier?.unitPrice ?? deal.retailPrice;
  const total = live?.total ?? unitPrice * n;
  const pricing = canAdd && (debounced !== n || price.isFetching);

  const inCart = picked ? (bulkLines.find((l) => l.listingId === deal.id && l.stage === picked)?.qty ?? 0) : 0;
  const cur = deal.photos[Math.min(photo, Math.max(0, deal.photos.length - 1))];
  const contents = boxContents(deal.product.fruitsPerBox, deal.product.fruitWeightG);

  function add() {
    if (!picked || !canAdd) return;
    setBulk({
      listingId: deal.id,
      title: deal.title,
      apiSku: deal.product.sku,
      stage: picked,
      qty: n,
      image: mediaUrl(deal.photos[0]?.url, 320) ?? "",
      unitPrice,
    });
    toast({ title: `${n} boxes of ${deal.title} (${RIPENESS[picked].label.toLowerCase()}) are in your cart`, tone: "success" });
    setCartOpen(true);
  }

  return (
    <PageTransition>
      <div className="mx-auto max-w-content px-4 pt-4 pb-32 lg:px-6 lg:pb-10">
        <nav aria-label="Breadcrumb" className="mb-3 text-12 text-muted">
          <Link href="/bulk" className="inline-flex h-11 items-center font-semibold text-action">
            Bulk deals
          </Link>
        </nav>
        <div className="grid gap-5 lg:grid-cols-2 lg:gap-8">
          <div>
            <div className="aspect-4/3 overflow-hidden rounded-16 bg-chip">
              {cur ? (
                // eslint-disable-next-line @next/next/no-img-element -- API photo, resized by the API (?w=)
                <img
                  src={mediaUrl(cur.url, 960)!}
                  srcSet={[480, 640, 960, 1200].map((w) => `${mediaUrl(cur.url, w)} ${w}w`).join(", ")}
                  sizes="(min-width: 1024px) 560px, 100vw"
                  alt={`Photo ${photo + 1} of ${deal.photos.length}, ${deal.title}`}
                  className="size-full object-cover"
                />
              ) : (
                <span className="grid size-full place-items-center text-muted">
                  <Package aria-hidden size={56} strokeWidth={1.25} />
                </span>
              )}
            </div>
            {deal.photos.length > 1 && (
              <div role="group" aria-label="Photos" className="mt-2 flex gap-2 overflow-x-auto">
                {deal.photos.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-label={`Show photo ${i + 1}`}
                    aria-pressed={i === photo}
                    onClick={() => setPhoto(i)}
                    className={cn("press size-16 shrink-0 overflow-hidden rounded-8 border-2", i === photo ? "border-action" : "border-transparent")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- API thumbnail */}
                    <img src={mediaUrl(p.url, 160)!} alt="" loading="lazy" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-5">
            <header>
              <p className="text-12 font-bold tracking-wide text-action uppercase">Bulk deal</p>
              <h1 className="mt-1 font-display text-24 leading-tight font-extrabold text-ink lg:text-36">{deal.title}</h1>
              <p className="mt-1 text-13 text-muted">
                {deal.product.name} · {deal.product.variety} · {deal.product.boxSize} box
              </p>
            </header>
            {deal.description && <p className="text-13 whitespace-pre-line text-ink">{deal.description}</p>}

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-12 bg-surface p-3 text-13">
              {deal.origin && (
                <>
                  <dt className="text-muted">From</dt>
                  <dd className="text-ink">{deal.origin}</dd>
                </>
              )}
              {contents && (
                <>
                  <dt className="text-muted">In each box</dt>
                  <dd className="text-ink">{contents}</dd>
                </>
              )}
              <dt className="text-muted">Order</dt>
              <dd className="text-ink">
                {deal.minQty} boxes or more{deal.qtyStep > 1 ? `, in steps of ${deal.qtyStep}` : ""}, up to {deal.maxQty} per order
              </dd>
              {deal.endsAt && (
                <>
                  <dt className="text-muted">Offer ends</dt>
                  <dd className="text-ink">{endsLabel(deal.endsAt)}</dd>
                </>
              )}
            </dl>

            <section aria-labelledby="tiers-h">
              <h2 id="tiers-h" className="text-15 font-bold text-ink">
                Price per box
              </h2>
              <table className="mt-2 w-full overflow-hidden rounded-12 bg-surface text-13">
                <thead>
                  <tr className="border-b border-line text-left text-12 text-muted">
                    <th scope="col" className="px-3 py-2 font-semibold">Boxes</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Per box</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">You save</th>
                  </tr>
                </thead>
                <tbody>
                  {[...deal.tiers]
                    .sort((a, b) => a.minQty - b.minQty)
                    .map((t) => {
                      const on = tier?.minQty === t.minQty;
                      return (
                        <tr key={t.minQty} aria-current={on ? "true" : undefined} className={cn("border-b border-line last:border-0", on && "bg-tint")}>
                          <td className="px-3 py-2 text-ink">{tierRange(t)}</td>
                          <td className="px-3 py-2 font-semibold text-ink">{rupees(t.unitPrice)}</td>
                          <td className="px-3 py-2 text-right text-action">{t.savingPerBox > 0 ? `${rupees(t.savingPerBox)} a box` : "None"}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              <p className="mt-1.5 text-12 text-muted">A single box is {rupees(deal.retailPrice)} in the regular shop. One price whatever the ripeness.</p>
            </section>

            <StagePicker
              legend="Ripeness on delivery"
              stages={deal.stages}
              value={picked}
              onChange={setStage}
              off={(s) => Boolean(onDay?.stages.find((x) => x.stage === s && !x.enough))}
              note={(s) => {
                const st = onDay?.stages.find((x) => x.stage === s);
                if (!st || !onDay) return null;
                if (!st.enough) return st.available ? `Only ${st.available} boxes for ${dayName(onDay.date)}, below the minimum` : `None left for ${dayName(onDay.date)}`;
                return `${st.available} boxes for ${dayName(onDay.date)}${st.eatBy ? `. Eat by ${dayName(st.eatBy)}` : ""}`;
              }}
            />

            {!pincode ? (
              <p className="rounded-12 bg-brand-soft p-3 text-13 text-ink">
                <Link href={`/location?next=/bulk/${deal.id}`} className="font-semibold text-action underline">
                  Set your pincode
                </Link>{" "}
                to see the days we can deliver this deal and the stock for each.
              </p>
            ) : blocked ? (
              <p className="rounded-12 bg-danger-soft p-3 text-13 text-danger">
                We don&apos;t deliver to {pincode} yet.{" "}
                <Link href={`/location?next=/bulk/${deal.id}`} className="font-semibold underline">
                  Change pincode
                </Link>
              </p>
            ) : days.length > 0 ? (
              <fieldset>
                <legend className="text-15 font-bold text-ink">Delivery day</legend>
                <div role="radiogroup" className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {days.map((x) => (
                    <button
                      key={x.date}
                      type="button"
                      role="radio"
                      aria-checked={x.date === date}
                      onClick={() => setDeliveryDate(x.date)}
                      className={cn(
                        "press flex h-11 shrink-0 items-center rounded-full border px-4 text-13 font-semibold",
                        x.date === date ? "border-action bg-action text-white" : "border-line bg-surface text-ink",
                      )}
                    >
                      {dayName(x.date)}
                      {!x.enough && <span className="ml-1 font-normal opacity-80">(low stock)</span>}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-12 text-muted">You confirm the day and time at checkout.</p>
              </fieldset>
            ) : null}

            <section aria-labelledby="qty-h">
              <h2 id="qty-h" className="text-15 font-bold text-ink">
                How many boxes?
              </h2>
              {max >= deal.minQty ? (
                <>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <QtyStepper label="Boxes" value={n} min={deal.minQty} max={max} step={deal.qtyStep} onChange={setQty} />
                    <p className="text-right" aria-live="polite">
                      <span className="block text-12 text-muted">
                        {n} × {rupees(unitPrice)}
                      </span>
                      <b className="text-19 text-ink">{rupees(total)}</b>
                    </p>
                  </div>
                  {next && <p className="mt-1.5 text-12 text-action">Order {next.minQty} or more and pay {rupees(next.unitPrice)} a box.</p>}
                  {inCart > 0 && <p className="mt-1 text-12 text-muted">{inCart} boxes of this ripeness are in your cart. Adding again replaces that number.</p>}
                </>
              ) : (
                <p className="mt-2 text-13 text-danger">
                  {available != null && picked && date
                    ? `Not enough ${RIPENESS[picked].label.toLowerCase()} stock for the minimum of ${deal.minQty} boxes on ${dayName(date)}. Try another day or ripeness.`
                    : "This deal can't be ordered right now."}
                </p>
              )}
              {price.error && <p className="mt-1 text-12 text-danger">{price.error instanceof ApiError ? price.error.message : "Couldn't check the price."}</p>}
            </section>

            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-3 pt-2.5 pb-[max(10px,env(safe-area-inset-bottom))] lg:static lg:border-0 lg:bg-transparent lg:p-0">
              <button
                type="button"
                onClick={add}
                disabled={!canAdd || pricing}
                data-testid="bulk-add"
                className="press flex h-14 w-full items-center justify-center gap-2 rounded-12 bg-action text-17 font-bold text-white disabled:bg-disabled"
              >
                {pricing ? <Loader2 aria-hidden size={20} className="animate-spin" /> : <ShoppingBag aria-hidden size={20} />}
                {canAdd ? `Add ${n} boxes · ${rupees(total)}` : "Add to cart"}
              </button>
              <p className="mt-1.5 hidden text-center text-12 text-muted lg:block">Free delivery. Checkout confirms the price before you pay.</p>
            </div>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
