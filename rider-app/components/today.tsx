"use client";
import { Check, ChevronDown, Gift, MapPin, Navigation, Package, Phone, Warehouse, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { OPS_PHONE } from "@/lib/config";
import { dateWords, firstName, mapsDirections, orderNo, STAGE, telHref, warehouseDirections } from "@/lib/format";
import { useRun, type RunOrder } from "@/lib/run-context";
import { PendingBadge } from "./pending-badge";
import { StopChip } from "./stop-chip";
import { A, Card, ErrorText, LinkButton, Spinner } from "./ui";

const finished = (o: RunOrder) => o.state === "delivered" || o.state === "missed";
const contents = (o: RunOrder) => o.items.map((i) => `${i.quantity} × ${i.productName} (${STAGE[i.stage] ?? i.stage.toLowerCase()})`).join(", ");
const address = (o: RunOrder) => [o.deliveryAddress, o.pincode].filter(Boolean).join(", ");
const boxes = (n: number) => `${n} box${n === 1 ? "" : "es"}`;
const stopHref = (o: RunOrder) => (o.state === "out" ? `/stop?id=${encodeURIComponent(o.id)}` : `/pickup?id=${encodeURIComponent(o.id)}`);

/** Boxes still at a warehouse, grouped by where they wait. */
function toCollect(orders: RunOrder[]) {
  const groups = new Map<string, { warehouse: RunOrder["pickupWarehouse"]; orders: RunOrder[] }>();
  for (const o of orders.filter((x) => x.state === "pickup")) {
    const key = o.pickupWarehouse?.id ?? "";
    const g = groups.get(key) ?? { warehouse: o.pickupWarehouse ?? null, orders: [] };
    g.orders.push(o);
    groups.set(key, g);
  }
  return [...groups.values()];
}

export function Today() {
  const { date, orders, manifest, loading, error, offline, pending } = useRun();
  const router = useRouter();
  const done = orders.filter(finished).length;
  // The current stop: first one out for delivery, else the first to pick up.
  const current = orders.find((o) => o.state === "out") ?? orders.find((o) => o.state === "pickup") ?? null;
  const rest = orders.filter((o) => o !== current);
  const slots = [...new Set(orders.map((o) => o.slotLabel).filter((s): s is string => Boolean(s)))];
  const allDone = orders.length > 0 && done === orders.length;
  // While a stop is out, boxes still at a warehouse get their own entry; before that, the current
  // stop itself is the way into the pickup.
  const collect = current?.state === "out" ? toCollect(orders) : [];

  useEffect(() => {
    if (allDone) router.prefetch("/done");
  }, [allDone, router]);

  return (
    <div className="pb-12">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/95 px-4 pt-4 pb-3 backdrop-blur">
        <p className="text-sm font-semibold text-muted">Today · {dateWords(date)}</p>
        <h1 className="font-display text-3xl leading-tight text-green">{slots.length ? slots.map((s) => s.split(" · ")[0]).join(" + ") : "Your run"}</h1>
        {slots.length > 0 && <p className="text-base text-muted">{slots.map((s) => s.split(" · ")[1]).filter(Boolean).join(", ")}</p>}
        {orders.length > 0 && <Progress done={done} total={orders.length} />}
        {(pending > 0 || offline) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PendingBadge count={pending} />
            {offline && (
              <span className="inline-flex items-center gap-2 rounded-full bg-chip px-3 py-1 text-sm font-semibold text-muted">
                <WifiOff aria-hidden size={16} /> Offline: showing the saved run
              </span>
            )}
          </div>
        )}
      </header>

      <div className="flex flex-col gap-5 px-4 pt-4">
        {loading && !manifest && (
          <div className="grid place-items-center py-16">
            <Spinner label="Loading your run" />
          </div>
        )}
        <ErrorText>{error}</ErrorText>
        {manifest && !orders.length && (
          <Card>
            <h2 className="font-display text-2xl text-green">No stops for you today</h2>
            <p className="mt-1 text-base text-muted">Ops adds stops on the Deliveries page. This screen checks again every 30 seconds.</p>
            <A href={telHref(OPS_PHONE)} variant="secondary" size="lg" className="mt-4 w-full">
              <Phone aria-hidden size={20} /> Call ops
            </A>
          </Card>
        )}
        {allDone && (
          <LinkButton href="/done" variant="confirm" size="xl" className="w-full">
            Run complete: see the summary
          </LinkButton>
        )}

        {current && <CurrentStop o={current} index={orders.indexOf(current) + 1} total={orders.length} waiting={toCollect(orders)} />}

        {collect.map((g) => (
          <PickupEntry key={g.warehouse?.id ?? "none"} warehouse={g.warehouse ?? null} orders={g.orders} />
        ))}

        {rest.length > 0 && (
          <section aria-labelledby="other-stops" className="flex flex-col gap-2">
            <h2 id="other-stops" className="px-1 text-sm font-bold tracking-wide text-muted uppercase">
              Other stops
            </h2>
            <ol className="flex flex-col gap-2" data-testid="other-stops">
              {rest.map((o) => (
                <StopRow key={o.id} o={o} index={orders.indexOf(o) + 1} />
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const id = useId();
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="mt-3 flex flex-col gap-2">
      <p id={id} className="text-base font-semibold" data-testid="run-progress">
        <span className="font-display text-2xl text-green tabular-nums">{done}</span> of {total} stops done
      </p>
      <div role="progressbar" aria-labelledby={id} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="h-3 overflow-hidden rounded-full border border-line bg-chip">
        <div className="h-full rounded-full bg-green transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CurrentStop({ o, index, total, waiting }: { o: RunOrder; index: number; total: number; waiting: ReturnType<typeof toCollect> }) {
  const out = o.state === "out";
  const toWarehouse = !out && o.pickupWarehouse;
  const here = waiting.find((g) => (g.warehouse?.id ?? "") === (o.pickupWarehouse?.id ?? ""));
  const hereBoxes = here ? here.orders.reduce((n, x) => n + x.boxes, 0) : 0;
  return (
    <motion.section
      layout="position"
      aria-label="Current stop"
      data-testid="current-stop"
      className="overflow-hidden rounded-[24px] border-2 border-green bg-paper shadow-lift"
    >
      <div className="flex items-center justify-between gap-2 bg-green px-4 py-2.5">
        <p className="text-sm font-semibold text-white">
          Stop {index} of {total} · {orderNo(o.number)}
        </p>
        <StopChip state={o.state} />
      </div>
      <div className="flex flex-col gap-3 p-4">
        <h2 className="font-display text-4xl leading-tight text-ink">{firstName(o.customerName)}</h2>
        <p className="flex gap-2 text-lg">
          <MapPin aria-hidden size={22} className="mt-0.5 shrink-0 text-green" />
          <span className="line-clamp-2">{address(o)}</span>
        </p>
        <p className="flex gap-2 text-base text-muted">
          <Package aria-hidden size={22} className="mt-0.5 shrink-0 text-green" />
          <span>
            <strong className="text-ink">{boxes(o.boxes)}</strong> · {contents(o)}
          </span>
        </p>
        {o.gift && (
          <p className="flex items-center gap-2 rounded-xl bg-mango-soft px-3 py-2 text-base font-semibold text-ink">
            <Gift aria-hidden size={20} className="shrink-0 text-green" /> Gift from {o.gift.from}
          </p>
        )}
        {toWarehouse && (
          <div className="rounded-xl bg-chip px-3 py-2">
            <p className="text-base" data-testid="pickup-warehouse">
              Collect from <strong>{o.pickupWarehouse!.name}</strong>
            </p>
            {here && here.orders.length > 1 && (
              <p className="text-sm text-muted">
                {boxes(hereBoxes)} for {here.orders.length} stops wait there.
              </p>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 pt-1">
          {/* Before the pickup, directions to the warehouse; after it, to the customer. */}
          <A href={toWarehouse ? warehouseDirections(o.pickupWarehouse!) : mapsDirections(address(o))} target="_blank" rel="noopener" variant="secondary" size="xl" className="flex-col gap-0.5 py-2">
            <Navigation aria-hidden size={24} />
            <span className="text-base">{toWarehouse ? "To warehouse" : "Navigate"}</span>
          </A>
          {o.phone ? (
            <A href={telHref(o.phone)} variant="secondary" size="xl" className="flex-col gap-0.5 py-2">
              <Phone aria-hidden size={24} />
              <span className="text-base">Call</span>
            </A>
          ) : (
            <p className="grid min-h-16 place-items-center rounded-2xl bg-chip px-2 text-center text-sm text-muted">No phone number</p>
          )}
        </div>
        <LinkButton href={stopHref(o)} size="xl" className="w-full">
          {out ? "At the door" : "Pick up at warehouse"}
        </LinkButton>
      </div>
    </motion.section>
  );
}

/** Boxes still to collect while a delivery is under way: where, how many, and the next one to pick up. */
function PickupEntry({ warehouse, orders }: { warehouse: RunOrder["pickupWarehouse"] | null; orders: RunOrder[] }) {
  const count = orders.reduce((n, o) => n + o.boxes, 0);
  const id = useId();
  return (
    <Card aria-labelledby={id} data-testid="pickup-entry" accent="mango">
      <div className="flex items-start gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-mango text-ink">
          <Warehouse aria-hidden size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-muted">Still to collect</p>
          <h2 id={id} className="font-display text-2xl leading-tight text-ink">
            {warehouse?.name ?? "At the warehouse"}
          </h2>
          <p className="text-base text-muted">
            {boxes(count)} for {orders.length} stop{orders.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {warehouse ? (
          <A href={warehouseDirections(warehouse)} target="_blank" rel="noopener" variant="secondary" size="lg">
            <Navigation aria-hidden size={20} /> Directions
          </A>
        ) : (
          <span />
        )}
        <LinkButton href={`/pickup?id=${encodeURIComponent(orders[0].id)}`} size="lg">
          Pick up next
        </LinkButton>
      </div>
    </Card>
  );
}

function StopRow({ o, index }: { o: RunOrder; index: number }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const action = o.state === "pickup" ? { href: stopHref(o), label: "Pick up" } : o.state === "out" ? { href: stopHref(o), label: "Deliver" } : null;
  const isDone = finished(o);
  return (
    <li className={`rounded-2xl border border-line shadow-card ${isDone ? "bg-chip" : "bg-paper"}`} data-testid="stop-row">
      <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)} className="flex min-h-16 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left">
        <span
          aria-hidden
          className={`grid size-9 shrink-0 place-items-center rounded-full font-display text-lg ${o.state === "delivered" ? "bg-green text-white" : isDone ? "bg-paper text-muted" : "bg-green-soft text-green"}`}
        >
          {o.state === "delivered" ? <Check size={20} strokeWidth={3} /> : index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-lg font-semibold">
            <span className="sr-only">Stop {index}: </span>
            {firstName(o.customerName)}
          </span>
          <span className="block text-sm text-muted">{orderNo(o.number)}</span>
          <span className="block text-sm text-muted">
            {o.pincode} · {boxes(o.boxes)}
          </span>
        </span>
        <StopChip state={o.state} />
        <ChevronDown aria-hidden size={22} className={`shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panel}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2 px-4 pb-4">
              <p className="flex gap-2 text-base">
                <MapPin aria-hidden size={20} className="mt-0.5 shrink-0 text-green" />
                {address(o)}
              </p>
              <p className="text-base text-muted">{contents(o)}</p>
              {action && (
                <LinkButton href={action.href} size="lg" className="mt-1">
                  {action.label}
                </LinkButton>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}
