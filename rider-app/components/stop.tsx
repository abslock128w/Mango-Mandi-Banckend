"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, Lock, Phone } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import { MAX_CODE_TRIES, OPS_PHONE } from "@/lib/config";
import { db, stepKey, type Job } from "@/lib/db";
import { firstName, telHref } from "@/lib/format";
import { enqueue, newClientId, queueCheck, queuePhoto, whenSettled } from "@/lib/queue";
import { useRun, type RunOrder } from "@/lib/run-context";
import type { CheckResult } from "@/lib/types";
import { BackBar } from "./back-bar";
import { CameraCapture } from "./camera";
import { CodeBoxes } from "./code-boxes";
import { MissedSheet } from "./missed-sheet";
import { StepMarker } from "./tick";
import { A, Button, ErrorText, LinkButton, Spinner } from "./ui";

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
        <div className="grid place-items-center p-10">{loading ? <Spinner /> : <p>This stop is not on your run.</p>}</div>
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

  async function onOpenBox(blob: Blob, where: Parameters<typeof queuePhoto>[3]) {
    const photoJobId = await queuePhoto(id, "open_box", blob, where);
    await queueCheck(id, photoJobId);
  }

  if (delivered) return <DeliveredView o={o} next={orders.find((x) => x.state === "out" || x.state === "pickup") ?? null} />;

  return (
    <>
      <BackBar title={`${firstName(o.customerName)} · ${o.number}`} />
      <ol className="flex flex-col gap-3 p-4" aria-label="Delivery steps">
        <StepCard n={1} state={s1} title="Photo of the box at the door">
          <CameraCapture label="Photo of the box at the door" preview={door?.preview} testId="door-photo" onPhoto={async (b, w) => void (await queuePhoto(id, "door", b, w))} />
        </StepCard>

        <StepCard n={2} state={s3 === "active" && s2 === "done" ? "active" : s2} title="Open the box and photo the mangoes">
          <CameraCapture
            label="Photo of the open box"
            guide="Fill the frame with the open box"
            preview={open?.preview}
            testId="open-photo"
            disabled={checking}
            onPhoto={onOpenBox}
          />
        </StepCard>

        <StepCard n={3} state={s3} title={checkOk ? "Mangoes checked" : "Checking the photo"}>
          <CheckPanel checking={checking} check={check} onContinue={() => open && void queueCheck(id, open.photoJobId, true)} />
        </StepCard>

        <StepCard n={4} state={s4} title="Enter the customer's code">
          {s4 === "active" && <CodeStep o={o} last={lastDelivery ?? null} />}
        </StepCard>
        {s4 === "locked" && checkOk && !doorConfirmed && (
          <p role="status" className="-mt-1 rounded-xl bg-warn-soft px-3 py-2 text-sm font-medium text-warn">
            The door photo is still uploading. The code opens once it is sent.
          </p>
        )}

        <StepCard n={5} state={s5} title="Delivered" />
      </ol>

      <section aria-label="Other actions" className="flex flex-col gap-2 px-4 pb-10">
        <Button variant="secondary" onClick={() => setMissing(true)}>
          Customer not home
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="quiet" onClick={() => setInfo("reschedule")}>
            Reschedule
          </Button>
          <A href={telHref(OPS_PHONE)} variant="quiet">
            <Phone aria-hidden size={20} /> Call ops
          </A>
        </div>
        {info === "reschedule" && (
          <p role="status" className="rounded-xl bg-chip px-3 py-2 text-base">
            Ops moves the delivery to another day. Call ops with the new day the customer wants.
          </p>
        )}
      </section>
      {missing && <MissedSheet o={o} onClose={() => setMissing(false)} />}
    </>
  );
}

function StepCard({ n, state, title, children }: { n: number; state: StepState; title: string; children?: ReactNode }) {
  const expanded = state === "active" && Boolean(children);
  return (
    <li
      aria-current={state === "active" ? "step" : undefined}
      data-testid={`step-${n}`}
      data-state={state}
      className={`rounded-[var(--radius-card)] bg-surface shadow-card ${state === "active" ? "border-2 border-brand" : ""}`}
    >
      <div className="flex min-h-14 items-center gap-3 px-4 py-3">
        <StepMarker n={n} state={state} />
        <h2 className={`flex-1 text-lg font-bold ${state === "locked" ? "text-muted" : ""}`}>{title}</h2>
        {state === "locked" && <Lock aria-label="Locked" size={18} className="text-muted" />}
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function CheckPanel({ checking, check, onContinue }: { checking: boolean; check: (CheckResult & { photoId: string }) | null; onContinue: () => void }) {
  if (checking || !check) {
    return (
      <p className="flex items-center gap-3 text-base" role="status">
        <Spinner label="Checking" /> Checking the photo… This needs signal; it carries on when you have it.
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
      <p className="text-sm text-muted">Use step 2 above: open the box fully and fill the frame with it.</p>
      {check.canContinue && (
        <Button variant="secondary" onClick={onContinue}>
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
        <A href={telHref(OPS_PHONE)} variant="danger" className="w-full text-lg">
          <Phone aria-hidden size={20} /> Call ops
        </A>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-base text-muted">Ask {firstName(o.customerName)} for the 4-digit code from their WhatsApp or the app.</p>
      <CodeBoxes
        length={4}
        value={code}
        label="Customer's 4-digit delivery code"
        disabled={busy}
        invalid={Boolean(err)}
        testId="delivery-code"
        onChange={(v) => {
          setCode(v);
          if (v.length === 4) void submit(v);
        }}
      />
      {err && <ErrorText>{err.message}</ErrorText>}
      {queued && (
        <p role="status" className="rounded-xl bg-warn-soft px-3 py-2 text-base font-medium text-warn">
          No signal. The code is saved and sent as soon as you are back online.
        </p>
      )}
      <p className="text-center text-sm font-semibold text-muted" data-testid="tries-left">
        {triesLeft} of {MAX_CODE_TRIES} tries left
      </p>
      <Button className="w-full text-lg" disabled={code.length !== 4 || busy} onClick={() => void submit()}>
        {busy ? "Checking…" : "Confirm code"}
      </Button>
    </div>
  );
}

function DeliveredView({ o, next }: { o: RunOrder; next: RunOrder | null }) {
  return (
    <>
      <BackBar title={o.number} />
      <div className="flex flex-col items-center gap-4 px-6 pt-12 pb-10 text-center" aria-live="polite">
        <DeliveredTick />
        <h2 className="text-3xl font-extrabold">Delivered</h2>
        <p className="text-lg text-muted">
          {o.number} handed to {firstName(o.customerName)}. The customer gets a WhatsApp message.
        </p>
        {next ? (
          <LinkButton href={next.state === "out" ? `/stop?id=${encodeURIComponent(next.id)}` : `/pickup?id=${encodeURIComponent(next.id)}`} className="mt-4 w-full text-lg">
            Next stop: {firstName(next.customerName)}
          </LinkButton>
        ) : (
          <LinkButton href="/done" className="mt-4 w-full text-lg">
            Finish the run
          </LinkButton>
        )}
        <LinkButton href="/today" variant="quiet" className="w-full">
          Back to the run
        </LinkButton>
      </div>
    </>
  );
}
