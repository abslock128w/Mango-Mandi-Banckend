"use client";
import { useEffect } from "react";
import { pruneJobs, startQueue } from "@/lib/queue";
import { bootSession } from "@/lib/session";

/** Once per page load: the session from IndexedDB, the upload queue, the service worker. */
export function AppBoot() {
  useEffect(() => {
    void bootSession();
    startQueue();
    void pruneJobs();
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/serwist/sw.js", { scope: "/" }).catch(() => {});
    }
  }, []);
  return null;
}
