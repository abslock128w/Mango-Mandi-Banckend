"use client";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing } from "lucide-react";
import { toast } from "@/features/shell/ui-store";
import { api, qk } from "@/lib/api/client";
import { cn, longDate, ripenessLabel } from "@/lib/format";
import type { StockAlert } from "@/lib/types";
import { ErrorNote, ListSkeleton, SignInPrompt, useSession } from "./bits";

const status = (a: StockAlert) =>
  a.notifiedAt
    ? a.availableOn
      ? `Back in stock from ${longDate(a.availableOn)}. We sent you a message.`
      : "Back in stock. We sent you a message."
    : `Waiting, until ${longDate(a.expiresAt.slice(0, 10))}`;

/** "Tell me when it's back" alerts (GET /stock-alerts). A WhatsApp message goes out once the box is in stock. */
export function AlertsView() {
  const signedIn = useSession();
  if (signedIn === null) return <div className="skeleton m-4 h-32 rounded-12" />;
  if (!signedIn) return <SignInPrompt next="/account/alerts" title="Sign in to see your alerts" body="When a box is sold out, ask us to tell you when it's back." />;
  return <Alerts />;
}

function Alerts() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.stockAlerts, queryFn: api.stockAlerts });
  const stop = useMutation({
    mutationFn: (a: StockAlert) => api.deleteStockAlert(a.id),
    onSuccess: () => {
      toast({ title: "Alert stopped" });
      return qc.invalidateQueries({ queryKey: qk.stockAlerts });
    },
  });

  return (
    <div className="mx-auto max-w-[720px] space-y-3 p-3 lg:p-6">
      {q.isPending ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <div className="rounded-12 bg-surface p-6 text-center">
          <p className="text-13 text-muted">When a box is sold out, tap &quot;Tell me when it&apos;s back&quot; and we&apos;ll message you once it&apos;s in stock.</p>
          <Link href="/" className="mt-3 inline-flex h-11 items-center font-semibold text-action">
            Shop mangoes
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {q.data.map((a) => {
            const Icon = a.notifiedAt ? BellRing : Bell;
            return (
              <li key={a.id} className="flex items-start gap-3 rounded-12 bg-surface p-3">
                <span className={cn("grid size-10 shrink-0 place-items-center rounded-8", a.notifiedAt ? "bg-tint text-action" : "bg-chip text-ink")}>
                  <Icon aria-hidden size={20} strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-13 font-semibold text-ink">
                    {a.name}, {ripenessLabel[a.stage].toLowerCase()}
                  </p>
                  <p className={cn("text-12", a.notifiedAt ? "text-action" : "text-muted")}>{status(a)}</p>
                  <p className="text-12 text-muted">Pincode {a.pincode}</p>
                </div>
                {!a.notifiedAt && (
                  <button
                    type="button"
                    aria-label={`Stop the alert for ${a.name}, ${ripenessLabel[a.stage]}`}
                    disabled={stop.isPending && stop.variables?.id === a.id}
                    onClick={() => stop.mutate(a)}
                    className="h-11 shrink-0 rounded-8 px-3 text-12 font-semibold text-action hover:bg-chip disabled:text-muted"
                  >
                    Stop
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ErrorNote error={stop.error} />
    </div>
  );
}
