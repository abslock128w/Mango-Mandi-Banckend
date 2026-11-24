"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, CalendarClock, CheckCircle2, CloudUpload, Lock, MapPin, Phone, ShieldCheck, UserX } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { MAX_CODE_TRIES, OPS_PHONE } from "@/lib/config";
import { db, stepKey, type Job, type StepRecord } from "@/lib/db";
import { firstName, orderNo, STAGE, telHref } from "@/lib/format";
import { enqueue, newClientId, queueCheck, queuePhoto, whenSettled } from "@/lib/queue";
import { useRun, type RunOrder } from "@/lib/run-context";
import type { CheckResult } from "@/lib/types";
import { BackBar } from "./back-bar";
import { CameraCapture, useBlobUrl } from "./camera";
import { CodeBoxes } from "./code-boxes";
import { MissedSheet } from "./missed-sheet";
import { StepMarker } from "./tick";
import { A, Button, ErrorText, LinkButton, Notice, Spinner } from "./ui";

const DeliveredTick = dynamic(() => import("./delivered").then((m) => m.DeliveredTick), { ssr: false });

type StepState = "done" | "active" | "locked";

/** At the door: five steps that unlock in order, ending with the customer's code. */
export function Stop({ id }: { id: string }) {
  const { orders, loading } = useRun();
  const o = orders.find((x) => x.id === id);
  if (!o) {
    return (
      <>
        <BackBar title="Delivery" />
        <div className="grid place-items-center p-10">{loading ? <Spinner /> : <p className="text-lg">This stop is not on your run.</p>}</div>
      </>
    );
  }
  return <StopFlow o={o} />;
}

function StopFlow({ o }: { o: RunOrder }) {
  const id = o.id;
  const { orders } = useRun();
  const door = useLiveQuery(() => db.steps.get(stepKey(id, "door")), [id]);
  const open = useLiveQuery(() => db.steps.get(stepKey(id, "open_box")), [id]);
  const lastDelivery = useLiveQuery(
    () => db.jobs.where("orderId").equals(id).filter((j) => j.kind === "delivery").sortBy("createdAt").then((js) => js.at(-1) ?? null),
    [id],
  );
  const [missing, setMissing] = useState(false);
  const [info, setInfo] = useState<"reschedule" | null>(null);

  const proof = o.proof ?? {};
  const doorTaken = Boolean(door || proof.door);
  const doorConfirmed = Boolean(door?.serverPhotoId || proof.door);
  const openTaken = Boolean(open || proof.open_box);
  const serverCheck: (CheckResult & { photoId: string }) | null = proof.open_box
    ? {
        photoId: proof.open_box.id,
        passed: Boolean(proof.open_box.passed),
        needsReview: proof.open_box.needsReview,
        failures: 0,
        canContinue: false,
        reason: proof.open_box.verdict?.reason ?? null,
        verdict: proof.open_box.verdict,
        mode: "on",
      }
    : null;
  // The phone's own result is newer (a retake after the manifest loaded).
  const check = open ? (open.check ?? null) : serverCheck;
  const checking = Boolean(open?.checking) || (Boolean(open) && !open?.check);
  const checkOk = Boolean(check && (check.passed || check.needsReview));
  const delivered = o.state === "delivered";

  const s1: StepState = doorTaken ? "done" : "active";
  const s2: StepState = !doorTaken ? "locked" : openTaken ? "done" : "active";
  const s3: StepState = !openTaken ? "locked" : checkOk ? "done" : "active";
  const s4: StepState = !(checkOk && doorConfirmed) ? "locked" : delivered ? "done" : "active";
  const s5: StepState = delivered ? "done" : "locked";
  // A failed check keeps the open-box camera open above it, for the retake.
  const s2Shown: StepState = s3 === "active" && s2 === "done" ? "active" : s2;
  const at = [s1, s2, s3, s4, s5].findIndex((s) => s === "active") + 1 || 5;

  async function onOpenBox(blob: Blob, where: Parameters<typeof queuePhoto>[3]) {
    const photoJobId = await queuePhoto(id, "open_box", blob, where);
    await queueCheck(id, photoJobId);
  }

  if (delivered) return <DeliveredView o={o} next={orders.find((x) => x.state === "out" || x.state === "pickup") ?? null} />;

  const address = [o.deliveryAddress, o.pincode].filter(Boolean).join(", ");
  return (
    <>
      <BackBar eyebrow={`${orderNo(o.number)} · step ${at} of 5`} title={firstName(o.customerName)} />
      <div className="mx-4 mt-4 flex items-start gap-3 rounded-2xl border border-line bg-paper p-3 shadow-card">
        <MapPin aria-hidden size={22} className="mt-0.5 shrink-0 text-green" />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-base">{address}</p>
          <p className="text-sm text-muted">
            {o.boxes} box{o.boxes === 1 ? "" : "es"} · {o.items.map((i) => `${i.quantity} × ${i.productName} (${STAGE[i.stage] ?? i.stage.toLowerCase()})`).join(", ")}
          </p>
        </div>
        {o.phone && (
          <A href={telHref(o.phone)} variant="secondary" className="shrink-0 px-3" aria-label={`Call ${firstName(o.customerName)}`}>
            <Phone aria-hidden size={20} /> Call
          </A>
        )}
      </div>

      <ol className="flex flex-col p-4" aria-label="Delivery steps">
        <StepCard n={1} state={s1} title="Photo of the box at the door" summary={<PhotoSummary rec={door} confirmed={doorConfirmed} label="Box at the door" />}>
          <CameraCapture
            label="Photo of the box at the door"
            guide="The closed box with the door in view."
            preview={door?.preview}
            testId="door-photo"
            onPhoto={async (b, w) => void (await queuePhoto(id, "door", b, w))}
          />
        </StepCard>

        <StepCard
          n={2}
          state={s2Shown}
          title="Open the box and photo the mangoes"
          lockedHint="Opens after the door photo."
          summary={<PhotoSummary rec={open} confirmed={Boolean(open?.serverPhotoId || proof.open_box)} label="Open box" />}
        >
          <CameraCapture label="Photo of the open box" guide="Fill the frame with the open box" preview={open?.preview} testId="open-photo" disabled={checking} onPhoto={onOpenBox} />
        </StepCard>

        <StepCard
          n={3}
          state={s3}
          title="Mango check"
          lockedHint="Opens after the open-box photo."
          summary={
            <p className="flex items-center gap-2 text-base text-green">
              <ShieldCheck aria-hidden size={20} /> {check?.passed ? "The mangoes look good." : "Sent to ops for a review."}
            </p>
          }
        >
          <CheckPanel checking={checking} check={check} onContinue={() => open && void queueCheck(id, open.photoJobId, true)} />
        </StepCard>

        <StepCard
          n={4}
          state={s4}
          title="Customer's code"
          lockedHint={checkOk && !doorConfirmed ? undefined : "Opens after the mango check."}
          note={
            s4 === "locked" && checkOk && !doorConfirmed ? (
              <Notice className="text-sm">The door photo is still uploading. The code opens once it is sent.</Notice>
            ) : undefined
          }
        >
          {s4 === "active" && <CodeStep o={o} last={lastDelivery ?? null} />}
        </StepCard>

        <StepCard n={5} state={s5} title="Delivered" lockedHint="After the right code." last />
      </ol>

      <section aria-label="Other actions" className="border-t border-line px-4 pt-4 pb-10">
        <div className="grid grid-cols-3 gap-2">
          <Button variant="quiet" className="min-h-18 flex-col gap-1 px-2 text-sm leading-tight" onClick={() => setMissing(true)}>
            <UserX aria-hidden size={22} /> Customer not home
          </Button>
          <Button variant="quiet" className="min-h-18 flex-col gap-1 px-2 text-sm leading-tight" aria-expanded={info === "reschedule"} onClick={() => setInfo(info ? null : "reschedule")}>
            <CalendarClock aria-hidden size={22} /> Reschedule
          </Button>
          <A href={telHref(OPS_PHONE)} variant="quiet" className="min-h-18 flex-col gap-1 px-2 text-sm leading-tight">
            <Phone aria-hidden size={22} /> Call ops
          </A>
        </div>
        {info === "reschedule" && (
          <Notice tone="plain" className="mt-3">
            Ops moves the delivery to another day. Call ops with the day the customer wants.
          </Notice>
        )}
      </section>
      {missing && <MissedSheet o={o} onClose={() => setMissing(false)} />}
    </>
  );
}

const STATUS: Record<StepState, [string, string]> = {
  done: ["Done", "bg-green-soft text-green"],
  active: ["Now", "bg-mango text-ink"],
  locked: ["Locked", "bg-chip text-muted"],
};

function StepCard({
  n,
  state,
  title,
  children,
  summary,
  lockedHint,
  note,
  last = false,
}: {
  n: number;
  state: StepState;
  title: string;
  children?: ReactNode;
  summary?: ReactNode;
  lockedHint?: string;
  note?: ReactNode;
  last?: boolean;
}) {
  const expanded = state === "active" && Boolean(children);
  const [label, tone] = STATUS[state];
  const card =
    state === "active" ? "border-2 border-green bg-paper shadow-lift" : state === "done" ? "border border-line bg-paper shadow-card" : "border-2 border-dashed border-line bg-canvas";
  return (
    <li aria-current={state === "active" ? "step" : undefined} data-testid={`step-${n}`} data-state={state} className="relative flex gap-3 pb-3">
      {/* The rail between markers: green once the step above is done. */}
      {!last && <span aria-hidden className={`absolute top-11 bottom-0 left-[21px] w-0.5 ${state === "done" ? "bg-green" : "bg-line"}`} />}
      <span className="relative z-10 pt-2">
        <StepMarker n={n} state={state} />
      </span>
      <div className={`min-w-0 flex-1 rounded-[var(--radius-card)] transition-colors duration-300 ${card}`}>
        <div className="flex min-h-14 items-center gap-2 px-4 py-3">
          <h2 className={`min-w-0 flex-1 text-lg leading-snug font-bold ${state === "locked" ? "text-muted" : "text-ink"}`}>
            <span className="sr-only">Step {n}: </span>
            {title}
          </h2>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={state}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold ${tone}`}
            >
              {state === "locked" && <Lock aria-hidden size={14} />}
              {label}
            </motion.span>
          </AnimatePresence>
        </div>
        {state === "locked" && lockedHint && <p className="-mt-2 px-4 pb-3 text-sm text-muted">{lockedHint}</p>}
        {state === "done" && summary && <div className="-mt-1 px-4 pb-3">{summary}</div>}
        {note && <div className="px-4 pb-3">{note}</div>}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4">{children}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </li>
  );
}

/** A done photo step: a small copy of the photo and whether the server has it yet. */
function PhotoSummary({ rec, confirmed, label }: { rec: StepRecord | undefined; confirmed: boolean; label: string }) {
  const url = useBlobUrl(rec?.preview);
  return (
    <div className="flex items-center gap-3">
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- a local photo, not an optimisable asset
        <img src={url} alt={`Photo: ${label}`} className="size-14 shrink-0 rounded-xl border border-line object-cover" />
      )}
      {confirmed ? (
        <p className="flex items-center gap-2 text-base text-green">
          <CheckCircle2 aria-hidden size={20} /> Photo sent
        </p>
      ) : (
        <p className="flex items-center gap-2 text-base text-warn">
          <CloudUpload aria-hidden size={20} /> Saved on the phone, sending when there is signal
        </p>
      )}
    </div>
  );
}

function CheckPanel({ checking, check, onContinue }: { checking: boolean; check: (CheckResult & { photoId: string }) | null; onContinue: () => void }) {
  if (checking || !check) {
    return (
      <p className="flex items-center gap-3 text-base" role="status">
        <Spinner label="Checking" /> Checking the photo. This needs signal; it carries on when you have it.
      </p>
    );
  }
  if (check.passed || check.needsReview) return null;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className="flex flex-col gap-3" data-testid="verdict-fail">
      <p className="flex gap-2 rounded-xl bg-danger-soft px-3 py-2 text-base text-danger" role="alert">
        <AlertTriangle aria-hidden size={20} className="mt-0.5 shrink-0" />
        <span>
          <strong>Retake the photo.</strong> {check.reason || "The mangoes in the open box need to be clearly visible."}
        </span>
      </p>
      <p className="text-base text-muted">Use step 2 above: open the box fully and fill the frame with it.</p>
      {check.canContinue && (
        <Button variant="secondary" size="lg" onClick={onContinue}>
          Continue for review
        </Button>
      )}
    </motion.div>
  );
}

function CodeStep({ o, last }: { o: RunOrder; last: Job | null }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const err = last?.state === "error" ? last.error : null;
  const triesFromError = typeof err?.details?.triesLeft === "number" ? (err.details.triesLeft as number) : null;
  const triesLeft = err?.code === "CODE_LOCKED" ? 0 : (triesFromError ?? o.codeTriesLeft ?? MAX_CODE_TRIES);
  const locked = Boolean(o.codeLocked) || triesLeft <= 0;

  async function submit(value = code) {
    if (value.length !== 4 || busy) return;
    setBusy(true);
    setQueued(false);
    const jobId = newClientId();
    await enqueue({ id: jobId, kind: "delivery", orderId: o.id, payload: { code: value, attempt: o.attempt } });
    const j = await whenSettled(jobId, 12_000);
    setBusy(false);
    if (!j) setQueued(true);
    else if (j.state === "error") setCode("");
  }

  if (locked) {
    return (
      <div className="flex flex-col gap-3" data-testid="code-locked">
        <p className="flex gap-2 rounded-xl bg-danger-soft px-3 py-2 text-base text-danger" role="alert">
          <Lock aria-hidden size={20} className="mt-0.5 shrink-0" />
          <span>
            <strong>Code locked</strong> after {MAX_CODE_TRIES} wrong tries. Call ops before handing over the box.
          </span>
        </p>
        <A href={telHref(OPS_PHONE)} variant="danger" size="xl" className="w-full">
          <Phone aria-hidden size={22} /> Call ops
        </A>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-muted">Ask {firstName(o.customerName)} for the 4-digit code from their WhatsApp or the app.</p>
      <CodeBoxes
        length={4}
        value={code}
        label="Customer's 4-digit delivery code"
        size="lg"
        disabled={busy}
        invalid={Boolean(err)}
        testId="delivery-code"
        onChange={(v) => {
          setCode(v);
          if (v.length === 4) void submit(v);
        }}
      />
      {err && <ErrorText>{err.message}</ErrorText>}
      {queued && <Notice>No signal. The code is saved and sent as soon as you are back online.</Notice>}
      <p className="text-center text-base font-semibold text-muted" data-testid="tries-left">
        {triesLeft} of {MAX_CODE_TRIES} tries left
      </p>
      <Button variant="confirm" size="xl" className="w-full" disabled={code.length !== 4 || busy} onClick={() => void submit()}>
        {busy ? "Checking…" : "Confirm code"}
      </Button>
    </div>
  );
}

function DeliveredView({ o, next }: { o: RunOrder; next: RunOrder | null }) {
  return (
    <>
      <BackBar eyebrow={orderNo(o.number)} title={firstName(o.customerName)} />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center gap-4 px-6 pt-12 pb-10 text-center"
        aria-live="polite"
      >
        <DeliveredTick />
        <h2 className="font-display text-4xl text-green">Delivered</h2>
        <p className="text-lg text-muted">
          {orderNo(o.number)} is with {firstName(o.customerName)}. They get a WhatsApp message to say so.
        </p>
        {next ? (
          <LinkButton href={next.state === "out" ? `/stop?id=${encodeURIComponent(next.id)}` : `/pickup?id=${encodeURIComponent(next.id)}`} size="xl" className="mt-4 w-full">
            Next stop: {firstName(next.customerName)}
          </LinkButton>
        ) : (
          <LinkButton href="/done" variant="confirm" size="xl" className="mt-4 w-full">
            Finish the run
          </LinkButton>
        )}
        <LinkButton href="/today" variant="quiet" size="lg" className="w-full">
          Back to the run
        </LinkButton>
      </motion.div>
    </>
  );
}
