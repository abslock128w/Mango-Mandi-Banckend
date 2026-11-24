"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { db, stepKey } from "@/lib/db";
import { firstName, orderNo } from "@/lib/format";
import { enqueue, newClientId, queuePhoto } from "@/lib/queue";
import type { RunOrder } from "@/lib/run-context";
import { FAIL_REASONS, type FailReason } from "@/lib/types";
import { CameraCapture } from "./camera";
import { Button, ErrorText } from "./ui";

/** A missed delivery: why, an optional photo of the door, and the box comes back. Ops reschedules. */
export function MissedSheet({ o, onClose }: { o: RunOrder; onClose: () => void }) {
  const [reason, setReason] = useState<FailReason | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const photo = useLiveQuery(() => db.steps.get(stepKey(o.id, "attempt")), [o.id]);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    if (!reason) return setError("Pick a reason.");
    if (reason === "OTHER" && !note.trim()) return setError("Say what happened.");
    await enqueue({
      id: newClientId(),
      kind: "failed",
      orderId: o.id,
      payload: { reason, attempt: o.attempt, ...(note.trim() ? { note: note.trim() } : {}), ...(photo ? { photoJobId: photo.photoJobId } : {}) },
    });
    router.push("/today");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-scrim" onClick={onClose}>
      <motion.div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="missed-title"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="mx-auto max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] bg-canvas p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] outline-none"
      >
        <span aria-hidden className="mx-auto mb-4 block h-1.5 w-12 rounded-full bg-line" />
        <p className="text-sm font-semibold text-muted">
          {orderNo(o.number)} · {firstName(o.customerName)}
        </p>
        <h2 id="missed-title" className="font-display text-3xl text-green">
          Could not deliver
        </h2>
        <fieldset className="mt-4 flex flex-col gap-2">
          <legend className="mb-2 text-lg font-semibold">Why?</legend>
          {FAIL_REASONS.map(([value, label]) => (
            <label key={value} className={`flex min-h-14 items-center gap-3 rounded-2xl border-2 px-4 ${reason === value ? "border-green bg-green-soft" : "border-line bg-paper"}`}>
              <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} className="size-5 accent-[var(--color-green)]" />
              <span className="text-lg">{label}</span>
            </label>
          ))}
        </fieldset>
        {reason === "OTHER" && (
          <label className="mt-3 flex flex-col gap-1">
            <span className="text-base font-semibold">What happened</span>
            <textarea value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} rows={3} className="rounded-2xl border-2 border-line bg-paper p-3 text-base focus:border-green" />
          </label>
        )}
        <div className="mt-4">
          <CameraCapture label="Photo of the door (optional)" preview={photo?.preview} onPhoto={async (b, w) => void (await queuePhoto(o.id, "attempt", b, w))} />
        </div>
        <p className="mt-3 text-base text-muted">Bring the box back to the warehouse. Ops sets a new day.</p>
        <div className="mt-4 flex flex-col gap-2">
          <ErrorText>{error}</ErrorText>
          <Button variant="danger" size="xl" className="w-full" onClick={() => void submit()}>
            Report missed delivery
          </Button>
          <Button variant="quiet" size="lg" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
