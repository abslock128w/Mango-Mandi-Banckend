"use client";
import { WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/**
 * Says so while the phone has no connection. A pill over the top of the page, so nothing
 * moves when it comes and goes; the catalogue and orders refresh on their own once back online.
 */
export function OfflineNotice() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+8px)] z-[90] flex justify-center px-4">
      <p role="status" className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-13 font-semibold text-white shadow-card">
        <WifiOff aria-hidden size={16} /> You&apos;re offline. We&apos;ll update when you&apos;re back.
      </p>
    </div>
  );
}
