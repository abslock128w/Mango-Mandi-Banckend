"use client";
// Every rider action goes through this queue in IndexedDB: photos, pickups,
// mango checks, codes and missed deliveries. Each job carries a client id the
// API uses for idempotency, so retrying after a lost answer is safe. The queue
// drains on `online`, when the app comes back to the front, and every 15 s.
// Jobs for one order run in the order they were made; a job waits while an
// earlier one for the same order has not gone through.
import { ApiError, api } from "./api";
import { DRAIN_EVERY_MS } from "./config";
import { db, stepKey, type Job, type StepRecord } from "./db";
import type { CheckResult, Step } from "./types";

type Settled = Job;
const waiters = new Map<string, ((j: Settled) => void)[]>();
const doneListeners = new Set<(j: Job) => void>();

export function onJobSettled(fn: (j: Job) => void) {
  doneListeners.add(fn);
  return () => doneListeners.delete(fn);
}

function settle(j: Job) {
  for (const w of waiters.get(j.id) ?? []) w(j);
  waiters.delete(j.id);
  for (const l of doneListeners) l(j);
}

/** Resolves when the job went through or failed for good; null if still waiting (offline) after `ms`. */
export function whenSettled(id: string, ms = 15_000): Promise<Settled | null> {
  return new Promise((resolve) => {
    void db.jobs.get(id).then((j) => {
      if (j && j.state !== "pending") return resolve(j);
      const list = waiters.get(id) ?? [];
      const timer = setTimeout(() => resolve(null), ms);
      list.push((x) => {
        clearTimeout(timer);
        resolve(x);
      });
      waiters.set(id, list);
    });
  });
}

export const newClientId = () => crypto.randomUUID();

export async function enqueue(job: Omit<Job, "createdAt" | "state" | "tries"> & { createdAt?: number }) {
  // createdAt is strictly increasing, so two jobs made in one millisecond keep their order.
  const last = await db.jobs.orderBy("createdAt").last();
  const createdAt = Math.max(job.createdAt ?? Date.now(), (last?.createdAt ?? 0) + 1);
  await db.jobs.put({ ...job, createdAt, state: "pending", tries: 0 });
  void drain();
  return job.id;
}

/** A photo for a step: shown at once from IndexedDB, uploaded by the queue. */
export async function queuePhoto(orderId: string, step: Step, blob: Blob, where: { lat: number | null; lng: number | null; accuracy: number | null; takenAt: number }) {
  const id = newClientId();
  const rec: StepRecord = { key: stepKey(orderId, step), orderId, step, photoJobId: id, preview: blob, takenAt: where.takenAt };
  await db.steps.put(rec);
  await enqueue({ id, kind: "photo", orderId, blob, payload: { step, ...where } });
  return id;
}

/** The mango check for the open-box photo (or "continue for review" after two failed checks). */
export async function queueCheck(orderId: string, photoJobId: string, continueForReview = false) {
  await db.steps.update(stepKey(orderId, "open_box"), { checking: true });
  return enqueue({ id: newClientId(), kind: "check", orderId, payload: { photoJobId, continueForReview } });
}

const errorOf = (err: ApiError) => ({ status: err.status, code: err.code, message: err.message, details: err.details });

async function photoId(photoJobId: string): Promise<string | "wait" | "gone"> {
  const p = await db.jobs.get(photoJobId);
  if (!p) return "gone";
  if (p.state === "pending") return "wait";
  if (p.state === "error") return "gone";
  return (p.result as { id: string }).id;
}

/** Runs one job against the API. Returns "wait" when it depends on a photo not uploaded yet. */
async function run(j: Job): Promise<unknown | "wait"> {
  switch (j.kind) {
    case "photo": {
      const p = j.payload as { step: Step; lat: number | null; lng: number | null; accuracy: number | null; takenAt: number };
      const meta = { step: p.step, clientId: j.id, lat: p.lat ?? undefined, lng: p.lng ?? undefined, accuracy: p.accuracy ?? undefined, takenAt: new Date(p.takenAt).toISOString() };
      const t = await api.photoToken(j.orderId, meta);
      let r: { id: string };
      if (t.mode === "blob") {
        const { put } = await import("@vercel/blob/client");
        try {
          await put(t.pathname, j.blob!, { access: "private", token: t.clientToken, contentType: "image/jpeg" });
        } catch (err) {
          throw new ApiError(0, "UPLOAD_FAILED", err instanceof Error ? err.message : "Upload failed", undefined, true);
        }
        r = await api.photoFinalize(j.orderId, { pathname: t.pathname, ...meta });
      } else {
        const headers: Record<string, string> = { "X-Step": p.step, "X-Client-Id": j.id, "X-Taken-At": meta.takenAt };
        if (p.lat != null) headers["X-Lat"] = String(p.lat);
        if (p.lng != null) headers["X-Lng"] = String(p.lng);
        if (p.accuracy != null) headers["X-Accuracy"] = String(Math.round(p.accuracy));
        r = await api.photoDirect(j.orderId, j.blob!, headers);
      }
      await db.steps.where("orderId").equals(j.orderId).modify((s) => {
        if (s.photoJobId === j.id) s.serverPhotoId = r.id;
      });
      return r;
    }
    case "check": {
      const p = j.payload as { photoJobId: string; continueForReview: boolean };
      const pid = await photoId(p.photoJobId);
      if (pid === "wait") return "wait";
      if (pid === "gone") throw new ApiError(400, "PHOTO_MISSING", "The photo did not upload. Take it again.");
      const r: CheckResult = await api.check(j.orderId, pid, p.continueForReview);
      await db.steps.where("orderId").equals(j.orderId).modify((s) => {
        if (s.photoJobId === p.photoJobId) {
          s.check = { ...r, photoId: pid };
          s.checking = false;
        }
      });
      return r;
    }
    case "pickup":
      return await api.pickup(j.orderId, j.id);
    case "delivery":
      return await api.delivery(j.orderId, { outcome: "DELIVERED", ...(j.payload as object) });
    case "failed": {
      const p = j.payload as { photoJobId?: string } & Record<string, unknown>;
      const { photoJobId, ...rest } = p;
      let photo: string | undefined;
      if (photoJobId) {
        const pid = await photoId(photoJobId);
        if (pid === "wait") return "wait";
        if (pid !== "gone") photo = pid;
      }
      return await api.delivery(j.orderId, { outcome: "FAILED", ...rest, ...(photo ? { photoId: photo } : {}) });
    }
  }
}

let draining: Promise<void> | null = null;
let again = false;

/** Sends whatever is waiting. Safe to call at any time; calls during a drain run once more after it. */
export function drain(): Promise<void> {
  if (draining) {
    again = true;
    return draining;
  }
  draining = (async () => {
    do {
      again = false;
      await drainOnce();
    } while (again);
  })().finally(() => (draining = null));
  return draining;
}

async function drainOnce() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const pending = await db.jobs.where("state").equals("pending").sortBy("createdAt");
  const blocked = new Set<string>();
  for (const j of pending) {
    if (blocked.has(j.orderId)) continue;
    try {
      const result = await run(j);
      if (result === "wait") {
        blocked.add(j.orderId);
        continue;
      }
      const done: Job = { ...j, state: "done", result, blob: j.kind === "photo" ? undefined : j.blob };
      await db.jobs.put(done);
      settle(done);
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(0, "ERROR", String(err), undefined, true);
      if (e.transient || e.status === 401) {
        await db.jobs.update(j.id, { tries: j.tries + 1, lastError: e.message });
        blocked.add(j.orderId);
        // No connection at all: the rest would fail the same way.
        if (e.network || e.status === 401) return;
        continue;
      }
      const failed: Job = { ...j, state: "error", error: errorOf(e), lastError: e.message, blob: undefined };
      await db.jobs.put(failed);
      if (j.kind === "check") {
        const p = j.payload as { photoJobId: string };
        await db.steps.where("orderId").equals(j.orderId).modify((s) => {
          if (s.photoJobId === p.photoJobId) s.checking = false;
        });
      }
      settle(failed);
    }
  }
}

let started = false;
/** Starts the background triggers once per page load. */
export function startQueue() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("online", () => void drain());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void drain();
  });
  setInterval(() => void drain(), DRAIN_EVERY_MS);
  void drain();
}

/** Finished jobs are kept a day (for the run summary), then removed. */
export async function pruneJobs() {
  const before = Date.now() - 24 * 3_600_000;
  await db.jobs.where("createdAt").below(before).and((j) => j.state !== "pending").delete();
}
