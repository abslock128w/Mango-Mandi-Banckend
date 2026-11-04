"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSignedIn } from "@/features/auth/store";
import { usePincode } from "@/features/location/store";
import { toast } from "@/features/shell/ui-store";
import { api, ApiError, qk } from "@/lib/api/client";
import { cn, ripenessLabel } from "@/lib/format";
import type { RipenessStage } from "@/lib/types";

/**
 * Back-in-stock alert for a box at a ripeness, for the shopper's pincode
 * (POST /v1/stock-alerts; WhatsApp tells them when it's back, alerts last 14 days).
 */
export function NotifyButton({ sku, stage, label, wide }: { sku: string; stage: RipenessStage; label: string; wide?: boolean }) {
  const signedIn = useSignedIn();
  const pincode = usePincode();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: alerts } = useQuery({ queryKey: qk.stockAlerts, queryFn: api.stockAlerts, enabled: signedIn, staleTime: 60_000 });
  const done = Boolean(alerts?.some((a) => a.sku === sku && a.stage === stage && !a.notifiedAt));
  const add = useMutation({
    mutationFn: () => api.addStockAlert(sku, stage, pincode!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.stockAlerts });
      toast({ title: `We'll message you on WhatsApp when ${label} (${ripenessLabel[stage].toLowerCase()}) is back`, tone: "success" });
    },
    onError: (e) => toast({ title: e instanceof ApiError ? e.message : "Couldn't set the alert", tone: "danger" }),
  });
  const full = `${label}, ${ripenessLabel[stage].toLowerCase()}`;
  return (
    <button
      type="button"
      disabled={add.isPending}
      onClick={() => {
        if (done) return;
        if (!signedIn) return router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        if (!pincode) return router.push("/location");
        add.mutate();
      }}
      aria-pressed={done}
      aria-label={done ? `Alert set for ${full}` : `Notify me when ${full} is back`}
      className={cn(
        "press relative inline-flex h-8 items-center justify-center gap-1 rounded-6 border text-11 font-semibold after:absolute after:-inset-y-1.5 after:inset-x-0",
        wide ? "w-full px-3 text-13" : "w-[66px]",
        done ? "border-line bg-chip text-muted" : "border-action bg-surface text-action",
      )}
    >
      {wide && (done ? <Check aria-hidden size={14} strokeWidth={2.5} /> : <Bell aria-hidden size={14} strokeWidth={2} />)}
      {done ? "Alert set" : "Notify me"}
    </button>
  );
}
