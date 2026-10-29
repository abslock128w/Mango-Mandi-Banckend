"use client";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { devPay } from "../payment";

/**
 * Development stand-in for Razorpay (the API has no Razorpay keys): two
 * buttons that settle the payment through /v1/dev/pay, then report the result.
 */
export function DevPayButtons({ orderId, onSettled }: { orderId: string; onSettled: (status: string) => void }) {
  const [busy, setBusy] = useState<null | "captured" | "failed">(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (outcome: "captured" | "failed") => {
    setBusy(outcome);
    setError(null);
    try {
      onSettled(await devPay(orderId, outcome));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="rounded-12 border border-dashed border-line bg-canvas p-3" data-testid="dev-pay">
      <p className="text-12 text-muted">Test mode: no payment service is set up, so no money moves.</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" disabled={Boolean(busy)} onClick={() => run("captured")} className="press flex h-12 items-center justify-center gap-1.5 rounded-12 bg-action text-13 font-bold text-white disabled:bg-disabled">
          {busy === "captured" && <Loader2 aria-hidden size={16} className="animate-spin" />} Pay (test)
        </button>
        <button type="button" disabled={Boolean(busy)} onClick={() => run("failed")} className="press flex h-12 items-center justify-center gap-1.5 rounded-12 border border-line bg-surface text-13 font-semibold text-ink disabled:opacity-60">
          {busy === "failed" && <Loader2 aria-hidden size={16} className="animate-spin" />} Fail payment (test)
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-12 text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
