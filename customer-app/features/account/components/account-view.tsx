"use client";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CalendarClock, ChevronRight, Download, HelpCircle, Loader2, LogOut, MapPin, Package, ShieldAlert, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/features/shell/ui-store";
import { api, qk } from "@/lib/api/client";
import { cn } from "@/lib/format";
import type { Me } from "@/lib/types";
import { ConfirmDialog, ErrorNote, SignInPrompt, useSession } from "./bits";

const ROWS = [
  { href: "/orders", icon: Package, label: "Your orders" },
  { href: "/preorders", icon: CalendarClock, label: "Pre-orders" },
  { href: "/account/addresses", icon: MapPin, label: "Saved addresses" },
  { href: "/account/alerts", icon: Bell, label: "Stock alerts" },
  { href: "/help", icon: HelpCircle, label: "Help" },
];

const showPhone = (p: string | null) => (p ? `+91 ${p.replace(/^\+?91(?=\d{10}$)/, "")}` : null);

export function AccountView() {
  const signedIn = useSession();
  if (signedIn === null) return <div className="skeleton m-4 h-32 rounded-12" />;
  if (!signedIn) return <SignInPrompt next="/account" />;
  return <Account />;
}

function Account() {
  const router = useRouter();
  const me = useQuery({ queryKey: qk.me, queryFn: api.me });
  const signOut = useMutation({
    mutationFn: api.signOut,
    onSettled: () => {
      toast({ title: "Signed out" });
      router.replace("/");
    },
  });
  // A lost or shared phone: every session ends, this one too.
  const everywhere = useMutation({
    mutationFn: api.signOutEverywhere,
    onSuccess: () => {
      toast({ title: "Signed out on every device" });
      router.replace("/");
    },
  });

  return (
    <div className="mx-auto max-w-[720px] space-y-3 p-3 lg:p-6">
      <section aria-label="Your details" className="flex items-center gap-3 rounded-12 bg-surface p-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-full bg-brand text-ink">
          <UserRound aria-hidden size={28} strokeWidth={1.75} />
        </span>
        {me.isPending ? (
          <div className="flex-1 space-y-2">
            <div className="skeleton h-5 w-40 rounded-4" />
            <div className="skeleton h-4 w-28 rounded-4" />
          </div>
        ) : me.isError ? (
          <div className="flex-1">
            <ErrorNote error={me.error} onRetry={() => me.refetch()} />
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <p className="truncate text-17 font-bold text-ink">{me.data.name || "Mango lover"}</p>
            {me.data.phone ? (
              <p className="text-13 text-muted">{showPhone(me.data.phone)}</p>
            ) : (
              <Link href="/login?step=phone&next=/account" className="inline-flex min-h-11 items-center text-13 font-semibold text-action">
                Add your mobile number
              </Link>
            )}
            {me.data.email && <p className="truncate text-12 text-muted">{me.data.email}</p>}
          </div>
        )}
      </section>

      <nav aria-label="Account">
        <ul className="divide-y divide-line rounded-12 bg-surface">
          {ROWS.map(({ href, icon: Icon, label }) => (
            <li key={href}>
              <Link href={href} className="flex h-14 items-center gap-3 px-4 text-13 text-ink hover:bg-chip">
                <Icon aria-hidden size={20} strokeWidth={1.75} className="text-muted" />
                <span className="flex-1">{label}</span>
                <ChevronRight aria-hidden size={18} className="text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {me.data && <Reminders me={me.data} />}

      <YourData />

      <section aria-label="Sign out" className="space-y-2 rounded-12 bg-surface p-2">
        <button type="button" disabled={signOut.isPending} onClick={() => signOut.mutate()} className="flex h-12 w-full items-center gap-3 rounded-8 px-2 text-13 font-semibold text-ink hover:bg-chip">
          <LogOut aria-hidden size={20} strokeWidth={1.75} className="text-muted" /> {signOut.isPending ? "Signing out" : "Sign out"}
        </button>
        <button type="button" disabled={everywhere.isPending} onClick={() => everywhere.mutate()} className="flex h-12 w-full items-center gap-3 rounded-8 px-2 text-13 font-semibold text-ink hover:bg-chip">
          <ShieldAlert aria-hidden size={20} strokeWidth={1.75} className="text-muted" /> {everywhere.isPending ? "Signing out" : "Sign out on every device"}
        </button>
        <ErrorNote error={everywhere.error} />
      </section>

      <DeleteAccount />

      <p className="pt-2 text-center text-12 text-muted">
        How we use your details is in our{" "}
        <Link href="/privacy" className="font-semibold text-action underline">
          privacy notice
        </Link>
        . Questions about an order? See{" "}
        <Link href="/help" className="font-semibold text-action underline">
          Help
        </Link>{" "}
        and our{" "}
        <Link href="/terms" className="font-semibold text-action underline">
          terms of sale
        </Link>
        .
      </p>
    </div>
  );
}

/** The reminder a week after a delivery. Order updates always come. */
function Reminders({ me }: { me: Me }) {
  const qc = useQueryClient();
  // Shown at once, put back if the save fails.
  const [wanted, setWanted] = useState<boolean | null>(null);
  const save = useMutation({
    mutationFn: api.setReminders,
    onSuccess: (m) => qc.setQueryData(qk.me, m),
    onSettled: () => setWanted(null),
  });
  const on = wanted ?? me.remindersOptIn;
  return (
    <section aria-labelledby="wa-h" className="rounded-12 bg-surface p-4">
      <h2 id="wa-h" className="text-15 font-bold text-ink">
        WhatsApp messages
      </h2>
      <p className="mt-0.5 text-12 text-muted">Order updates always come. This one is up to you.</p>
      <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3">
        <span className="flex-1 text-13 text-ink">Remind me to order again a week after a delivery</span>
        <input
          type="checkbox"
          role="switch"
          checked={on}
          disabled={save.isPending}
          onChange={(e) => {
            setWanted(e.target.checked);
            save.mutate(e.target.checked);
          }}
          className="peer sr-only"
        />
        <span aria-hidden className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-action", on ? "bg-action" : "bg-disabled")}>
          <span className={cn("absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform", on && "translate-x-5")} />
        </span>
      </label>
      <ErrorNote error={save.error} />
    </section>
  );
}

/** A copy of what we hold about the customer, as a JSON file (GET /me/export, signed-in download). */
function YourData() {
  const download = useMutation({
    mutationFn: api.exportData,
    onSuccess: (url) => {
      const a = document.createElement("a");
      a.href = url;
      a.download = "mandimangoes-my-data.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  return (
    <section aria-labelledby="data-h" className="rounded-12 bg-surface p-4">
      <h2 id="data-h" className="text-15 font-bold text-ink">
        Your data
      </h2>
      <p className="mt-0.5 text-12 text-muted">Download a copy of everything we keep about you: your account, addresses, orders, bookings, claims and reviews.</p>
      <button type="button" disabled={download.isPending} onClick={() => download.mutate()} className="press mt-3 flex h-11 items-center gap-2 rounded-12 border border-line px-4 text-13 font-semibold text-action">
        {download.isPending ? <Loader2 aria-hidden size={16} className="animate-spin" /> : <Download aria-hidden size={16} />}
        {download.isPending ? "Preparing" : "Download my data"}
      </button>
      <div className="mt-2">
        <ErrorNote error={download.error} />
      </div>
    </section>
  );
}

function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const remove = useMutation({
    mutationFn: api.deleteAccount,
    onSuccess: () => {
      setOpen(false);
      toast({ title: "Your account is deleted" });
      router.replace("/");
    },
  });
  return (
    <section aria-labelledby="delete-h" className="rounded-12 bg-surface p-4">
      <h2 id="delete-h" className="text-15 font-bold text-ink">
        Delete your account
      </h2>
      <p className="mt-0.5 text-12 text-muted">
        We remove your name, mobile number, email and delivery addresses. Past orders keep only their amounts, for our accounts. Your bills stay as they were issued, with your
        name and delivery address, for 8 years, because tax law requires it. You can&apos;t delete your account while an order or booking is on its way.
      </p>
      <button
        type="button"
        onClick={() => {
          setTyped("");
          remove.reset();
          setOpen(true);
        }}
        className="press mt-3 h-11 rounded-12 border border-danger px-4 text-13 font-semibold text-danger"
      >
        Delete my account
      </button>
      <ConfirmDialog
        open={open}
        title="Delete your account?"
        keepLabel="Keep my account"
        confirmLabel="Delete account"
        busyLabel="Deleting"
        busy={remove.isPending}
        error={remove.error}
        confirmDisabled={typed.trim().toUpperCase() !== "DELETE"}
        onConfirm={() => remove.mutate()}
        onClose={() => setOpen(false)}
      >
        <p>This can&apos;t be undone. Your order history goes, and you&apos;ll be signed out. Download any bills you need first.</p>
        <label htmlFor="confirm-delete" className="block font-semibold text-ink">
          Type DELETE to confirm
        </label>
        <input
          id="confirm-delete"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          className="h-11 w-full rounded-8 border border-line px-3 text-15 text-ink outline-none focus:border-action"
        />
      </ConfirmDialog>
    </section>
  );
}
