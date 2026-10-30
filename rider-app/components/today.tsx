"use client";
import { ChevronDown, MapPin, Navigation, Phone, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OPS_PHONE } from "@/lib/config";
import { dateWords, firstName, mapsDirections, STAGE, telHref, warehouseDirections } from "@/lib/format";
import { useRun, type RunOrder } from "@/lib/run-context";
import { PendingBadge } from "./pending-badge";
import { StopChip } from "./stop-chip";
import { A, Card, ErrorText, LinkButton, Spinner } from "./ui";

const finished = (o: RunOrder) => o.state === "delivered" || o.state === "missed";
const contents = (o: RunOrder) => o.items.map((i) => `${i.quantity} × ${i.productName} (${STAGE[i.stage] ?? i.stage.toLowerCase()})`).join(", ");
const address = (o: RunOrder) => [o.deliveryAddress, o.pincode].filter(Boolean).join(", ");

export function Today() {
  const { date, orders, manifest, loading, error, offline, pending } = useRun();
  const router = useRouter();
  const done = orders.filter(finished).length;
  // The current stop: first one out for delivery, else the first to pick up.
  const current = orders.find((o) => o.state === "out") ?? orders.find((o) => o.state === "pickup") ?? null;
  const rest = orders.filter((o) => o !== current);
  const slots = [...new Set(orders.map((o) => o.slotLabel).filter(Boolean))];
  const allDone = orders.length > 0 && done === orders.length;

  useEffect(() => {
    if (allDone) router.prefetch("/done");
  }, [allDone, router]);

  return (
    <div className="pb-10">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/95 px-4 pt-4 pb-3 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-muted">Today · {dateWords(date)}</p>
            <h1 className="text-2xl font-extrabold">{slots.length ? slots.join(" + ") : "Your run"}</h1>
          </div>
          <p className="shrink-0 rounded-2xl bg-surface px-3 py-2 text-center shadow-card" aria-label={`${done} of ${orders.length} stops done`}>
            <span className="block text-2xl font-extrabold tabular-nums">
              {done}/{orders.length}
            </span>
            <span className="text-xs font-semibold text-muted">stops done</span>
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <PendingBadge count={pending} />
          {offline && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-chip px-3 py-1 text-sm font-semibold text-muted">
              <WifiOff aria-hidden size={16} /> Offline: showing the saved run
            </span>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-4 px-4 pt-4">
        {loading && !manifest && (
          <div className="grid place-items-center py-16">
            <Spinner label="Loading your run" />
          </div>
        )}
        <ErrorText>{error}</ErrorText>
        {manifest && !orders.length && (
          <Card>
            <h2 className="text-xl font-bold">No stops for you today</h2>
            <p className="mt-1 text-muted">Ops gives you stops on the Deliveries page. Pull to refresh later, or call ops.</p>
            <A href={telHref(OPS_PHONE)} variant="secondary" className="mt-4 w-full">
              <Phone aria-hidden size={20} /> Call ops
            </A>
          </Card>
        )}
        {allDone && (
          <LinkButton href="/done" className="w-full text-lg">
            Run complete: see the summary
          </LinkButton>
        )}

        {current && <CurrentStop o={current} index={orders.indexOf(current) + 1} />}

        {rest.length > 0 && (
          <section aria-label="Other stops" className="flex flex-col gap-2">
            <h2 className="px-1 text-sm font-bold tracking-wide text-muted uppercase">Stops</h2>
            {rest.map((o) => (
              <StopRow key={o.id} o={o} index={orders.indexOf(o) + 1} />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

function CurrentStop({ o, index }: { o: RunOrder; index: number }) {
  const out = o.state === "out";
  return (
    <Card className="sticky top-[118px] z-10 border-2 border-brand" aria-label="Current stop" data-testid="current-stop">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-muted">
          Stop {index} · {o.number}
        </p>
        <StopChip state={o.state} />
      </div>
      <h2 className="mt-1 text-2xl font-extrabold">{firstName(o.customerName)}</h2>
      <p className="mt-1 flex gap-2 text-base">
        <MapPin aria-hidden size={20} className="mt-0.5 shrink-0 text-action" />
        <span>{address(o)}</span>
      </p>
      <p className="mt-2 text-base text-muted">
        <strong className="text-ink">
          {o.boxes} box{o.boxes === 1 ? "" : "es"}
        </strong>
        : {contents(o)}
      </p>
      {o.gift && <p className="mt-1 text-sm font-semibold text-ripe">Gift from {o.gift.from}</p>}
      {!out && o.pickupWarehouse && (
        <p className="mt-2 rounded-xl bg-chip px-3 py-2 text-base" data-testid="pickup-warehouse">
          Collect from <strong>{o.pickupWarehouse.name}</strong>
        </p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {/* Before the pickup, directions to the warehouse; after it, to the customer. */}
        <A href={!out && o.pickupWarehouse ? warehouseDirections(o.pickupWarehouse) : mapsDirections(address(o))} target="_blank" rel="noopener" variant="secondary">
          <Navigation aria-hidden size={20} /> {!out && o.pickupWarehouse ? "To warehouse" : "Navigate"}
        </A>
        {o.phone ? (
          <A href={telHref(o.phone)} variant="secondary">
            <Phone aria-hidden size={20} /> Call
          </A>
        ) : (
          <span />
        )}
      </div>
      <LinkButton href={out ? `/stop?id=${encodeURIComponent(o.id)}` : `/pickup?id=${encodeURIComponent(o.id)}`} className="mt-3 w-full text-lg">
        {out ? "At the door" : "Pick up at warehouse"}
      </LinkButton>
    </Card>
  );
}

function StopRow({ o, index }: { o: RunOrder; index: number }) {
  const [open, setOpen] = useState(false);
  const action = o.state === "pickup" ? { href: `/pickup?id=${encodeURIComponent(o.id)}`, label: "Pick up" } : o.state === "out" ? { href: `/stop?id=${encodeURIComponent(o.id)}`, label: "Deliver" } : null;
  return (
    <div className="rounded-2xl bg-surface shadow-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-chip text-sm font-bold">{index}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold">{firstName(o.customerName)}</span>
          <span className="block truncate text-sm text-muted">
            {o.pincode} · {o.boxes} box{o.boxes === 1 ? "" : "es"}
          </span>
        </span>
        <StopChip state={o.state} />
        <ChevronDown aria-hidden size={20} className={`shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2 px-4 pb-4">
              <p className="text-base">{address(o)}</p>
              <p className="text-sm text-muted">{contents(o)}</p>
              {action && (
                <Link href={action.href} className="press inline-flex min-h-12 items-center justify-center rounded-2xl bg-action px-4 font-semibold text-white">
                  {action.label}
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
