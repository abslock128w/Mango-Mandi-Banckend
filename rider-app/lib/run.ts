"use client";
// While a run is active: the screen stays on (Wake Lock, asked for again when
// the app comes back to the front, since the browser drops it when hidden),
// and the rider's position goes to ops every 20 s or after 50 m.
import { useEffect } from "react";
import { api } from "./api";
import { LOCATION_EVERY_MS, LOCATION_MIN_METERS } from "./config";
import { metersBetween } from "./photo";

export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const ask = async () => {
      try {
        if (document.visibilityState === "visible" && !stopped) lock = await navigator.wakeLock.request("screen");
      } catch {
        // battery saver or not allowed: the run works without it
      }
    };
    const onVis = () => {
      if (document.visibilityState === "visible") void ask();
    };
    void ask();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}

export function useLocationTrail(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    let last: { lat: number; lng: number; t: number } | null = null;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const here = { lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 };
        const now = Date.now();
        const due = !last || now - last.t >= LOCATION_EVERY_MS || metersBetween(last, here) >= LOCATION_MIN_METERS;
        if (!due) return;
        last = { ...here, t: now };
        // Best effort: a missed point is not queued, the next one replaces it.
        void api.location({ ...here, accuracy: Math.round(p.coords.accuracy), at: new Date(p.timestamp || now).toISOString() }).catch(() => {});
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);
}
