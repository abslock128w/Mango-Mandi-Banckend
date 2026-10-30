"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, CheckCheck, Clock, MessageCircle, X } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { db, stepKey, type Job } from "@/lib/db";
import { firstName, STAGE } from "@/lib/format";
import { enqueue, newClientId, queuePhoto, whenSettled } from "@/lib/queue";
import { useRun } from "@/lib/run-context";
import type { PickupMessage, PickupResult } from "@/lib/types";
import { BackBar } from "./back-bar";
import { CameraCapture } from "./camera";
import { Button, Card, ErrorText, LinkButton, Spinner } from "./ui";

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
        <div className="grid place-items-center p-10">{loading ? <Spinner /> : <p>This stop is not on your run.</p>}</div>
      </>
    );
  }

  const result = pickupJob?.state === "done" ? (pickupJob.result as PickupResult) : null;
  const pickedUp = Boolean(result) || o.state === "out" || o.state === "delivered";

  async function markPickedUp() {
    setWaiting(true);
    const jobId = newClientId();
    await enqueue({ id: jobId, kind: "pickup", orderId: id, payload: {} });
    await whenSettled(jobId, 12_000);
    setWaiting(false);
  }

  return (
    <>
      <BackBar title={`Pickup · ${o.number}`} />
      <div className="flex flex-col gap-4 p-4">
        <Card>
          <p className="text-sm font-bold text-muted">{o.number}</p>
          <h2 className="text-2xl font-extrabold">{firstName(o.customerName)}</h2>
          <ul className="mt-2 flex flex-col gap-1 text-base">
            {o.items.map((i) => (
              <li key={`${i.sku}-${i.stage}`}>
                <strong>{i.quantity} ×</strong> {i.productName} <span className="text-muted">({STAGE[i.stage] ?? i.stage.toLowerCase()})</span>
              </li>
            ))}
          </ul>
        </Card>

        {!pickedUp && (
          <>
            <CameraCapture
              label={o.boxes > 1 ? `Photo of the ${o.boxes} sealed boxes` : "Photo of the sealed box"}
              preview={rec?.preview}
              testId="pickup-photo"
              onPhoto={async (blob, where) => void (await queuePhoto(id, "pickup", blob, where))}
            />
            {pickupJob?.state === "error" && <ErrorText>{pickupJob.error?.message}</ErrorText>}
            {pickupJob?.state === "pending" && !waiting && (
              <p role="status" className="rounded-xl bg-warn-soft px-3 py-2 text-base font-medium text-warn">
                Saved on the phone. It is sent as soon as you have signal.
              </p>
            )}
            <Button className="w-full text-lg" disabled={!rec || waiting || pickupJob?.state === "pending"} onClick={() => void markPickedUp()}>
              {waiting ? "Sending…" : "Mark picked up"}
            </Button>
          </>
        )}

        {pickedUp && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className="flex flex-col gap-4">
            <Card className="border-2 border-action" aria-live="polite">
              <p className="flex items-center gap-2 text-xl font-bold text-action">
                <Check aria-hidden size={24} /> Picked up
              </p>
              <Messages job={pickupJob} result={result} />
            </Card>
            <LinkButton href="/today" className="w-full text-lg">
              Back to the run
            </LinkButton>
          </motion.div>
        )}
      </div>
    </>
  );
}

function Messages({ job, result }: { job: Job | null | undefined; result: PickupResult | null }) {
  if (!job || !result) return <p className="mt-1 text-muted">The customer has their delivery code on WhatsApp and in the app.</p>;
  const sent = result.messages.filter((m) => m.status === "SENT").length;
  return (
    <div className="mt-2">
      <p className="flex items-center gap-2 text-base font-semibold">
        <MessageCircle aria-hidden size={20} className="text-action" />
        {sent === result.messages.length && sent > 0 ? "WhatsApp sent" : sent ? "WhatsApp partly sent" : "WhatsApp queued"}
      </p>
      <ul className="mt-2 flex flex-col gap-1" data-testid="whatsapp-messages">
        {result.messages.map((m) => (
          <li key={m.kind} className="flex items-center justify-between gap-2 rounded-xl bg-chip px-3 py-2">
            <span>{MESSAGE_LABEL[m.kind] ?? m.kind}</span>
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
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-semibold ${s === "failed" ? "text-danger" : "text-action"}`}>
      {icon} {s}
    </span>
  );
}
