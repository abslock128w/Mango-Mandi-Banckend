"use client";
import { useEffect, useState } from "react";

/** "4:59": time left on a payment hold, ticking. Calls onEnd once at zero. */
export function useSecondsLeft(until: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000)) : null;
}

/** The time now, refreshed every `everyMs` (for hold and claim deadlines in lists). */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function HoldCountdown({ until }: { until: string | null | undefined }) {
  const left = useSecondsLeft(until);
  if (left == null) return null;
  if (left === 0) return <span className="text-12 text-danger">The hold on your boxes has ended.</span>;
  return (
    <span className="text-12 text-ink">
      Boxes held for <span className="font-bold tabular-nums" aria-hidden>{mmss(left)}</span>
      <span className="sr-only">{Math.ceil(left / 60)} minutes</span>
    </span>
  );
}
