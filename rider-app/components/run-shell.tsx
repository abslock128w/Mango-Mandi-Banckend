"use client";
import { MotionConfig } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { RunProvider, useRun } from "@/lib/run-context";
import { useLocationTrail, useWakeLock } from "@/lib/run";
import { useSession } from "@/lib/session";
import { Unlock } from "./unlock";
import { Spinner } from "./ui";

/** Signed-in pages: the PIN screen in place when the session lapsed, the run's data, the screen kept on during a run, and the rider's location while signed in. */
export function RunShell({ children }: { children: ReactNode }) {
  const s = useSession();
  const router = useRouter();
  useEffect(() => {
    if (s.status === "signedOut") router.replace("/");
  }, [s.status, router]);
  if (s.status === "locked") return <Unlock name={s.riderName} />;
  if (s.status !== "ready") {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    );
  }
  return (
    <MotionConfig reducedMotion="user">
      <RunProvider>
        <RunEffects />
        {children}
      </RunProvider>
    </MotionConfig>
  );
}

function RunEffects() {
  const { orders } = useRun();
  // A run is active from the first pickup until the last stop is done.
  const active = orders.some((o) => o.state === "out");
  useWakeLock(active);
  // Where the rider is whenever the app is open and signed in (on duty), not only once a stop is out:
  // ops give each new stop to the rider nearest to it (POST /manifest/auto-assign).
  useLocationTrail(true);
  return null;
}
