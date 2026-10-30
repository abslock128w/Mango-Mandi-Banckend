import Dexie, { type EntityTable } from "dexie";
import type { CheckResult, Manifest, Step } from "./types";

/** Small key-value settings: device id, refresh token, rider, run start time. */
export type Kv = { key: string; value: unknown };

/**
 * One queued action. `id` is the client-generated id the API uses for
 * idempotency, so a retry after a lost answer never does it twice.
 */
export type Job = {
  id: string;
  kind: "photo" | "pickup" | "check" | "delivery" | "failed";
  orderId: string;
  createdAt: number;
  /** Jobs run oldest first; a job waits while an earlier job for the same order is pending. */
  state: "pending" | "done" | "error";
  tries: number;
  lastError?: string;
  payload: Record<string, unknown>;
  /** The photo itself, for photo jobs (kept until uploaded). */
  blob?: Blob;
  result?: unknown;
  error?: { status: number; code: string; message: string; details?: Record<string, unknown> };
};

/** What the phone knows about one step of one order, shown at once even offline. */
export type StepRecord = {
  key: string; // `${orderId}:${step}`
  orderId: string;
  step: Step;
  photoJobId: string;
  preview: Blob;
  takenAt: number;
  serverPhotoId?: string;
  check?: CheckResult & { photoId: string };
  checking?: boolean;
};

class RiderDb extends Dexie {
  kv!: EntityTable<Kv, "key">;
  jobs!: EntityTable<Job, "id">;
  steps!: EntityTable<StepRecord, "key">;
  manifests!: EntityTable<{ date: string; data: Manifest; at: number }, "date">;

  constructor() {
    super("mandi-rider");
    this.version(1).stores({
      kv: "key",
      jobs: "id, state, orderId, kind, createdAt",
      steps: "key, orderId",
      manifests: "date",
    });
  }
}

export const db = new RiderDb();

export async function getKv<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}
export async function setKv(key: string, value: unknown) {
  await db.kv.put({ key, value });
}
export async function delKv(key: string) {
  await db.kv.delete(key);
}

export const stepKey = (orderId: string, step: Step) => `${orderId}:${step}`;
