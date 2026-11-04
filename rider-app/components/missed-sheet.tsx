"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { db, stepKey } from "@/lib/db";
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
        transition={{ duration: 0.2, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        className="mx-auto max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-canvas p-5 outline-none"
      >
        <h2 id="missed-title" className="text-2xl font-extrabold">
          Could not deliver
        </h2>
        <fieldset className="mt-4 flex flex-col gap-2">
          <legend className="mb-2 text-base font-semibold">Why?</legend>
          {FAIL_REASONS.map(([value, label]) => (
            <label key={value} className={`flex min-h-12 items-center gap-3 rounded-2xl border-2 px-4 ${reason === value ? "border-action bg-tint" : "border-line bg-surface"}`}>
              <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} className="size-5 accent-[var(--color-action)]" />
              <span className="text-base">{label}</span>
            </label>
          ))}
        </fieldset>
        {reason === "OTHER" && (
          <label className="mt-3 flex flex-col gap-1">
            <span className="text-base font-semibold">What happened</span>
            <textarea value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} rows={3} className="rounded-2xl border-2 border-line bg-surface p-3 text-base" />
          </label>
        )}
        <div className="mt-4">
          <CameraCapture label="Photo of the door (optional)" preview={photo?.preview} onPhoto={async (b, w) => void (await queuePhoto(o.id, "attempt", b, w))} />
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <ErrorText>{error}</ErrorText>
          <Button variant="danger" className="w-full text-lg" onClick={() => void submit()}>
            Report missed delivery
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
