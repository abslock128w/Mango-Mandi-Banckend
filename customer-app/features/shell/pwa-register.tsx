"use client";
import { useEffect } from "react";

/** Registers the Serwist service worker in production builds. */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/serwist/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
