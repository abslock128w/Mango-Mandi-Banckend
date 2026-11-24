"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, CheckCheck, Clock, MessageCircle, Navigation, PackageCheck, Warehouse, X } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { db, stepKey, type Job } from "@/lib/db";
import { firstName, orderNo, STAGE, warehouseDirections } from "@/lib/format";
import { enqueue, newClientId, queuePhoto, whenSettled } from "@/lib/queue";
import { useRun } from "@/lib/run-context";
import type { PickupMessage, PickupResult } from "@/lib/types";
import { BackBar } from "./back-bar";
import { CameraCapture } from "./camera";
import { A, Button, Card, ErrorText, LinkButton, Notice, Spinner } from "./ui";

const MESSAGE_LABEL: Record<string, string> = {
  OUT_FOR_DELIVERY: "Out for delivery",
  GIFT_OUT_FOR_DELIVERY: "Out for delivery (gift recipient)",
  DELIVERY_CODE: "Delivery code",
  GIFT_DELIVERY_CODE: "Delivery code (gift recipient)",
};

/** At the warehouse: a photo of the sealed box, then "Picked up" (the customer gets the WhatsApp messages). */
export function Pickup({ id }: { id: string }) {
  const { orders, loading } = useRun();
  const o = orders.find((x) => x.id === id);
  const rec = useLiveQuery(() => db.steps.get(stepKey(id, "pickup")), [id]);
  const pickupJob = useLiveQuery(
    () => db.jobs.where("orderId").equals(id).filter((j) => j.kind === "pickup").reverse().sortBy("createdAt").then((js) => js[0] ?? null),
    [id],
  );
  const [waiting, setWaiting] = useState(false);

  if (!o) {
    return (
      <>
        <BackBar title="Pickup" />
        <div className="grid place-items-center p-10">{loading ? <Spinner /> : <p className="text-lg">This stop is not on your run.</p>}</div>
      </>
    );
  }

  const result = pickupJob?.state === "done" ? (pickupJob.result as PickupResult) : null;
  const pickedUp = Boolean(result) || o.state === "out" || o.state === "delivered";
  const boxWord = o.boxes > 1 ? `the ${o.boxes} sealed boxes` : "the sealed box";

  async function markPickedUp() {
    setWaiting(true);
    const jobId = newClientId();
    await enqueue({ id: jobId, kind: "pickup", orderId: id, payload: {} });
    await whenSettled(jobId, 12_000);
    setWaiting(false);
  }

  return (
    <>
      <BackBar eyebrow={`Pickup · ${orderNo(o.number)}`} title={firstName(o.customerName)} />
      <div className="flex flex-col gap-4 p-4 pb-10">
        {o.pickupWarehouse && !pickedUp && (
          <Card data-testid="pickup-warehouse-card">
            <div className="flex items-start gap-3">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-mango text-ink">
                <Warehouse aria-hidden size={24} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-muted">Collect from</p>
                <p className="font-display text-2xl leading-tight text-ink">{o.pickupWarehouse.name}</p>
                {o.pickupWarehouse.address && <p className="text-base text-muted">{o.pickupWarehouse.address}</p>}
              </div>
            </div>
            <A href={warehouseDirections(o.pickupWarehouse)} target="_blank" rel="noopener" variant="secondary" size="lg" className="mt-3 w-full">
              <Navigation aria-hidden size={20} /> Directions to the warehouse
            </A>
          </Card>
        )}

        <Card>
          <p className="text-sm font-semibold text-muted">
            {orderNo(o.number)} · {o.boxes} box{o.boxes === 1 ? "" : "es"}
          </p>
          <ul className="mt-1 flex flex-col gap-1 text-lg">
            {o.items.map((i) => (
              <li key={`${i.sku}-${i.stage}`}>
                <strong>{i.quantity} ×</strong> {i.productName} <span className="text-muted">({STAGE[i.stage] ?? i.stage.toLowerCase()})</span>
              </li>
            ))}
          </ul>
        </Card>

        {!pickedUp && (
          <>
            <section aria-labelledby="pickup-photo-title" className="flex flex-col gap-3">
              <h2 id="pickup-photo-title" className="font-display text-2xl text-green">
                1. Photo of {boxWord}
              </h2>
              <CameraCapture
                label={o.boxes > 1 ? `Photo of the ${o.boxes} sealed boxes` : "Photo of the sealed box"}
                guide="Keep the whole box and its seal inside the corners."
                preview={rec?.preview}
                testId="pickup-photo"
                onPhoto={async (blob, where) => void (await queuePhoto(id, "pickup", blob, where))}
              />
            </section>
            <section aria-labelledby="pickup-confirm-title" className="flex flex-col gap-3">
              <h2 id="pickup-confirm-title" className={`font-display text-2xl ${rec ? "text-green" : "text-muted"}`}>
                2. Mark it picked up
              </h2>
              {pickupJob?.state === "error" && <ErrorText>{pickupJob.error?.message}</ErrorText>}
              {pickupJob?.state === "pending" && !waiting && <Notice>Saved on the phone. It is sent as soon as you have signal.</Notice>}
              <Button variant="confirm" size="xl" className="w-full" disabled={!rec || waiting || pickupJob?.state === "pending"} onClick={() => void markPickedUp()}>
                <PackageCheck aria-hidden size={24} /> {waiting ? "Sending…" : "Mark picked up"}
              </Button>
              {!rec && <p className="text-center text-base text-muted">Take the photo first.</p>}
            </section>
          </>
        )}

        {pickedUp && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: "easeOut" }} className="flex flex-col gap-4">
            <Card accent="green" aria-live="polite">
              <p className="flex items-center gap-3 font-display text-3xl text-green">
                <span className="grid size-11 place-items-center rounded-full bg-green text-white">
                  <Check aria-hidden size={26} strokeWidth={3} />
                </span>
                Picked up
              </p>
              <Messages job={pickupJob} result={result} />
            </Card>
            <LinkButton href="/today" size="xl" className="w-full">
              Back to the run
            </LinkButton>
          </motion.div>
        )}
      </div>
    </>
  );
}

function Messages({ job, result }: { job: Job | null | undefined; result: PickupResult | null }) {
  if (!job || !result) return <p className="mt-2 text-base text-muted">The customer has their delivery code on WhatsApp and in the app.</p>;
  const sent = result.messages.filter((m) => m.status === "SENT").length;
  return (
    <div className="mt-3">
      <p className="flex items-center gap-2 text-lg font-semibold">
        <MessageCircle aria-hidden size={22} className="text-green" />
        {sent === result.messages.length && sent > 0 ? "WhatsApp sent" : sent ? "WhatsApp partly sent" : "WhatsApp queued"}
      </p>
      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line" data-testid="whatsapp-messages">
        {result.messages.map((m) => (
          <li key={m.kind} className="flex min-h-12 items-center justify-between gap-3 bg-paper px-3 py-2">
            <span className="text-base">{MESSAGE_LABEL[m.kind] ?? m.kind}</span>
            <MessageStatus m={m} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function MessageStatus({ m }: { m: PickupMessage }) {
  const s = m.deliveryStatus ?? (m.status === "SENT" ? "sent" : m.status.toLowerCase());
  const icon = s === "read" || s === "delivered" ? <CheckCheck aria-hidden size={18} /> : s === "sent" ? <Check aria-hidden size={18} /> : s === "failed" ? <X aria-hidden size={18} /> : <Clock aria-hidden size={18} />;
  const tone = s === "failed" ? "bg-danger-soft text-danger" : s === "sent" || s === "delivered" || s === "read" ? "bg-green-soft text-green" : "bg-chip text-muted";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold ${tone}`}>
      {icon} {s}
    </span>
  );
}
