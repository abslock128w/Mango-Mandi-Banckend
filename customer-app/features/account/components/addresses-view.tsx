"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Trash2 } from "lucide-react";
import { toast } from "@/features/shell/ui-store";
import { api, qk } from "@/lib/api/client";
import type { SavedAddress } from "@/lib/types";
import { ErrorNote, ListSkeleton, SignInPrompt, useSession } from "./bits";

/** Addresses saved by checkout (the API keeps the last 5). Nothing to add here: they are typed at checkout. */
export function AddressesView() {
  const signedIn = useSession();
  if (signedIn === null) return <div className="skeleton m-4 h-32 rounded-12" />;
  if (!signedIn) return <SignInPrompt next="/account/addresses" title="Sign in to see your addresses" body="Addresses you order to are kept here, so next time you can pick one instead of typing it." />;
  return <Addresses />;
}

function Addresses() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.addresses, queryFn: api.addresses });
  const forget = useMutation({
    mutationFn: (a: SavedAddress) => api.deleteAddress(a.id),
    onSuccess: () => {
      toast({ title: "Address removed" });
      return qc.invalidateQueries({ queryKey: qk.addresses });
    },
  });

  return (
    <div className="mx-auto max-w-[720px] space-y-3 p-3 lg:p-6">
      <p className="px-1 text-12 text-muted">We save the address each time you order, up to 5. Pick one at checkout instead of typing it again.</p>
      {q.isPending ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorNote error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <p className="rounded-12 bg-surface p-6 text-center text-13 text-muted">No saved addresses yet. The address you use at checkout is kept here.</p>
      ) : (
        <ul className="space-y-2">
          {q.data.map((a) => (
            <li key={a.id} className="flex items-start gap-3 rounded-12 bg-surface p-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-8 bg-chip">
                <MapPin aria-hidden size={20} strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                {a.name && <p className="text-13 font-semibold text-ink">{a.name}</p>}
                <p className="text-13 break-words text-ink">{a.address}</p>
                <p className="text-12 text-muted">Pincode {a.pincode}</p>
              </div>
              <button
                type="button"
                aria-label={`Remove address: ${a.address}`}
                disabled={forget.isPending && forget.variables?.id === a.id}
                onClick={() => forget.mutate(a)}
                className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-chip hover:text-danger disabled:opacity-50"
              >
                <Trash2 size={18} strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={forget.error} />
    </div>
  );
}
