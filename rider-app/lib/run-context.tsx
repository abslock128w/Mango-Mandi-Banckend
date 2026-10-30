"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api } from "./api";
import { db, getKv, setKv } from "./db";
import { todayIST } from "./format";
import { onJobSettled } from "./queue";
import type { Manifest, ManifestOrder } from "./types";

export type StopState = "unpacked" | "pickup" | "out" | "delivered" | "missed";

export type RunOrder = ManifestOrder & { slotLabel: string | null; city: string | null; pincode: string; state: StopState };

type Run = {
  date: string;
  manifest: Manifest | null;
  orders: RunOrder[];
  loading: boolean;
  error: string | null;
  offline: boolean;
  refresh: () => Promise<void>;
  /** Set when the first box is picked up: for "time taken" on the run summary. */
  startedAt: number | null;
  pending: number;
};

const RunContext = createContext<Run | null>(null);

export function useRun() {
  const r = useContext(RunContext);
  if (!r) throw new Error("useRun outside RunProvider");
  return r;
}

/** The manifest for today, kept in IndexedDB so the run opens with no signal. */
export function RunProvider({ children }: { children: ReactNode }) {
  const date = todayIST();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const pending = useLiveQuery(() => db.jobs.where("state").equals("pending").count(), [], 0);
  // Orders this phone reported missed today: a DELIVERY_FAILED order from an earlier day is a pickup again.
  const missedHere = useLiveQuery(
    () => db.jobs.where("kind").equals("failed").filter((j) => j.state === "done").toArray().then((js) => new Set(js.map((j) => j.orderId))),
    [],
    new Set<string>(),
  );
  // Same for a missed delivery that is still queued: it is done for the rider.
  const missedQueued = useLiveQuery(
    () => db.jobs.where("kind").equals("failed").filter((j) => j.state === "pending").toArray().then((js) => new Set(js.map((j) => j.orderId))),
    [],
    new Set<string>(),
  );
  const deliveredQueued = useLiveQuery(
    () => db.jobs.where("kind").equals("delivery").filter((j) => j.state === "done" && (j.result as { outcome?: string })?.outcome === "DELIVERED").toArray().then((js) => new Set(js.map((j) => j.orderId))),
    [],
    new Set<string>(),
  );

  const refresh = useCallback(async () => {
    try {
      const m = await api.manifest(date);
      setManifest(m);
      setError(null);
      setOffline(false);
      await db.manifests.put({ date, data: m, at: Date.now() });
    } catch (err) {
      if (err instanceof ApiError && err.network) setOffline(true);
      else if (!(err instanceof ApiError && err.status === 401)) setError(err instanceof Error ? err.message : "Could not load the run.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    let live = true;
    void db.manifests.get(date).then((c) => {
      if (live && c) {
        setManifest((m) => m ?? c.data);
        setLoading(false);
      }
    });
    void getKv<number>(`runStart:${date}`).then((t) => live && setStartedAt(t ?? null));
    // Fetched after the saved run is shown (no state set during the effect itself).
    queueMicrotask(() => void refresh());
    const t = setInterval(() => void refresh(), 30_000);
    const off = onJobSettled((j) => {
      if (j.state === "done" && j.kind === "pickup") {
        void getKv<number>(`runStart:${date}`).then(async (s) => {
          if (!s) {
            await setKv(`runStart:${date}`, j.createdAt);
            setStartedAt(j.createdAt);
          }
        });
      }
      if (j.kind !== "photo") void refresh();
    });
    const onOnline = () => void refresh();
    window.addEventListener("online", onOnline);
    return () => {
      live = false;
      clearInterval(t);
      off();
      window.removeEventListener("online", onOnline);
    };
  }, [date, refresh]);

  const orders = useMemo<RunOrder[]>(() => {
    if (!manifest) return [];
    return manifest.runs.flatMap((r) =>
      r.stops.flatMap((s) =>
        s.orders.map((o) => {
          let state: StopState;
          if (o.status === "DELIVERED" || deliveredQueued.has(o.id)) state = "delivered";
          else if (missedHere.has(o.id) || missedQueued.has(o.id)) state = "missed";
          else if (o.status === "OUT_FOR_DELIVERY") state = "out";
          else if (["PACKED", "SHIPPED", "DELIVERY_FAILED"].includes(o.status)) state = "pickup";
          else state = "unpacked";
          return { ...o, slotLabel: r.slot ? `${r.slot.label} · ${r.slot.startsAt}–${r.slot.endsAt}` : null, city: s.city, pincode: s.pincode, state };
        }),
      ),
    );
  }, [manifest, missedHere, missedQueued, deliveredQueued]);

  const value = useMemo(() => ({ date, manifest, orders, loading, error, offline, refresh, startedAt, pending }), [date, manifest, orders, loading, error, offline, refresh, startedAt, pending]);
  return <RunContext.Provider value={value}>{children}</RunContext.Provider>;
}
